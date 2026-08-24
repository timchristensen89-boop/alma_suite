import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './env.js';
import { authMiddleware } from './lib/auth-middleware.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { adminRouter } from './routes/admin.js';
import { almaTasksRouter } from './routes/alma-tasks.js';
import { publicSnapshotRouter } from './routes/public-snapshot.js';
import { auditsRouter } from './routes/audits.js';
import { authRouter } from './routes/auth.js';
import { checklistsRouter } from './routes/checklists.js';
import { communicationsRouter } from './routes/communications.js';
import { deviceRouter } from './routes/device.js';
import { posRouter } from './routes/pos.js';
import { forecastModuleRouter } from './routes/forecast-module.js';
import { forecastRouter } from './routes/forecast.js';
import { giftCardsRouter, stripeGiftCardWebhook } from './routes/gift-cards.js';
import { qrRouter } from './routes/qr.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { integrationJobsRouter } from './routes/integration-jobs.js';
import { deputyWebhookReceiver, enquiryForwardReceiver, enquiryInboundEmailReceiver, integrationsRouter, lightspeedInboundEmailReceiver, sevenroomsInboundEmailReceiver, squareWebhookReceiver, xeroWebhookReceiver } from './routes/integrations.js';
import { issuesRouter } from './routes/issues.js';
import { liquorRouter } from './routes/liquor.js';
import { marketingRouter } from './routes/marketing.js';
import { menuMappingsRouter } from './routes/menu-mappings.js';
import { messagesRouter } from './routes/messages.js';
import { notificationsRouter } from './routes/notifications.js';
import { reportsRouter } from './routes/reports.js';
import { reserveRouter } from './routes/reserve.js';
import { searchRouter } from './routes/search.js';
import { settingsRouter } from './routes/settings.js';
import { handbookDocumentsRouter } from './routes/handbook-documents.js';
import { shiftTaskAssignmentsRouter } from './routes/shift-task-assignments.js';
import { shiftTaskRulesRouter } from './routes/shift-task-rules.js';
import { staffRouter } from './routes/staff.js';
import { temperaturesRouter } from './routes/temperatures.js';
import { trainingRouter } from './routes/training.js';
import { websiteRouter } from './routes/website.js';
import { auditService } from './services/audit.service.js';
import { incidentService } from './services/incident.service.js';
import { issueService } from './services/issue.service.js';
import { staffService } from './services/staff.service.js';
import { temperatureService } from './services/temperature.service.js';

const app = express();

// Behind Caddy on the VPS: without this, req.ip is the proxy for every request
// and the per-IP throttles below (and the existing device/QR ones) can't tell
// clients apart. One hop.
app.set('trust proxy', 1);

// Security headers. CSP and the cross-origin isolation headers are turned off
// on purpose: this is a JSON API serving browser frontends on other origins
// (CORS handles those), and helmet's defaults for CORP/COEP would block those
// cross-origin reads. What stays on is the useful-for-an-API set — HSTS,
// no-sniff, frame-deny, referrer policy.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.post('/api/gift-cards/webhook', express.raw({ type: 'application/json' }), stripeGiftCardWebhook);
app.post('/api/integrations/square/webhook/:accountKey', express.raw({ type: 'application/json', limit: '2mb' }), squareWebhookReceiver);
app.post('/webhooks/square/:accountKey', express.raw({ type: 'application/json', limit: '2mb' }), squareWebhookReceiver);
app.post('/webhooks/xero', express.raw({ type: 'application/json', limit: '2mb' }), xeroWebhookReceiver);
app.post('/api/integrations/deputy/webhook', express.raw({ type: 'application/json', limit: '2mb' }), deputyWebhookReceiver);
app.post('/webhooks/deputy', express.raw({ type: 'application/json', limit: '2mb' }), deputyWebhookReceiver);
// Inbound reservation email (Resend Inbound → JSON POST). 25mb: emails can
// carry sizeable CSV attachments.
app.post('/webhooks/sevenrooms/email', express.raw({ type: '*/*', limit: '25mb' }), sevenroomsInboundEmailReceiver);
// Inbound item-sales email (Lightspeed scheduled Insights CSV via the VPS
// mailbox poller). Same transport contract as the SevenRooms feed.
app.post('/webhooks/lightspeed/email', express.raw({ type: '*/*', limit: '25mb' }), lightspeedInboundEmailReceiver);
// A guest replying to an enquiry, forwarded by the mailbox poller — same
// transport contract again — and the website handing over a new enquiry.
app.post('/webhooks/enquiries/email', express.raw({ type: '*/*', limit: '25mb' }), enquiryInboundEmailReceiver);
app.post('/webhooks/enquiries/forward', express.raw({ type: '*/*', limit: '2mb' }), enquiryForwardReceiver);
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());
app.use('/api/integration-jobs', integrationJobsRouter);

// Brute-force / enumeration / DoS guards on the public surface. Sized so a
// whole venue behind one NAT IP never trips them in normal service — the point
// is to stop automated abuse (thousands of tries), not to throttle staff.
const limiter = (windowMinutes: number, max: number) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // A shared secret for cron/scheduler and provider webhooks already gates
    // those paths; they're mounted above this line anyway.
    message: { message: 'Too many attempts — wait a moment and try again.' }
  });
// Password login and reset: real logins are rare; brute-force is not.
app.use(['/api/auth/login', '/api/auth/password-reset/request'], limiter(15, 30));
// PIN login and manager approval: staff hit these all shift, so generous — but
// still fatal to an automated PIN sweep.
app.use(['/api/device/staff-pin-login', '/api/device/pin-login', '/api/pos/manager-approve'], limiter(5, 120));
// Gift-card public routes (the code is the only credential) and promo quoting:
// close the enumeration window.
app.use(['/api/gift-cards/redeem', '/api/gift-cards/promo/quote', '/api/gift-cards/session', '/api/gift-cards/print', '/api/gift-cards/qr'], limiter(5, 100));
// Reserve public routes create guest rows and Stripe intents anonymously.
app.use(['/api/reserve/public', '/api/reserve/public-widget'], limiter(10, 60));
// The print poll answers with no session (the station cuid + POS_PRINT_SECRET
// are the credential). Real printers poll every few seconds, so this is high —
// but still blunts a flood or an attempt to sweep station ids. Per venue-NAT-IP.
app.use('/api/pos/print-poll', limiter(1, 600));

// Auth middleware runs on every request — populates req.user from cookie and
// rejects API calls that aren't on the allowlist of public paths.
app.use(authMiddleware);

app.get('/', (_req, res) => {
  res.json({
    name: 'alma-suite-v18-api',
    version: '18.0.0',
    modules: [
      'issues',
      'checklists',
      'staff',
      'incidents',
      'temperatures',
      'audits',
      'reserve',
      'marketing',
      'gift-cards',
      'training',
      'settings',
      'admin',
      'integrations',
      'menu-mappings',
      'communications',
      'notifications',
      'search'
    ]
  });
});

app.get('/api/summary', async (_req, res, next) => {
  try {
    res.json({
      incidents: await incidentService.summary(),
      issues: await issueService.summary(),
      staff: await staffService.summary(),
      temperatures: await temperatureService.summary(),
      audits: await auditService.summary()
    });
  } catch (error) {
    next(error);
  }
});

app.use('/health', healthRouter);
app.use('/api/health', healthRouter);
app.use('/api/public', publicSnapshotRouter);
app.use('/api/auth', authRouter);
app.use('/api/issues', issuesRouter);
app.use('/api/tasks', almaTasksRouter);
app.use('/api/checklists', checklistsRouter);
app.use('/api/device', deviceRouter);
app.use('/api/pos', posRouter);
app.use('/api/qr', qrRouter);
app.use('/api/staff', staffRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/temperatures', temperaturesRouter);
app.use('/api/audits', auditsRouter);
app.use('/api/training', trainingRouter);
app.use('/api/licences', liquorRouter);
app.use('/api/licenses', liquorRouter);
app.use('/api/liquor', liquorRouter);
app.use('/api/admin', adminRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/menu-mappings', menuMappingsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/handbook-documents', handbookDocumentsRouter);
app.use('/api/shift-task-rules', shiftTaskRulesRouter);
app.use('/api/shift-task-assignments', shiftTaskAssignmentsRouter);
app.use('/api/communications', communicationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/forecast', forecastRouter);
app.use('/api/forecast-module', forecastModuleRouter);
app.use('/api/reserve', reserveRouter);
app.use('/api/marketing', marketingRouter);
app.use('/api/gift-cards', giftCardsRouter);
app.use('/api/search', searchRouter);
app.use('/api/website', websiteRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, env.host, () => {
  console.log(`API listening on http://${env.host}:${env.port}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `API port ${env.port} is already in use. Stop the existing API process or start this one with PORT=<free-port>.`
    );
    process.exit(1);
  }

  throw error;
});

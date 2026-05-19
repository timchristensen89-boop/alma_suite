import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { authMiddleware } from './lib/auth-middleware.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { adminRouter } from './routes/admin.js';
import { auditsRouter } from './routes/audits.js';
import { authRouter } from './routes/auth.js';
import { checklistsRouter } from './routes/checklists.js';
import { communicationsRouter } from './routes/communications.js';
import { commsRouter } from './routes/comms.js';
import { giftCardsRouter, stripeGiftCardWebhook } from './routes/gift-cards.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { integrationsRouter, squareWebhookReceiver, xeroWebhookReceiver } from './routes/integrations.js';
import { issuesRouter } from './routes/issues.js';
import { liquorRouter } from './routes/liquor.js';
import { marketingRouter } from './routes/marketing.js';
import { notificationsRouter } from './routes/notifications.js';
import { reportsRouter } from './routes/reports.js';
import { reserveRouter } from './routes/reserve.js';
import { searchRouter } from './routes/search.js';
import { settingsRouter } from './routes/settings.js';
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

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.post('/api/gift-cards/webhook', express.raw({ type: 'application/json' }), stripeGiftCardWebhook);
app.post('/webhooks/square', express.raw({ type: 'application/json', limit: '2mb' }), squareWebhookReceiver);
app.post('/webhooks/xero', express.raw({ type: 'application/json', limit: '2mb' }), xeroWebhookReceiver);
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());

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
app.use('/api/auth', authRouter);
app.use('/api/issues', issuesRouter);
app.use('/api/checklists', checklistsRouter);
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
app.use('/api/settings', settingsRouter);
app.use('/api/shift-task-rules', shiftTaskRulesRouter);
app.use('/api/shift-task-assignments', shiftTaskAssignmentsRouter);
app.use('/api/communications', communicationsRouter);
app.use('/api/comms', commsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);
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

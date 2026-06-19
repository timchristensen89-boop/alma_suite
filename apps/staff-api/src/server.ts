import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { authMiddleware } from './lib/auth-middleware.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { healthRouter } from './routes/health.js';
import { rosterRouter } from './routes/roster.js';
import { timesheetsRouter } from './routes/timesheets.js';
import { tipsRouter } from './routes/tips.js';
import { leaveRouter } from './routes/leave.js';
import { clockRouter } from './routes/clock.js';

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(authMiddleware);

app.get('/', (_req, res) => {
  res.json({
    name: 'alma-staff-api',
    version: '0.1.0',
    status: 'scaffold',
    modules: ['roster', 'timesheets', 'tips', 'leave', 'clock'],
    note: 'Workforce engine destination. Routes are stubs (501) until migrated from apps/api. See docs/SEPARATION_PLAN.md.'
  });
});

app.use('/health', healthRouter);
app.use('/api/health', healthRouter);
app.use('/api/roster', rosterRouter);
app.use('/api/timesheets', timesheetsRouter);
app.use('/api/tips', tipsRouter);
app.use('/api/leave', leaveRouter);
app.use('/api/clock', clockRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, env.host, () => {
  // eslint-disable-next-line no-console
  console.log(`[staff-api] listening on http://${env.host}:${env.port} (${env.isProduction ? 'production' : 'development'})`);
});

export { app, server };

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { env } from './env.js';
import { authMiddleware } from './lib/auth-middleware.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { communicationsRouter } from './routes/communications.js';
import { healthRouter } from './routes/health.js';
import { invoicesRouter } from './routes/invoices.js';
import { itemsRouter } from './routes/items.js';
import { notificationsRouter } from './routes/notifications.js';
import { operationsRouter } from './routes/operations.js';
import { recipesRouter } from './routes/recipes.js';
import { stocktakeRouter } from './routes/stocktake.js';
import { suppliersRouter } from './routes/suppliers.js';

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

app.get('/', (_req, res) => {
  res.json({
    name: 'alma-stock-api',
    version: '0.1.0',
    modules: ['items', 'stocktake', 'suppliers', 'invoices', 'recipes', 'communications', 'notifications', 'operations']
  });
});

app.use('/health', healthRouter);
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/communications', communicationsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/operations', operationsRouter);
app.use('/api/items', itemsRouter);
app.use('/api/stocktake', stocktakeRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/recipes', recipesRouter);
app.use('/stock-api/api/health', healthRouter);
app.use('/stock-api/api/auth', authRouter);
app.use('/stock-api/api/communications', communicationsRouter);
app.use('/stock-api/api/notifications', notificationsRouter);
app.use('/stock-api/api/operations', operationsRouter);
app.use('/stock-api/api/items', itemsRouter);
app.use('/stock-api/api/stocktake', stocktakeRouter);
app.use('/stock-api/api/suppliers', suppliersRouter);
app.use('/stock-api/api/invoices', invoicesRouter);
app.use('/stock-api/api/recipes', recipesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, env.host, () => {
  console.log(`Stock API listening on http://${env.host}:${env.port}`);
});

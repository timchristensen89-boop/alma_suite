import { Router } from 'express';
import { prisma } from '@alma/db';

export const healthRouter = Router();

/**
 * Liveness that actually tells the truth. The old handler returned
 * `{ ok: true }` unconditionally, so the API reported healthy with the
 * database down — the one failure mode a health check exists to catch.
 * SELECT 1 costs nothing; a 503 here is what lets a monitor (or a human
 * curling it) know service is actually broken before the floor does.
 */
healthRouter.get('/', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

import { Router } from 'express';

/**
 * Builds a placeholder router for a workforce feature that has not yet been
 * migrated out of the monolith `apps/api`. Every method returns 501 with a
 * pointer to where the real logic currently lives, so the destination URL space
 * is reserved and discoverable without exposing or mutating any data.
 */
export function makeStubRouter(feature: string, currentHome: string): Router {
  const router = Router();
  router.all('*', (req, res) => {
    res.status(501).json({
      message: `Workforce feature "${feature}" not yet migrated to staff-api`,
      method: req.method,
      path: req.originalUrl,
      currentlyServedBy: currentHome,
      tracking: 'docs/SEPARATION_PLAN.md (Phase 3)'
    });
  });
  return router;
}

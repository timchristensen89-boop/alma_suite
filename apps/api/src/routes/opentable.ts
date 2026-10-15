import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  openTableMenusPublishInputSchema,
  openTableProfileInputSchema,
  openTableProfilePublishInputSchema,
  openTableVenueSettingsInputSchema
} from '@alma/shared';
import { requireAdmin } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import { assertMenuPublisher, assertMenuVenueAccess } from '../lib/menu-access.js';
import { openTableService } from '../services/opentable.service.js';

/**
 * /api/integrations/opentable — the free OpenTable APIs (Menus Partner,
 * Restaurant Content Partner).
 *
 * Alma admins only (`requireAdmin`: the isAdmin flag, not a settings grant).
 * Venue managers keep their existing venue-scoped publishing in Alma Menus
 * and get nothing here. On top of that, every venue route applies the Menus
 * venue scope and the menu push applies canPublishMenus(user, venue), so an
 * admin whose Menus grant is limited to one venue cannot push the other's
 * menus (out of scope reads as 404, not a publisher reads as 403).
 *
 * Nothing here calls OpenTable unless the server flags allow it; the service
 * records a SKIPPED run otherwise.
 */
export const openTableRouter = Router();

openTableRouter.use(requireAdmin);

const VENUE_NOT_FOUND = 'That venue does not exist.';

function venueScope(req: Request, _res: Response, next: NextFunction) {
  assertMenuVenueAccess(req.user, { venueId: String(req.params.venueId) }, VENUE_NOT_FOUND)
    .then((venue) => {
      if (!venue) throw new HttpError(404, VENUE_NOT_FOUND);
      next();
    })
    .catch(next);
}

function venuePublisher(req: Request, _res: Response, next: NextFunction) {
  assertMenuPublisher(req.user, { venueId: String(req.params.venueId) }, VENUE_NOT_FOUND)
    .then((venue) => {
      if (!venue) throw new HttpError(404, VENUE_NOT_FOUND);
      next();
    })
    .catch(next);
}

function user(req: Request) {
  if (!req.user) throw new HttpError(401, 'You’re not signed in. Sign in with your Alma account.');
  return req.user;
}

openTableRouter.get('/', async (req, res, next) => {
  try {
    res.json(await openTableService.overview(user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.get('/venues/:venueId', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.status(String(req.params.venueId), user(req), { refreshConnection: req.query.refresh === '1' }));
  } catch (error) {
    next(error);
  }
});

openTableRouter.put('/venues/:venueId/settings', venueScope, async (req, res, next) => {
  try {
    await openTableService.saveSettings(String(req.params.venueId), openTableVenueSettingsInputSchema.parse(req.body));
    res.json(await openTableService.status(String(req.params.venueId), user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.post('/venues/:venueId/connection/check', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.checkConnection(String(req.params.venueId), user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.get('/venues/:venueId/menus/preview', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.previewMenus(String(req.params.venueId)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.post('/venues/:venueId/menus/publish', venuePublisher, async (req, res, next) => {
  try {
    res.json(await openTableService.publishMenus(String(req.params.venueId), openTableMenusPublishInputSchema.parse(req.body), user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.post('/venues/:venueId/menus/read', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.readRemoteMenus(String(req.params.venueId), user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.put('/venues/:venueId/profile', venueScope, async (req, res, next) => {
  try {
    const input = openTableProfileInputSchema.parse(req.body);
    await openTableService.saveProfile(String(req.params.venueId), input.profile, input.managedFields);
    res.json(await openTableService.status(String(req.params.venueId), user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.get('/venues/:venueId/profile/preview', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.previewProfile(String(req.params.venueId)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.post('/venues/:venueId/profile/publish', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.publishProfile(String(req.params.venueId), openTableProfilePublishInputSchema.parse(req.body), user(req)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.get('/venues/:venueId/activity', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.activity(String(req.params.venueId), Number(req.query.limit ?? 100)));
  } catch (error) {
    next(error);
  }
});

openTableRouter.get('/venues/:venueId/activity/:runId', venueScope, async (req, res, next) => {
  try {
    res.json(await openTableService.run(String(req.params.venueId), String(req.params.runId)));
  } catch (error) {
    next(error);
  }
});

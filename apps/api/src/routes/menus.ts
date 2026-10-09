import { Router } from 'express';
import { canAccessMenuVenue } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { assertMenuVenueAccess, fromMenuParam, fromVenueBody, fromVersionParam, requireMenuPublisherFor, requireMenuVenueAccess } from '../lib/menu-access.js';
import { menuService } from '../services/menu.service.js';
import { promotionsRouter } from './promotions.js';

export const menusRouter = Router();

/**
 * Permissions, in one place (the rules themselves are in
 * packages/shared/src/menus.ts; the venue resolution in ../lib/menu-access.ts):
 *
 *   read, draft, save, discard, restore, copy   anyone with Menus access, on the
 *                                               venues their grant allows — a
 *                                               menu of another venue reads as
 *                                               not found
 *   publish, new menu, rename, archive          admins, or a Menus grant at
 *                                               MANAGER/ADMIN level or with
 *                                               "Publish menus" ticked, again
 *                                               only on the venues it allows
 *
 * Shared venue iPads can read and never write; the auth middleware enforces that
 * before any route here runs.
 */
const readMenu = requireMenuVenueAccess(fromMenuParam);
const readVersion = requireMenuVenueAccess(fromVersionParam);
const publishMenu = requireMenuPublisherFor(fromMenuParam);

menusRouter.get('/', async (req, res, next) => {
  try {
    const home = await menuService.home();
    const user = req.user;
    const inScope = (slug: string) => canAccessMenuVenue(user, slug);
    res.json({
      ...home,
      menus: home.menus.filter((menu) => inScope(menu.venue.slug)),
      archived: home.archived.filter((menu) => inScope(menu.venue.slug)),
      venues: home.venues.filter((venue) => inScope(venue.slug))
    });
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/', requireMenuPublisherFor(fromVenueBody), async (req, res, next) => {
  try {
    const copyFrom = (req.body as { copyFromMenuId?: unknown } | undefined)?.copyFromMenuId;
    if (typeof copyFrom === 'string' && copyFrom) await assertMenuVenueAccess(req.user, { menuId: copyFrom });
    res.status(201).json(await menuService.createMenu(req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

// Static segments before '/:menuId'.
// Promotions (What's On listings and their cards) share the module's access.
menusRouter.use('/promotions', promotionsRouter);

menusRouter.get('/versions/:versionId', readVersion, async (req, res, next) => {
  try {
    res.json(await menuService.getVersion(String(req.params.versionId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/versions/:versionId/pdf', readVersion, async (req, res, next) => {
  try {
    const { filename, bytes } = await menuService.getVersionPdf(String(req.params.versionId));
    res.setHeader('Content-Type', 'application/pdf');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.send(bytes);
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/versions/:versionId/diff', readVersion, async (req, res, next) => {
  try {
    const against = typeof req.query.against === 'string' && req.query.against ? req.query.against : 'draft';
    res.json(await menuService.diffVersion(String(req.params.versionId), against));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/versions/:versionId/restore', readVersion, async (req, res, next) => {
  try {
    res.status(201).json(await menuService.restore(String(req.params.versionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId', readMenu, async (req, res, next) => {
  try {
    res.json(await menuService.get(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.patch('/:menuId', publishMenu, async (req, res, next) => {
  try {
    res.json(await menuService.updateMenu(String(req.params.menuId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/archive', publishMenu, async (req, res, next) => {
  try {
    res.json(await menuService.archiveMenu(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/unarchive', publishMenu, async (req, res, next) => {
  try {
    res.json(await menuService.unarchiveMenu(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId/draft', readMenu, async (req, res, next) => {
  try {
    res.json(await menuService.getDraft(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft', readMenu, async (req, res, next) => {
  try {
    res.status(201).json(await menuService.createDraft(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.put('/:menuId/draft', readMenu, async (req, res, next) => {
  try {
    res.json(await menuService.saveDraft(String(req.params.menuId), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.delete('/:menuId/draft', readMenu, async (req, res, next) => {
  try {
    res.json(await menuService.discardDraft(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft/preview', readMenu, async (req, res, next) => {
  try {
    res.json(await menuService.publishPreview(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft/publish', publishMenu, async (req, res, next) => {
  try {
    res.status(201).json(await menuService.publish(String(req.params.menuId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft/items/copy-to', readMenu, async (req, res, next) => {
  try {
    const target = (req.body as { targetMenuId?: unknown } | undefined)?.targetMenuId;
    if (typeof target === 'string' && target) await assertMenuVenueAccess(req.user, { menuId: target });
    res.status(201).json(await menuService.copyItemTo(String(req.params.menuId), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId/versions', readMenu, async (req, res, next) => {
  try {
    res.json(await menuService.listVersions(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId/audit', readMenu, async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json(await menuService.listAudit(String(req.params.menuId), Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    next(error);
  }
});

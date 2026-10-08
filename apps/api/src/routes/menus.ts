import { Router, type NextFunction, type Request, type Response } from 'express';
import { canPublishMenus } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { menuService } from '../services/menu.service.js';
import { promotionsRouter } from './promotions.js';

export const menusRouter = Router();

/**
 * Permissions, in one place:
 *
 *   read, draft, save, discard, restore, copy   anyone the auth middleware lets
 *                                               into /api/menus (MENUS or
 *                                               COMPLIANCE access)
 *   publish, new menu, rename, archive          managers, admins, the head
 *                                               chef (role title), or a MENUS
 *                                               grant at MANAGER/ADMIN or with
 *                                               "Publish menus" ticked — the
 *                                               rule in canPublishMenus, which
 *                                               the home and editor use to hide
 *                                               those buttons from everyone else
 *
 * Shared venue iPads can read and never write; the auth middleware enforces that
 * before any route here runs.
 */
export function requireMenuPublisher(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'You’re not signed in. Sign in with your Alma account.'));
  if (!canPublishMenus(req.user)) {
    return next(new HttpError(403, 'Publishing a menu is for managers and the head chef. Save your draft and ask one of them to publish it.'));
  }
  return next();
}

menusRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await menuService.home());
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/', requireMenuPublisher, async (req, res, next) => {
  try {
    res.status(201).json(await menuService.createMenu(req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

// Static segments before '/:menuId'.
// Promotions (What's On listings and their cards) share the module's access.
menusRouter.use('/promotions', promotionsRouter);

menusRouter.get('/versions/:versionId', async (req, res, next) => {
  try {
    res.json(await menuService.getVersion(String(req.params.versionId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/versions/:versionId/pdf', async (req, res, next) => {
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

menusRouter.get('/versions/:versionId/diff', async (req, res, next) => {
  try {
    const against = typeof req.query.against === 'string' && req.query.against ? req.query.against : 'draft';
    res.json(await menuService.diffVersion(String(req.params.versionId), against));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/versions/:versionId/restore', async (req, res, next) => {
  try {
    res.status(201).json(await menuService.restore(String(req.params.versionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId', async (req, res, next) => {
  try {
    res.json(await menuService.get(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.patch('/:menuId', requireMenuPublisher, async (req, res, next) => {
  try {
    res.json(await menuService.updateMenu(String(req.params.menuId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/archive', requireMenuPublisher, async (req, res, next) => {
  try {
    res.json(await menuService.archiveMenu(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/unarchive', requireMenuPublisher, async (req, res, next) => {
  try {
    res.json(await menuService.unarchiveMenu(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId/draft', async (req, res, next) => {
  try {
    res.json(await menuService.getDraft(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft', async (req, res, next) => {
  try {
    res.status(201).json(await menuService.createDraft(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.put('/:menuId/draft', async (req, res, next) => {
  try {
    res.json(await menuService.saveDraft(String(req.params.menuId), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.delete('/:menuId/draft', async (req, res, next) => {
  try {
    res.json(await menuService.discardDraft(String(req.params.menuId), req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft/preview', async (req, res, next) => {
  try {
    res.json(await menuService.publishPreview(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft/publish', requireMenuPublisher, async (req, res, next) => {
  try {
    res.status(201).json(await menuService.publish(String(req.params.menuId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.post('/:menuId/draft/items/copy-to', async (req, res, next) => {
  try {
    res.status(201).json(await menuService.copyItemTo(String(req.params.menuId), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId/versions', async (req, res, next) => {
  try {
    res.json(await menuService.listVersions(String(req.params.menuId)));
  } catch (error) {
    next(error);
  }
});

menusRouter.get('/:menuId/audit', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    res.json(await menuService.listAudit(String(req.params.menuId), Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    next(error);
  }
});

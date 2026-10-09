import { Router } from 'express';
import { requireMenuPublisher } from './menus.js';
import { promotionService } from '../services/promotion.service.js';

/**
 * Promotions — the What's On listings and their printed cards, managed from
 * Menus. Mounted under /api/menus/promotions so the module's access rule
 * applies (auth-middleware lets MENUS or COMPLIANCE access in; shared venue
 * iPads read only).
 *
 *   read, edit the working copy, photo, preview   anyone the middleware lets in
 *   new, publish, hide, show, end                  managers, admins, the head chef
 *                                                  (requireMenuPublisher, as for menus)
 */
export const promotionsRouter = Router();

promotionsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await promotionService.list());
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post('/', requireMenuPublisher, async (req, res, next) => {
  try {
    res.status(201).json(await promotionService.create(req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.get('/:promotionId', async (req, res, next) => {
  try {
    res.json(await promotionService.get(String(req.params.promotionId)));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.patch('/:promotionId', async (req, res, next) => {
  try {
    res.json(await promotionService.update(String(req.params.promotionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.put('/:promotionId/image', async (req, res, next) => {
  try {
    res.json(await promotionService.setImage(String(req.params.promotionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.delete('/:promotionId/image', async (req, res, next) => {
  try {
    res.json(await promotionService.removeImage(String(req.params.promotionId), req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.get('/:promotionId/preview', async (req, res, next) => {
  try {
    res.json(await promotionService.publishPreview(String(req.params.promotionId)));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post('/:promotionId/publish', requireMenuPublisher, async (req, res, next) => {
  try {
    res.json(await promotionService.publish(String(req.params.promotionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

for (const action of ['hide', 'show', 'end'] as const) {
  promotionsRouter.post(`/:promotionId/${action}`, requireMenuPublisher, async (req, res, next) => {
    try {
      res.json(await promotionService.setStatus(String(req.params.promotionId), action, req.user));
    } catch (error) {
      next(error);
    }
  });
}

promotionsRouter.get('/:promotionId/audit', async (req, res, next) => {
  try {
    res.json(await promotionService.listAudit(String(req.params.promotionId)));
  } catch (error) {
    next(error);
  }
});

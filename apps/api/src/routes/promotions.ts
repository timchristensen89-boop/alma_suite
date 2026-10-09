import { Router } from 'express';
import { canAccessMenuVenue } from '@alma/shared';
import { assertMenuVenueAccess, fromPromotionParam, fromVenueBody, PROMOTION_NOT_FOUND, requireMenuPublisherFor, requireMenuVenueAccess } from '../lib/menu-access.js';
import { promotionService } from '../services/promotion.service.js';

/**
 * Promotions — the What's On listings and their printed cards, managed from
 * Menus. Mounted under /api/menus/promotions so the module's access rule
 * applies (auth-middleware lets MENUS or COMPLIANCE access in; shared venue
 * iPads read only).
 *
 *   read, edit the working copy, photo, preview   anyone with Menus access, on the
 *                                                  venues their grant allows
 *   new, publish, hide, show, end                  publishers for that venue
 *                                                  (the same rule as menus)
 */
export const promotionsRouter = Router();

const readPromotion = requireMenuVenueAccess(fromPromotionParam, PROMOTION_NOT_FOUND);
const publishPromotion = requireMenuPublisherFor(fromPromotionParam, PROMOTION_NOT_FOUND);

promotionsRouter.get('/', async (req, res, next) => {
  try {
    const payload = await promotionService.list();
    res.json({ ...payload, promotions: payload.promotions.filter((promotion) => canAccessMenuVenue(req.user, promotion.venue.slug)) });
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post('/', requireMenuPublisherFor(fromVenueBody), async (req, res, next) => {
  try {
    const menuId = (req.body as { menuId?: unknown } | undefined)?.menuId;
    if (typeof menuId === 'string' && menuId) await assertMenuVenueAccess(req.user, { menuId });
    res.status(201).json(await promotionService.create(req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.get('/:promotionId', readPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.get(String(req.params.promotionId)));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.patch('/:promotionId', readPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.update(String(req.params.promotionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.put('/:promotionId/image', readPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.setImage(String(req.params.promotionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.delete('/:promotionId/image', readPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.removeImage(String(req.params.promotionId), req.user));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.get('/:promotionId/preview', readPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.publishPreview(String(req.params.promotionId)));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post('/:promotionId/publish', publishPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.publish(String(req.params.promotionId), req.body ?? {}, req.user));
  } catch (error) {
    next(error);
  }
});

for (const action of ['hide', 'show', 'end'] as const) {
  promotionsRouter.post(`/:promotionId/${action}`, publishPromotion, async (req, res, next) => {
    try {
      res.json(await promotionService.setStatus(String(req.params.promotionId), action, req.user));
    } catch (error) {
      next(error);
    }
  });
}

promotionsRouter.get('/:promotionId/audit', readPromotion, async (req, res, next) => {
  try {
    res.json(await promotionService.listAudit(String(req.params.promotionId)));
  } catch (error) {
    next(error);
  }
});

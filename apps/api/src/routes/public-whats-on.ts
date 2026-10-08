import { Router } from 'express';
import { promotionService } from '../services/promotion.service.js';

/**
 * What the public website reads for What's On: the latest publication of
 * every PUBLISHED promotion that is running today, and the listing photos by
 * content hash. No session (lib/public-paths.ts); nothing here can reach a
 * draft, a hidden or ended promotion, or an unpublished edit — the service
 * serves publication snapshots only.
 *
 *   GET /api/public/whats-on                          → PublicWhatsOn (both venues)
 *   GET /api/public/whats-on/:venueSlug               → PublicWhatsOn (one venue)
 *   GET /api/public/promotion-images/:fingerprint     → image bytes, immutable
 */
export const publicWhatsOnRouter = Router();
export const publicPromotionImagesRouter = Router();

const CACHE = 'public, max-age=300, stale-while-revalidate=600';
const IMMUTABLE = 'public, max-age=31536000, immutable';

publicWhatsOnRouter.get('/', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', CACHE);
    res.json(await promotionService.whatsOn(null));
  } catch (error) {
    next(error);
  }
});

publicWhatsOnRouter.get('/:venueSlug', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', CACHE);
    res.json(await promotionService.whatsOn(String(req.params.venueSlug)));
  } catch (error) {
    next(error);
  }
});

publicPromotionImagesRouter.get('/:fingerprint', async (req, res, next) => {
  try {
    const image = await promotionService.publicImage(String(req.params.fingerprint).replace(/\.\w+$/, ''));
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(image.bytes.length));
    res.setHeader('Cache-Control', IMMUTABLE);
    res.setHeader('Content-Disposition', `inline; filename="${image.fileName.replace(/"/g, '')}"`);
    res.send(image.bytes);
  } catch (error) {
    next(error);
  }
});

import { Router } from 'express';
import { menuService } from '../services/menu.service.js';

/**
 * What the public website reads: the published, PUBLIC menus of a venue, one
 * menu's snapshot for in-page rendering, and its live PDF. No session — these
 * paths are listed in lib/public-paths.ts — and nothing here can reach a
 * draft, an archived menu or a private-event menu (the service refuses with a
 * flat 404). Responses are cacheable for a few minutes; the website appends
 * the version id as a cache-buster when it wants the newest publish at once.
 *
 *   GET /api/public/menus/:venueSlug                 → { venue, menus[] }
 *   GET /api/public/menus/:venueSlug/:menuSlug.json  → PublicMenuDocument
 *   GET /api/public/menus/:venueSlug/:menuSlug.pdf   → application/pdf (the live version)
 *   GET /api/public/menus/version/:versionId.pdf     → application/pdf, immutable (one publish)
 */
export const publicMenusRouter = Router();

const CACHE = 'public, max-age=300, stale-while-revalidate=600';
const IMMUTABLE = 'public, max-age=31536000, immutable';

// Static segment before '/:venueSlug': a published version's PDF by id, the
// link a What's On listing carries so it keeps pointing at what it listed.
publicMenusRouter.get('/version/:versionId.pdf', async (req, res, next) => {
  try {
    const { filename, bytes, generatedAt } = await menuService.publicMenuVersionPdf(String(req.params.versionId));
    res.setHeader('Content-Type', 'application/pdf');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', IMMUTABLE);
    if (generatedAt) res.setHeader('Last-Modified', generatedAt.toUTCString());
    res.send(bytes);
  } catch (error) {
    next(error);
  }
});

publicMenusRouter.get('/:venueSlug', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', CACHE);
    res.json(await menuService.publicMenus(String(req.params.venueSlug)));
  } catch (error) {
    next(error);
  }
});

publicMenusRouter.get('/:venueSlug/:menuSlug.json', async (req, res, next) => {
  try {
    const payload = await menuService.publicMenu(String(req.params.venueSlug), String(req.params.menuSlug));
    res.setHeader('Cache-Control', CACHE);
    res.setHeader('ETag', `"${payload.versionId}"`);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

publicMenusRouter.get('/:venueSlug/:menuSlug.pdf', async (req, res, next) => {
  try {
    const { filename, bytes, versionId, generatedAt } = await menuService.publicMenuPdf(String(req.params.venueSlug), String(req.params.menuSlug));
    res.setHeader('Content-Type', 'application/pdf');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', CACHE);
    res.setHeader('ETag', `"${versionId}"`);
    if (generatedAt) res.setHeader('Last-Modified', generatedAt.toUTCString());
    res.send(bytes);
  } catch (error) {
    next(error);
  }
});

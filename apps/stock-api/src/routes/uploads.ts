import { Router } from 'express';
import { uploadsService } from '../services/uploads.service.js';

export const uploadsRouter = Router();

// POST /api/uploads/sign — returns a short-lived signed PUT URL for the
// browser to upload directly to Cloud Storage.
uploadsRouter.post('/sign', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const folder = typeof body.folder === 'string' ? body.folder : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    const filename = typeof body.filename === 'string' ? body.filename : undefined;
    if (!['deliveries', 'gift-cards', 'compliance', 'marketing'].includes(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    const result = await uploadsService.signUploadUrl({
      folder: folder as 'deliveries' | 'gift-cards' | 'compliance' | 'marketing',
      mimeType,
      filename
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/uploads/view — exchanges a stored gs:// path for a 1-hour
// signed read URL the browser can display.
uploadsRouter.post('/view', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const path = typeof body.path === 'string' ? body.path : '';
    const url = await uploadsService.signReadUrl(path);
    if (!url) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/uploads — remove an uploaded object. Best-effort.
uploadsRouter.delete('/', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const path = typeof body.path === 'string' ? body.path : '';
    await uploadsService.deleteObject(path);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

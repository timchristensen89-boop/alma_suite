import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import { handbookDocumentService } from '../services/handbook-document.service.js';

export const handbookDocumentsRouter = Router();

/**
 * Listing is open to any signed-in user. The handbook is the one thing every
 * staff member is supposed to read, so gating it behind a manager role would
 * defeat the point of having it.
 */
handbookDocumentsRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'You’re not signed in. Sign in with your Alma account.');
    const venue = typeof req.query.venue === 'string' ? req.query.venue : req.user.venue;
    res.json(await handbookDocumentService.list(venue));
  } catch (error) {
    next(error);
  }
});

handbookDocumentsRouter.get('/:id/file', async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'You’re not signed in. Sign in with your Alma account.');
    const doc = await handbookDocumentService.file(String(req.params.id));
    res.setHeader('Content-Type', doc.mimeType);
    // inline so a PDF opens in the phone's viewer instead of landing in Files.
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/"/g, '')}"`);
    res.send(Buffer.from(doc.data));
  } catch (error) {
    next(error);
  }
});

handbookDocumentsRouter.post('/', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await handbookDocumentService.upload(req.body, req.user?.id ?? null));
  } catch (error) {
    next(error);
  }
});

handbookDocumentsRouter.patch('/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await handbookDocumentService.update(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

handbookDocumentsRouter.delete('/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await handbookDocumentService.remove(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

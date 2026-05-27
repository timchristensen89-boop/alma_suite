// Sprint 2 — Loaded CSV import endpoints.
//
// Two-step preview → commit for both item catalogue and historical
// stocktake imports. Manager + admin only (service double-checks).

import { Router } from 'express';
import { loadedImportService } from '../services/loaded-import.service.js';

export const importsRouter = Router();

// Item catalogue ────────────────────────────────────────────────
importsRouter.post('/loaded/items/preview', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    res.json(await loadedImportService.previewItemImport(req.user, csv));
  } catch (error) {
    next(error);
  }
});

importsRouter.post('/loaded/items/commit', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    res.json(await loadedImportService.commitItemImport(req.user, csv));
  } catch (error) {
    next(error);
  }
});

// Historical stocktakes ─────────────────────────────────────────
importsRouter.post('/loaded/stocktakes/preview', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    res.json(await loadedImportService.previewStocktakeImport(req.user, csv));
  } catch (error) {
    next(error);
  }
});

importsRouter.post('/loaded/stocktakes/commit', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const skipUnmatched = req.body?.skipUnmatched !== false; // default true
    res.json(await loadedImportService.commitStocktakeImport(req.user, csv, { skipUnmatched }));
  } catch (error) {
    next(error);
  }
});

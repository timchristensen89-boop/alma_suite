import { Router } from 'express';
import { requireStockManager, requireStockUser } from '../lib/stock-permissions.js';
import { stocktakesService } from '../services/stocktakes.service.js';
import { listPrepRecipeOptions } from '../services/prep-recipes.service.js';
import { stockReportsService } from '../services/stock-reports.service.js';

export const stocktakeRouter = Router();

stocktakeRouter.get('/', async (req, res, next) => {
  try {
    res.json(await stocktakesService.list(req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/summary', async (req, res, next) => {
  try {
    res.json(await stocktakesService.summary(req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/review', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.reviewQueue(req.user));
  } catch (error) {
    next(error);
  }
});

// Per-venue status for suite reports (registered before '/:id').
stocktakeRouter.get('/venue-status', async (req, res, next) => {
  try {
    res.json(await stocktakesService.venueStatus({ venue: typeof req.query.venue === 'string' ? req.query.venue : null }));
  } catch (error) {
    next(error);
  }
});

// Stock summary block for suite reports (registered before '/:id').
stocktakeRouter.get('/stock-summary', async (req, res, next) => {
  try {
    res.json(await stockReportsService.buildStockSummary({
      venue: typeof req.query.venue === 'string' ? req.query.venue : null,
      sinceISO: typeof req.query.since === 'string' ? req.query.since : new Date(0).toISOString()
    }));
  } catch (error) {
    next(error);
  }
});

// Every active prep recipe offered as a countable made item, each carrying
// whether it can actually be exploded into ingredients (registered before
// '/:id'). Readable by anyone who can count, so the iPad can add a tub of
// something the sheet forgot.
stocktakeRouter.get('/prep-recipes', async (req, res, next) => {
  try {
    requireStockUser(req.user);
    res.json({ prepRecipes: await listPrepRecipeOptions() });
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/apply', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.applyStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/approve', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.applyStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

// What the prepped-item lines will book, without writing anything. The check
// a manager runs before approving: a prep line that explodes into nothing is
// the failure worth catching before it reaches the ledger, not after.
stocktakeRouter.get('/:id/prep-preview', async (req, res, next) => {
  try {
    requireStockUser(req.user);
    res.json(await stocktakesService.prepPreview(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id/movements', async (req, res, next) => {
  try {
    res.json(await stocktakesService.getMovementHistory(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/corrections', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.createCorrection(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reverse', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.reverseStocktake(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await stocktakesService.get(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await stocktakesService.createStocktake(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.delete('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.deleteStocktakes(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reopen', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.reopenStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

// The one write on this router open to non-managers: entering counts. Staff
// count the shelves, managers own the count's identity and its state machine,
// so updateStocktake narrows a non-manager's payload to lines and notes and
// refuses anything but an open stocktake. Everything else here stays
// requireStockManager.
stocktakeRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockUser(req.user);
    res.json(await stocktakesService.updateStocktake(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

// Loaded replacement state machine endpoints — IN_PROGRESS → SUBMITTED →
// REVIEWED → LOCKED. Reopen with reason flips any of those back to
// REOPENED. See stocktakes.service.ts for full guards.
stocktakeRouter.post('/:id/submit', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.submitStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/review', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    res.json(await stocktakesService.reviewStocktake(String(req.params.id), req.user, { notes }));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/lock', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.lockStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reopen-with-reason', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    res.json(await stocktakesService.reopenStocktakeWithReason(String(req.params.id), req.user, reason));
  } catch (error) {
    next(error);
  }
});

// Printable count sheet. Open to anyone who can count — the counter prints
// it — and it never carries values, only quantities.
stocktakeRouter.get('/:id/count-sheet', async (req, res, next) => {
  try {
    requireStockUser(req.user);
    const blind = req.query.blind === undefined ? undefined : req.query.blind !== '0' && req.query.blind !== 'false';
    res.json(await stocktakesService.countSheet(String(req.params.id), req.user, { blind }));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id/export.csv', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const { filename, csv } = await stocktakesService.exportCsv(String(req.params.id), req.user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // Header values must be Latin-1. Every count this business has ever named
    // uses an em dash ("Alma Avalon — Fri 31st Jul"), which threw
    // "Invalid character in header content" and turned every export into a 500.
    // Send an ASCII-folded filename plus the RFC 5987 UTF-8 form.
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '-').replace(/"/g, '');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// Variance report — compares this stocktake against the previous LOCKED
// stocktake at the same venue. Sorted by absolute value variance so
// the worst surprises bubble to the top.
stocktakeRouter.get('/:id/variance', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.varianceReport(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import { financialDocumentService } from '../services/financial-document.service.js';

export const financialDocumentsRouter = Router();

/**
 * Settings, companies, credit notes and voids change what the business has
 * told the ATO, so they sit with the owner — the same person the gift card
 * promo-code gate names. Reading, issuing and emailing are manager work.
 */
function requireInvoiceOwner(req: Request, res: Response, next: NextFunction) {
  requireManager(req, res, (error?: unknown) => {
    if (error) return next(error);
    if (!financialDocumentService.isInvoiceOwner(req.user)) {
      return next(new HttpError(403, 'Only Tim can change invoicing settings, raise credit notes or void documents.'));
    }
    return next();
  });
}

function queryText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Static paths first: '/settings' and '/entities' must not be read as a document id.
financialDocumentsRouter.get('/settings', requireManager, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.getSettings(req.user));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.patch('/settings', requireInvoiceOwner, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.updateSettings(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.get('/entities', requireManager, async (_req, res, next) => {
  try {
    res.json(await financialDocumentService.listEntities());
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.post('/entities', requireInvoiceOwner, async (req, res, next) => {
  try {
    res.status(201).json(await financialDocumentService.createEntity(req.body));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.patch('/entities/:id', requireInvoiceOwner, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.updateEntity(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.get('/', requireManager, async (req, res, next) => {
  try {
    res.json(
      await financialDocumentService.list({
        query: queryText(req.query.query),
        type: queryText(req.query.type),
        status: queryText(req.query.status),
        from: queryText(req.query.from),
        to: queryText(req.query.to),
        legalEntityId: queryText(req.query.legalEntityId),
        giftCardCode: queryText(req.query.giftCardCode)
      })
    );
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.get('/gift-cards/:code', requireManager, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.forGiftCard(String(req.params.code)));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.post('/gift-cards/:code/issue', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await financialDocumentService.issueForGiftCard(String(req.params.code), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.get('/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.get(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.get('/:id/pdf', requireManager, async (req, res, next) => {
  try {
    const { filename, bytes } = await financialDocumentService.pdf(String(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    // inline so it opens in the browser's viewer; the web app names the download itself.
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.post('/:id/email', requireManager, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.email(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.post('/:id/credit-notes', requireInvoiceOwner, async (req, res, next) => {
  try {
    res.status(201).json(await financialDocumentService.createCreditNote(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

financialDocumentsRouter.post('/:id/void', requireInvoiceOwner, async (req, res, next) => {
  try {
    res.json(await financialDocumentService.void(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

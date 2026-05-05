import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { marketingService } from '../services/marketing.service.js';

export const marketingRouter = Router();

marketingRouter.get('/overview', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.overview({
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/contacts', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createContact(req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/contacts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateContact(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/sync-reserve-guests', requireManager, async (_req, res, next) => {
  try {
    res.json(await marketingService.syncReserveGuests());
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/segments', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createSegment(req.body));
  } catch (error) {
    next(error);
  }
});

marketingRouter.post('/campaigns', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await marketingService.createCampaign(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

marketingRouter.patch('/campaigns/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await marketingService.updateCampaign(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

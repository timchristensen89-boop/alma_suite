import { Router } from 'express';
import { searchService } from '../services/search.service.js';

export const searchRouter = Router();

searchRouter.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(await searchService.search(q));
  } catch (error) {
    next(error);
  }
});

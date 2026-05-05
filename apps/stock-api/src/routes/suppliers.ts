import { Router } from 'express';
import { suppliersService } from '../services/suppliers.service.js';

export const suppliersRouter = Router();

suppliersRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await suppliersService.list());
  } catch (error) {
    next(error);
  }
});

suppliersRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await suppliersService.summary());
  } catch (error) {
    next(error);
  }
});

suppliersRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await suppliersService.createSupplier(req.body));
  } catch (error) {
    next(error);
  }
});

suppliersRouter.delete('/', async (req, res, next) => {
  try {
    res.json(await suppliersService.deleteSuppliers(req.body));
  } catch (error) {
    next(error);
  }
});

suppliersRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await suppliersService.updateSupplier(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

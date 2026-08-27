import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { recipesService } from '../services/recipes.service.js';

export const recipesRouter = Router();

recipesRouter.get('/', async (req, res, next) => {
  try {
    const raw = req.query.withSales;
    const parsed = typeof raw === 'string' && raw.trim() !== ''
      ? Number.parseInt(raw, 10)
      : null;
    res.json(await recipesService.list({
      withSalesLookbackDays: Number.isFinite(parsed) ? parsed : null
    }));
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await recipesService.summary());
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/export.csv', async (_req, res, next) => {
  try {
    const { filename, csv } = await recipesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/cost-of-goods', async (req, res, next) => {
  try {
    const days = Number(req.query.days);
    res.json(
      await recipesService.costOfGoods({
        venue: typeof req.query.venue === 'string' ? req.query.venue : null,
        days: Number.isFinite(days) ? days : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/categories', async (_req, res, next) => {
  try {
    res.json(await recipesService.listCategories());
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/ingredient-options', async (_req, res, next) => {
  try {
    res.json(await recipesService.ingredientOptions());
  } catch (error) {
    next(error);
  }
});

recipesRouter.post('/categories', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await recipesService.createCategory(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/categories/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.updateCategory(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// ── Price windows (Taco Tuesday etc.) ────────────────────────────────────
// The whole write path for weekday pricing — the register/QR read the rows
// live, so a manager edits here instead of anyone running a script.

recipesRouter.get('/:id/price-windows', async (req, res, next) => {
  try {
    res.json(await recipesService.listPriceWindows(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

recipesRouter.post('/:id/price-windows', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await recipesService.createPriceWindow(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/price-windows/:windowId', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.updatePriceWindow(String(req.params.windowId), req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.delete('/price-windows/:windowId', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.deletePriceWindow(String(req.params.windowId)));
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/:id/cost', async (req, res, next) => {
  try {
    res.json(await recipesService.cost(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Live cost preview for an unsaved recipe draft (builder cost-as-you-type).
recipesRouter.post('/cost-preview', async (req, res, next) => {
  try {
    res.json(await recipesService.costPreview(req.body));
  } catch (error) {
    next(error);
  }
});

// Portioned products ("serves"): a parent (stock item or bulk recipe) and its
// child sellable recipes.
recipesRouter.get('/portion-tree', async (req, res, next) => {
  try {
    const parentType = req.query.parentType === 'recipe' ? 'recipe' : 'item';
    const parentId = String(req.query.parentId ?? '');
    res.json(await recipesService.portionTree(parentType, parentId));
  } catch (error) {
    next(error);
  }
});

recipesRouter.post('/portions', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.createPortions(req.body));
  } catch (error) {
    next(error);
  }
});

// Rule 1: cost-sanity check. Returns warnings if a recipe's estimated
// cost looks "stupidly expensive" (likely a unit / conversion mistake).
// The recipe detail UI surfaces this above the line list.
recipesRouter.get('/:id/sanity', async (req, res, next) => {
  try {
    const { recipeCostSanity } = await import('../services/stock-rules.service.js');
    res.json(await recipeCostSanity(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Square catalog items flagged as set-menu components ("*" suffix / "BB "
// prefix) with their mapped recipe, for the set-menu builder's quick-add.
recipesRouter.get('/set-menu-components', async (_req, res, next) => {
  try {
    res.json(await recipesService.setMenuComponents());
  } catch (error) {
    next(error);
  }
});

// Add a component recipe as a line on one, several, or all set menus.
recipesRouter.post('/set-menus/add-component', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.addComponentToSetMenus(req.body));
  } catch (error) {
    next(error);
  }
});

// The courses a guest chooses from. Registered above '/:id' so the literal
// path wins — '/set-menu-options/x' would otherwise match ':id'.
recipesRouter.patch('/set-menu-options/:id/availability', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.setSetMenuOptionAvailability(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/:id/courses', async (req, res, next) => {
  try {
    res.json(await recipesService.setMenuCourses(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

recipesRouter.put('/:id/courses', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.saveSetMenuCourses(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await recipesService.get(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

recipesRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await recipesService.createRecipe(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.delete('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.deleteRecipes(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.updateRecipe(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

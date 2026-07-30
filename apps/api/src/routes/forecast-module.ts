// Forecasting module routes, mounted at /api/forecast-module.
//
// Every route takes an explicit companyId. There is deliberately no endpoint
// that returns a combined position for both legal entities — the group view
// returns a labelled comparison instead.

import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { forecastModuleService } from '../services/forecast-module.service.js';

export const forecastModuleRouter = Router();

const companyIdOf = (req: { query: unknown; params: unknown }): string => {
  const params = (req.params ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const value = params.companyId ?? query.companyId;
  if (typeof value !== 'string' || value.trim() === '') {
    throw Object.assign(new Error('companyId is required — forecasting is always scoped to one legal entity.'), { status: 400 });
  }
  return value.trim();
};

forecastModuleRouter.get('/companies', requireManager, async (_req, res, next) => {
  try {
    res.json(await forecastModuleService.listCompanies());
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/assumptions', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.getAssumptions(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/operating', requireManager, async (req, res, next) => {
  try {
    res.json(
      await forecastModuleService.operatingForecast(companyIdOf(req), {
        years: req.query.years ? Number(req.query.years) : undefined,
        scenarioKey: typeof req.query.scenario === 'string' ? req.query.scenario : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/cash-position', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.cashPosition(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/bas-reserve', requireManager, async (req, res, next) => {
  try {
    const gross = Number(req.query.grossReceiptsCents ?? 0);
    const actual = req.query.actualNetGstCents ? Number(req.query.actualNetGstCents) : null;
    res.json(await forecastModuleService.basReserve(companyIdOf(req), gross, actual));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/creditors', requireManager, async (req, res, next) => {
  try {
    const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : undefined;
    res.json(await forecastModuleService.creditorPosition(companyIdOf(req), proposalId));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/group-comparison', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.groupComparison({ years: req.query.years ? Number(req.query.years) : undefined }));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/scenarios', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.listScenarios(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.post('/scenarios/preview', requireManager, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { companyId?: string; adjustments?: Record<string, number>; years?: number };
    if (!body.companyId) throw Object.assign(new Error('companyId is required.'), { status: 400 });
    res.json(await forecastModuleService.previewScenario(body.companyId, body.adjustments ?? {}, body.years ?? 3));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/import-templates', requireManager, (_req, res) => {
  res.json(forecastModuleService.listTemplates());
});

forecastModuleRouter.get('/import-templates/:datasetKey.csv', requireManager, (req, res, next) => {
  try {
    const { fileName, csv } = forecastModuleService.templateCsv(String(req.params.datasetKey));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/** Dry run only — validation never writes. Applying is a separate action. */
forecastModuleRouter.post('/imports/validate', requireManager, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { companyId?: string; dataset?: string; csv?: string; allOrNothing?: boolean };
    if (!body.companyId || !body.dataset || typeof body.csv !== 'string') {
      throw Object.assign(new Error('companyId, dataset and csv are required.'), { status: 400 });
    }
    res.json(
      await forecastModuleService.validateImport(body.companyId, body.dataset, body.csv, {
        allOrNothing: body.allOrNothing
      })
    );
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/data-quality', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.dataQuality(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/sync-status', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.syncStatus(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

forecastModuleRouter.get('/model-performance', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastModuleService.modelPerformance(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

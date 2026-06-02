import { Router } from 'express';
import { requireAdmin, requireManager } from '../lib/auth-middleware.js';
import { auditService } from '../services/audit.service.js';
import { auditExportService } from '../services/audit-export.service.js';

export const auditsRouter = Router();

auditsRouter.get('/templates', async (_req, res, next) => {
  try {
    res.json(await auditService.listTemplates());
  } catch (error) {
    next(error);
  }
});

auditsRouter.post('/templates', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await auditService.createTemplate(req.body));
  } catch (error) {
    next(error);
  }
});

auditsRouter.get('/templates/:id', async (req, res, next) => {
  try {
    res.json(await auditService.getTemplate(req.params.id));
  } catch (error) {
    next(error);
  }
});

auditsRouter.put('/templates/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await auditService.updateTemplate(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

auditsRouter.delete('/templates/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await auditService.deleteTemplate(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

auditsRouter.get('/runs', async (_req, res, next) => {
  try {
    res.json(await auditService.listRuns());
  } catch (error) {
    next(error);
  }
});

auditsRouter.post('/runs', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await auditService.createRun(req.body));
  } catch (error) {
    next(error);
  }
});

auditsRouter.get('/runs/:id', async (req, res, next) => {
  try {
    res.json(await auditService.getRunById(req.params.id));
  } catch (error) {
    next(error);
  }
});

auditsRouter.patch('/runs/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await auditService.updateRun(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

auditsRouter.post('/runs/:id/findings', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await auditService.addFinding(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

auditsRouter.post('/runs/:runId/findings/:findingId/convert-to-issue', requireManager, async (req, res, next) => {
  try {
    const actor = req.user ? `${req.user.firstName} ${req.user.lastName}` : 'system';
    const issue = await auditService.convertFindingToIssue(
      String(req.params.runId),
      String(req.params.findingId),
      actor
    );
    res.status(201).json(issue);
  } catch (error) {
    next(error);
  }
});

auditsRouter.get('/runs/:id/export/pdf', async (req, res, next) => {
  try {
    const { filename, bytes } = await auditExportService.pdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
});

auditsRouter.get('/runs/:id/export/xlsx', async (req, res, next) => {
  try {
    const { filename, bytes } = await auditExportService.xlsx(req.params.id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
});

auditsRouter.get('/meta', async (_req, res, next) => {
  try {
    res.json(await auditService.summary());
  } catch (error) {
    next(error);
  }
});

import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { posService } from '../services/pos.service.js';

// Register endpoints: any authenticated identity may ring up sales — a venue
// device (the counter iPad) or a signed-in staff/manager account. Nothing
// here is public.
export const posRouter = Router();

posRouter.use((req, _res, next) => {
  if (!req.user && !req.deviceUser) return next(new HttpError(401, 'Sign in the register first.'));
  next();
});

posRouter.get('/menu', async (_req, res, next) => {
  try {
    res.json(await posService.registerMenu());
  } catch (error) {
    next(error);
  }
});

posRouter.get('/orders', async (req, res, next) => {
  try {
    res.json(
      await posService.listOpenOrders(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.status === 'string' ? req.query.status : null
      )
    );
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/merge', async (req, res, next) => {
  try {
    res.json(await posService.mergeOrders(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/reopen', async (req, res, next) => {
  try {
    res.json(await posService.reopenOrder(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/refund', async (req, res, next) => {
  try {
    res.json(await posService.refundOrder(String(req.params.id), req.body, !req.user && Boolean(req.deviceUser)));
  } catch (error) {
    next(error);
  }
});

posRouter.patch('/tables/:id/position', async (req, res, next) => {
  try {
    res.json(await posService.moveTable(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders', async (req, res, next) => {
  try {
    res.status(201).json(await posService.createOrder(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/orders/:id', async (req, res, next) => {
  try {
    res.json(await posService.getOrder(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.patch('/orders/:id', async (req, res, next) => {
  try {
    res.json(await posService.updateOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/guests/:id', async (req, res, next) => {
  try {
    res.json(await posService.guestProfile(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.put('/orders/:id/lines', async (req, res, next) => {
  try {
    res.json(await posService.setLines(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/pay', async (req, res, next) => {
  try {
    res.json(await posService.payOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/void', async (req, res, next) => {
  try {
    res.json(await posService.voidOrder(String(req.params.id), req.body, !req.user && Boolean(req.deviceUser)));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/tables', async (req, res, next) => {
  try {
    res.json(await posService.floorTables(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/manager-approve', async (req, res, next) => {
  try {
    res.json(await posService.managerApprove(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/rules', async (_req, res, next) => {
  try {
    res.json(await posService.listRules());
  } catch (error) {
    next(error);
  }
});

posRouter.get('/courses', async (_req, res, next) => {
  try {
    res.json(await posService.listCourses());
  } catch (error) {
    next(error);
  }
});

posRouter.get('/printer-profiles', async (_req, res, next) => {
  try {
    res.json(await posService.listPrinterProfiles());
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/send', async (req, res, next) => {
  try {
    res.json(await posService.sendOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/drawer', async (req, res, next) => {
  try {
    res.json(await posService.drawerStatus(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/drawer/open', async (req, res, next) => {
  try {
    res.status(201).json(await posService.openDrawer(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/drawer/close', async (req, res, next) => {
  try {
    res.json(await posService.closeDrawer(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/close-day', async (req, res, next) => {
  try {
    res.json(await posService.closeDayStatus(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/close-day', async (req, res, next) => {
  try {
    res.json(await posService.closeDay(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/eighty-six', async (req, res, next) => {
  try {
    res.json(await posService.toggle86(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/modifier-groups', async (req, res, next) => {
  try {
    res.json(await posService.saveModifierGroup(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.delete('/modifier-groups/:id', async (req, res, next) => {
  try {
    res.json(await posService.deleteModifierGroup(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/venue-settings', async (req, res, next) => {
  try {
    res.json(await posService.getVenueSetting(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.put('/venue-settings', async (req, res, next) => {
  try {
    res.json(await posService.setVenueSetting(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/shift-report', async (req, res, next) => {
  try {
    res.json(
      await posService.shiftReport(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.staffName === 'string' ? req.query.staffName : null
      )
    );
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/email-receipt', async (req, res, next) => {
  try {
    res.json(await posService.emailReceipt(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/kds', async (req, res, next) => {
  try {
    res.json(
      await posService.kdsBoard(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.station === 'string' ? req.query.station : null
      )
    );
  } catch (error) {
    next(error);
  }
});

posRouter.post('/kds/:id/bump', async (req, res, next) => {
  try {
    res.json(await posService.kdsBump(String(req.params.id), false));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/kds/:id/recall', async (req, res, next) => {
  try {
    res.json(await posService.kdsBump(String(req.params.id), true));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/adjust-reasons', (_req, res) => {
  res.json(posService.adjustReasons());
});

posRouter.post('/orders/:id/discount', async (req, res, next) => {
  try {
    res.json(await posService.discountOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/lines/:lineId/adjust', async (req, res, next) => {
  try {
    res.json(await posService.adjustLine(String(req.params.id), String(req.params.lineId), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/wastage', async (req, res, next) => {
  try {
    res.status(201).json(await posService.recordWastage(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/adjustments', async (req, res, next) => {
  try {
    res.json(await posService.listAdjustments(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/homescreen', async (req, res, next) => {
  try {
    res.json(await posService.getHomescreen(typeof req.query.userKey === 'string' ? req.query.userKey : null));
  } catch (error) {
    next(error);
  }
});

posRouter.put('/homescreen', async (req, res, next) => {
  try {
    res.json(await posService.saveHomescreen(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/terminal/connection-token', async (_req, res, next) => {
  try {
    res.json(await posService.terminalConnectionToken());
  } catch (error) {
    next(error);
  }
});

posRouter.post('/terminal/payment-intent', async (req, res, next) => {
  try {
    res.json(await posService.terminalPaymentIntent(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/floor-reservations', async (req, res, next) => {
  try {
    res.json(await posService.floorReservations(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/day-summary', async (req, res, next) => {
  try {
    res.json(
      await posService.daySummary(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.date === 'string' ? req.query.date : null
      )
    );
  } catch (error) {
    next(error);
  }
});

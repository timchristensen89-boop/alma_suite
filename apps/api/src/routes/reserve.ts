import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { reserveService } from '../services/reserve.service.js';

export const reserveRouter = Router();

reserveRouter.get('/dashboard', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.dashboard(req.user!, {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/diary', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.diary(req.user!, {
        start: typeof req.query.start === 'string' ? req.query.start : undefined,
        end: typeof req.query.end === 'string' ? req.query.end : undefined,
        venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/guests', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.listGuests(req.user!, {
        venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        limit: typeof req.query.limit === 'string' ? req.query.limit : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/guests', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createGuest(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/guests/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.getGuest(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/guests/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateGuest(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/guests/:id/reservations', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.guestReservations(req.user!, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/tables', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.listTables(req.user!, typeof req.query.venue === 'string' ? req.query.venue : undefined)
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/tables', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createTable(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/reservations', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.listReservations(req.user!, {
        venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/reservations', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createReservation(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/reservations/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateReservation(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/availability-rules', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.listAvailabilityRules(req.user!, typeof req.query.venue === 'string' ? req.query.venue : undefined)
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/availability-rules', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createAvailabilityRule(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/availability-rules/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateAvailabilityRule(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/blackouts', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.listBlackouts(req.user!, typeof req.query.venue === 'string' ? req.query.venue : undefined));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/blackouts', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createBlackout(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/google-reserve-settings', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.getGoogleReserveIntegration(req.user!, typeof req.query.venue === 'string' ? req.query.venue : undefined)
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/google-reserve-settings/:venue', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateGoogleReserveIntegration(req.user!, String(req.params.venue), req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/public-widget/config', async (_req, res, next) => {
  try {
    res.json(await reserveService.publicWidgetConfig());
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/public-widget/availability', async (req, res, next) => {
  try {
    res.json(await reserveService.publicAvailability(req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/public-widget/book', async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.publicBook(req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/public/config', async (_req, res, next) => {
  try {
    res.json(await reserveService.publicWidgetConfig());
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/public/availability', async (req, res, next) => {
  try {
    res.json(await reserveService.publicAvailability(req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/public/book', async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.publicBook(req.body));
  } catch (error) {
    next(error);
  }
});

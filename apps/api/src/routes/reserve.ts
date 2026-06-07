import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
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

reserveRouter.get('/guests/:id/timeline', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.guestTimeline(req.user!, String(req.params.id)));
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

// Batch geometry save from the floor-plan editor. Declared before /tables/:id
// so "layout" isn't captured as an :id.
reserveRouter.patch('/tables/layout', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.saveTableLayout(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/tables/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateTable(req.user!, String(req.params.id), req.body));
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

// Drinks packages (admin) — guests pre-pay for these at booking.
reserveRouter.get('/drink-packages', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.listDrinkPackages(req.user!, typeof req.query.venue === 'string' ? req.query.venue : undefined)
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/drink-packages', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createDrinkPackage(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/drink-packages/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateDrinkPackage(req.user!, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/areas', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reserveService.listAreas(req.user!, typeof req.query.venue === 'string' ? req.query.venue : undefined)
    );
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/areas', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createArea(req.user!, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/areas/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateArea(req.user!, String(req.params.id), req.body));
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

reserveRouter.post('/public/function-enquiry', async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.recordFunctionEnquiry(req.body));
  } catch (error) {
    next(error);
  }
});

// Public — guest joins the waitlist when their desired date is fully booked.
reserveRouter.post('/public-widget/waitlist', async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.recordPublicWaitlist(req.body));
  } catch (error) {
    next(error);
  }
});

// Manager — list current waitlist entries (filterable by venue + status).
reserveRouter.get('/waitlist', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const venue = typeof req.query.venue === 'string' ? req.query.venue : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(await reserveService.listWaitlist(req.user, { venue, status }));
  } catch (error) {
    next(error);
  }
});

// Manager — add a walk-in / phone waitlist entry.
reserveRouter.post('/waitlist', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.status(201).json(await reserveService.createWaitlistEntry(req.user, req.body));
  } catch (error) {
    next(error);
  }
});

// Manager — update a waitlist entry (mark notified, attach a created
// reservation, archive, etc.).
reserveRouter.patch('/waitlist/:id', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await reserveService.updateWaitlistEntry(req.user, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// Public — view or cancel a reservation via the signed token that's
// emailed to the guest on confirmation. No auth — the signature IS
// the auth.
reserveRouter.get('/public/manage/:token', async (req, res, next) => {
  try {
    res.json(await reserveService.getPublicManageView(String(req.params.token)));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/public/manage/:token/cancel', async (req, res, next) => {
  try {
    res.json(await reserveService.cancelPublicReservation(String(req.params.token)));
  } catch (error) {
    next(error);
  }
});

// Public — issue a SetupIntent the widget can confirm with Stripe
// Elements before submitting the booking. Saves a card-on-file for
// no-show protection without charging.
reserveRouter.post('/public-widget/setup-intent', async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createPublicSetupIntent(req.body));
  } catch (error) {
    next(error);
  }
});

// Public — create a PaymentIntent for the guest's selected drinks packages.
// Charged at booking; also saves the card for no-show protection.
reserveRouter.post('/public-widget/drinks-payment-intent', async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createDrinksPaymentIntent(req.body));
  } catch (error) {
    next(error);
  }
});

// Manager — charge the saved card-on-file for a no-show. Body shape:
// { amountCents?: number; reason?: string }. Defaults to $50/cover
// (capped at 9 covers).
reserveRouter.post('/reservations/:id/charge-no-show', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await reserveService.chargeReservationNoShow(req.user, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// Manager — mark the prepaid drinks redeemed (served on arrival). Toggles.
reserveRouter.post('/reservations/:id/redeem-drinks', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await reserveService.redeemDrinks(req.user, String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// In-service floor map: seat / advance course / bill / clear a table.
reserveRouter.patch('/reservations/:id/service', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await reserveService.setServiceState(req.user, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// Live service-map table calls — raise / list / acknowledge / resolve.
reserveRouter.get('/calls', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const includeResolved = req.query.includeResolved === 'true' || req.query.includeResolved === '1';
    res.json(await reserveService.listTableCalls(
      req.user,
      typeof req.query.venue === 'string' ? req.query.venue : undefined,
      includeResolved
    ));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/calls', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await reserveService.createTableCall(req.user, req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/calls/:id', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await reserveService.updateTableCall(req.user, String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// Live Square open-ticket totals matched to tables, for the service map.
reserveRouter.get('/square-orders', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await reserveService.squareTableOrders(req.user, typeof req.query.venue === 'string' ? req.query.venue : undefined));
  } catch (error) {
    next(error);
  }
});

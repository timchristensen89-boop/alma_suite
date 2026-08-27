import { Router } from 'express';
import type { Request } from 'express';
import {
  clearDevicePinSessionCookie,
  createDevicePinSessionToken,
  createSessionToken,
  setDevicePinSessionCookie,
  setSessionCookie
} from '../lib/session.js';
import { HttpError } from '../lib/http.js';
import { deviceService } from '../services/device.service.js';
import { staffService } from '../services/staff.service.js';

export const deviceRouter = Router();

function currentDeviceUser(req: Request) {
  return req.deviceUser ?? (req.user?.accountType === 'VENUE_DEVICE' ? req.user : undefined);
}

deviceRouter.get('/staff', async (req, res, next) => {
  try {
    const deviceUser = currentDeviceUser(req);
    if (!deviceUser) throw new HttpError(403, 'Venue device account required.');
    res.json(await deviceService.listDeviceStaff(deviceUser, req.pinUser ?? null));
  } catch (error) {
    next(error);
  }
});

deviceRouter.get('/pin-staff', async (req, res, next) => {
  try {
    // The full two-venue staff directory (names, roles, venues). It was on
    // the public list with no session check — an anonymous walk of everyone
    // on the roster. Same gate as /staff: the venue device IS the caller.
    const deviceUser = currentDeviceUser(req);
    if (!deviceUser) throw new HttpError(403, 'Venue device account required.');
    res.json(await deviceService.listPinStaff());
  } catch (error) {
    next(error);
  }
});

deviceRouter.get('/home-summary', async (_req, res, next) => {
  try {
    res.json(await deviceService.homeSummary());
  } catch (error) {
    next(error);
  }
});

// Tonight's service sheet — guest names/notes ride on this, so it requires the
// venue-device session (unlike the public venue-snapshot, which stays PII-free).
deviceRouter.get('/tonight-service', async (req, res, next) => {
  try {
    const deviceUser = currentDeviceUser(req);
    if (!deviceUser) throw new HttpError(403, 'Venue device account required.');
    const venue = typeof req.query.venue === 'string' && req.query.venue ? req.query.venue : deviceUser.venue ?? null;
    res.json(await deviceService.tonightService(venue));
  } catch (error) {
    next(error);
  }
});

// ── Wall kiosk ─────────────────────────────────────────────────────────────
// The clock-in tablet on the wall. The device session is the venue; each
// punch carries the person's PIN, resolved with the same matcher (and the
// same per-IP throttle and lockouts) as the staff PIN login — but WITHOUT
// switching the kiosk's session, so the next person walks straight up.
deviceRouter.get('/kiosk/on-now', async (req, res, next) => {
  try {
    const deviceUser = currentDeviceUser(req);
    if (!deviceUser) throw new HttpError(403, 'Venue device account required.');
    res.json(await staffService.kioskOnNow(deviceUser.venue ?? null));
  } catch (error) {
    next(error);
  }
});

deviceRouter.post('/kiosk/punch', async (req, res, next) => {
  try {
    const deviceUser = currentDeviceUser(req);
    if (!deviceUser) throw new HttpError(403, 'Venue device account required.');
    // Venue-scoped first (identical PINs at different venues stay separate),
    // then unscoped — someone rostered across from the other venue must be
    // able to punch this wall. A real cross-venue collision still 409s.
    let staffUser;
    try {
      staffUser = await deviceService.staffPinLogin({ pin: (req.body ?? {}).pin }, req.ip, deviceUser.venue ?? null);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401 && deviceUser.venue) {
        staffUser = await deviceService.staffPinLogin({ pin: (req.body ?? {}).pin }, req.ip, null);
      } else {
        throw error;
      }
    }
    res.json(await staffService.kioskPunch(staffUser, req.body));
  } catch (error) {
    next(error);
  }
});

deviceRouter.post('/staff-pin-login', async (req, res, next) => {
  try {
    // Scope PIN matching to the kiosk device's venue when present, so identical
    // PINs at different venues can't collide. Falls back to all-venue matching
    // if the request has no device session.
    const deviceVenue = currentDeviceUser(req)?.venue ?? null;
    const user = await deviceService.staffPinLogin(req.body, req.ip, deviceVenue);
    const token = createSessionToken(user.id);
    clearDevicePinSessionCookie(res);
    setSessionCookie(res, token);
    res.json({ user, token });
  } catch (error) {
    next(error);
  }
});

deviceRouter.post('/pin-login', async (req, res, next) => {
  try {
    const deviceUser = currentDeviceUser(req);
    if (!deviceUser) throw new HttpError(403, 'Venue device account required.');
    const user = await deviceService.pinLogin(deviceUser, req.body);
    const token = createDevicePinSessionToken(deviceUser.id, user.id);
    setDevicePinSessionCookie(res, token);
    res.json({ user, pinToken: token });
  } catch (error) {
    next(error);
  }
});

deviceRouter.post('/pin-logout', (_req, res) => {
  clearDevicePinSessionCookie(res);
  res.json({ ok: true });
});

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

deviceRouter.get('/pin-staff', async (_req, res, next) => {
  try {
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
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

deviceRouter.post('/pin-logout', (_req, res) => {
  clearDevicePinSessionCookie(res);
  res.json({ ok: true });
});

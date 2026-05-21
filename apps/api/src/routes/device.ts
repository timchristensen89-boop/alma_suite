import { Router } from 'express';
import type { Request } from 'express';
import { clearDevicePinSessionCookie, createDevicePinSessionToken, setDevicePinSessionCookie } from '../lib/session.js';
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

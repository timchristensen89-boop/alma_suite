import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import {
  clearDevicePinSessionCookie,
  clearSessionCookie,
  createSuiteHandoffToken,
  createSessionToken,
  parseSuiteHandoffToken,
  setSessionCookie
} from '../lib/session.js';
import { authService, PASSWORD_RESET_GENERIC_MESSAGE } from '../services/auth.service.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const user = await authService.login(req.body);
    const token = createSessionToken(user.id);
    setSessionCookie(res, token);
    res.json({ user, token });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (_req, res) => {
  clearDevicePinSessionCookie(res);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post('/handoff', (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json({ token: createSuiteHandoffToken(req.user.id), expiresInSeconds: 120 });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/handoff/consume', async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const payload = parseSuiteHandoffToken(token);
    if (!payload) throw new HttpError(401, 'Suite sign-in link expired. Please sign in again.');
    const user = await authService.getById(payload.userId);
    if (!user) throw new HttpError(401, 'Suite sign-in user not found.');
    const sessionToken = createSessionToken(user.id);
    setSessionCookie(res, sessionToken);
    res.json({ user, token: sessionToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/password-reset/request', async (req, res, next) => {
  try {
    await authService.requestPasswordReset(req.body, {
      requestOrigin: req.header('origin'),
      requestIp: req.ip,
      userAgent: req.header('user-agent')
    });
    res.json({ ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/password-reset/complete', async (req, res, next) => {
  try {
    await authService.completePasswordReset(req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/change-password', async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    await authService.changePassword(req.user.id, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

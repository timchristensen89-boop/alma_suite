import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import {
  clearSessionCookie,
  createSessionToken,
  setSessionCookie
} from '../lib/session.js';
import { authService } from '../services/auth.service.js';

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
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
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

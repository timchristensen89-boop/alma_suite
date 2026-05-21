import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { env } from '../env.js';

type SessionPayload = {
  userId: string;
  issuedAt: number;
  purpose?: 'session' | 'suite-handoff';
};

type DevicePinSessionPayload = {
  deviceUserId: string;
  pinUserId: string;
  issuedAt: number;
  purpose: 'device-pin';
};

export const DEVICE_PIN_SESSION_COOKIE = 'alma_device_pin_session';
const SEP = '.';

function base64url(input: string | Buffer) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function sign(input: string, secret = env.sessionSecret): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = {
    userId,
    issuedAt: Date.now()
  };
  const body = base64url(JSON.stringify(payload));
  const sig = sign(body);
  return `${body}${SEP}${sig}`;
}

function parseSignedToken(token: string | undefined, secret: string, maxAgeMs: number, purpose?: SessionPayload['purpose']): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(SEP);
  if (!body || !sig) return null;

  const expected = sign(body, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf8')) as SessionPayload;
    if (!payload?.userId || typeof payload.issuedAt !== 'number') return null;
    if (purpose && payload.purpose !== purpose) return null;
    if (Date.now() - payload.issuedAt > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseDevicePinSignedToken(token: string | undefined, maxAgeMs: number): DevicePinSessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(SEP);
  if (!body || !sig) return null;

  const expected = sign(body, env.sessionSecret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf8')) as DevicePinSessionPayload;
    if (!payload?.deviceUserId || !payload.pinUserId || typeof payload.issuedAt !== 'number') return null;
    if (payload.purpose !== 'device-pin') return null;
    if (Date.now() - payload.issuedAt > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseSessionToken(token: string | undefined): SessionPayload | null {
  return parseSignedToken(token, env.sessionSecret, env.sessionMaxAgeMs);
}

export function createDevicePinSessionToken(deviceUserId: string, pinUserId: string): string {
  const payload: DevicePinSessionPayload = {
    deviceUserId,
    pinUserId,
    issuedAt: Date.now(),
    purpose: 'device-pin'
  };
  const body = base64url(JSON.stringify(payload));
  const sig = sign(body);
  return `${body}${SEP}${sig}`;
}

export function parseDevicePinSessionToken(token: string | undefined): DevicePinSessionPayload | null {
  return parseDevicePinSignedToken(token, 12 * 60 * 60 * 1000);
}

export function createSuiteHandoffToken(userId: string): string {
  const payload: SessionPayload = {
    userId,
    issuedAt: Date.now(),
    purpose: 'suite-handoff'
  };
  const body = base64url(JSON.stringify(payload));
  const sig = sign(body, env.suiteAuthSecret);
  return `${body}${SEP}${sig}`;
}

export function parseSuiteHandoffToken(token: string | undefined): SessionPayload | null {
  return parseSignedToken(token, env.suiteAuthSecret, 2 * 60 * 1000, 'suite-handoff');
}

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: env.isProduction ? 'none' : 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: env.sessionMaxAgeMs
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(env.sessionCookieName, token, cookieOptions());
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.sessionCookieName, { path: '/' });
}

export function setDevicePinSessionCookie(res: Response, token: string) {
  res.cookie(DEVICE_PIN_SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: 12 * 60 * 60 * 1000
  });
}

export function clearDevicePinSessionCookie(res: Response) {
  res.clearCookie(DEVICE_PIN_SESSION_COOKIE, { path: '/' });
}

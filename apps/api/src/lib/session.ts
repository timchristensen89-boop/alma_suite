import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { env } from '../env.js';

type SessionPayload = {
  userId: string;
  issuedAt: number;
};

const SEP = '.';

function base64url(input: string | Buffer) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function sign(input: string): string {
  return createHmac('sha256', env.sessionSecret).update(input).digest('base64url');
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

export function parseSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(SEP);
  if (!body || !sig) return null;

  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf8')) as SessionPayload;
    if (!payload?.userId || typeof payload.issuedAt !== 'number') return null;
    if (Date.now() - payload.issuedAt > env.sessionMaxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
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

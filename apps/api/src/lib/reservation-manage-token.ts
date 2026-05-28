// Signed deep-link tokens for the reservation manage / cancel page.
// The token is base64url(payload).hmac so it's URL-safe, single-string,
// and signature-verifiable without a database lookup. Payload includes
// the reservation id + an expiry so a leaked link auto-rots.
//
// Format: base64url({ rid: string, exp: number }) + "." + hmacSha256
// HMAC key is JWT_SECRET / SESSION_SECRET (reused — the same trust
// boundary; if someone has the session secret they can already issue
// auth cookies, so adding a token-specific secret would be theatre).

import crypto from 'node:crypto';
import { env } from '../env.js';

const DEFAULT_TTL_DAYS = 60;

type Payload = { rid: string; exp: number };

function b64urlEncode(buffer: Buffer | string) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(value: string) {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function sign(body: string) {
  return crypto.createHmac('sha256', env.sessionSecret).update(body).digest();
}

export function createReservationManageToken(reservationId: string, ttlDays = DEFAULT_TTL_DAYS): string {
  const payload: Payload = {
    rid: reservationId,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(sign(body));
  return `${body}.${sig}`;
}

export function verifyReservationManageToken(token: string): { reservationId: string } | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64urlEncode(sign(body));
  // constant-time compare on equal-length strings
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(body).toString('utf8')) as Payload;
    if (!parsed || typeof parsed.rid !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { reservationId: parsed.rid };
  } catch {
    return null;
  }
}

export function reservationManageUrl(reservationId: string, baseUrl: string): string {
  const token = createReservationManageToken(reservationId);
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/manage?token=${encodeURIComponent(token)}`;
}

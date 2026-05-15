import crypto from 'node:crypto';
import { env } from '../env.js';
import { HttpError } from './http.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function keyFromEnv() {
  const raw = env.integrations.tokenEncryptionKey.trim();
  if (!raw) return null;

  const base64 = Buffer.from(raw, 'base64');
  if (base64.length === 32) return base64;

  const hex = Buffer.from(raw, 'hex');
  if (hex.length === 32) return hex;

  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;

  return null;
}

export function integrationTokenEncryptionStatus() {
  return {
    configured: Boolean(keyFromEnv()),
    requiredEnvVar: 'INTEGRATION_TOKEN_ENCRYPTION_KEY' as const
  };
}

function requiredKey() {
  const key = keyFromEnv();
  if (!key) {
    throw new HttpError(503, 'Integration token encryption is not configured.');
  }
  return key;
}

export function encryptIntegrationSecret(value: string) {
  const key = requiredKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

export function decryptIntegrationSecret(value: string) {
  const key = requiredKey();
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(':');
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new HttpError(500, 'Integration token payload is invalid.');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function safeCompareBase64(a: string | undefined | null, b: string) {
  if (!a) return false;
  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

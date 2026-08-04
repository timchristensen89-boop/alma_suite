// Resilient HTTP for the forecasting syncs.
//
// The existing suite helpers are single-shot GETs with no retry. A sync that
// walks 24 months of Square payouts or Xero bank transactions will meet 429s
// and transient 5xx, and must survive them without hammering the provider or
// losing its place.
//
// Rules encoded here:
//   - 429 and 5xx are retryable; 4xx (other than 429) are not — retrying a
//     rejected request just burns rate limit.
//   - Retry-After is obeyed when the provider sends it, in seconds or as an
//     HTTP date. The provider knows better than our backoff curve.
//   - Backoff is exponential with jitter, so parallel syncs do not resonate.
//   - Rate-limit headers are surfaced for logging rather than swallowed.

export class SyncHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly body: string;

  constructor(message: string, options: { status: number; retryable: boolean; body?: string }) {
    super(message);
    this.name = "SyncHttpError";
    this.status = options.status;
    this.retryable = options.retryable;
    this.body = options.body ?? "";
  }
}

/** 429 and 5xx are worth another go. Everything else is a real answer. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/**
 * Retry-After may be delta-seconds or an HTTP date. Returns milliseconds, or
 * null when absent/unparseable so the caller falls back to its own backoff.
 */
export function parseRetryAfterMs(headerValue: string | null | undefined, now: number = Date.now()): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, asDate - now);
}

/** Exponential backoff with full jitter, bounded. */
export function backoffMs(attempt: number, options: { baseMs?: number; maxMs?: number; random?: () => number } = {}): number {
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 30_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * random());
}

/** Provider rate-limit headers worth logging. Names differ per provider. */
export interface RateLimitSnapshot {
  limit?: string;
  remaining?: string;
  reset?: string;
  retryAfterMs?: number | null;
}

export function readRateLimit(headers: Headers): RateLimitSnapshot {
  const get = (...names: string[]) => {
    for (const name of names) {
      const value = headers.get(name);
      if (value) return value;
    }
    return undefined;
  };
  return {
    limit: get("x-ratelimit-limit", "x-daylimit-limit", "ratelimit-limit"),
    remaining: get("x-ratelimit-remaining", "x-daylimit-remaining", "ratelimit-remaining"),
    reset: get("x-ratelimit-reset", "ratelimit-reset", "x-minlimit-remaining"),
    retryAfterMs: parseRetryAfterMs(headers.get("retry-after")),
  };
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRateLimit?: (snapshot: RateLimitSnapshot, attempt: number) => void;
}

export interface RequestResult<T> {
  data: T;
  attempts: number;
  rateLimitHits: number;
  rateLimit: RateLimitSnapshot;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * JSON request with retry. Throws SyncHttpError; `retryable` says whether the
 * caller may resume later (rate limit, provider wobble) or must stop and
 * surface the problem (bad scope, revoked token, malformed request).
 */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  let rateLimitHits = 0;
  let lastRateLimit: RateLimitSnapshot = {};

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
    });

    lastRateLimit = readRateLimit(response.headers);

    if (response.ok) {
      const text = await response.text();
      const data = (text ? JSON.parse(text) : null) as T;
      return { data, attempts: attempt + 1, rateLimitHits, rateLimit: lastRateLimit };
    }

    const body = await response.text().catch(() => "");
    const retryable = isRetryableStatus(response.status);
    if (response.status === 429) {
      rateLimitHits += 1;
      options.onRateLimit?.(lastRateLimit, attempt + 1);
    }

    const isLastAttempt = attempt === maxAttempts - 1;
    if (!retryable || isLastAttempt) {
      throw new SyncHttpError(
        `Request failed (HTTP ${response.status}) after ${attempt + 1} attempt${attempt === 0 ? "" : "s"}: ${body.slice(0, 200)}`,
        { status: response.status, retryable, body },
      );
    }

    // Provider instruction wins over our curve.
    const retryAfter = lastRateLimit.retryAfterMs;
    const wait = retryAfter ?? backoffMs(attempt, {
      baseMs: options.baseBackoffMs,
      maxMs: options.maxBackoffMs,
      random: options.random,
    });
    await sleep(wait);
  }

  // Unreachable: the loop either returns or throws.
  throw new SyncHttpError("Request retry loop exhausted.", { status: 0, retryable: true });
}

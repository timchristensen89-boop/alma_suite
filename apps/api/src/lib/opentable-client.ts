// OpenTable partner API client — the two free APIs only.
//
//   Menus Partner (Menu Data API)        POST /v1/partnermenu/{partner}/location/{rid}/menus
//                                        GET  /v1/menus/rid/{rid}            (needs read rights)
//   Restaurant Content Partner           POST /v2/partnerrestaurants/rid/{rid}
//   Authorization (client credentials)   POST {oauth}/api/v2/oauth/token?grant_type=client_credentials
//
// Everything above is from docs.opentable.com (read 16 Oct 2026, see
// docs/opentable/02-api-capability-matrix.md). Nothing else is called: no
// booking, reviews, CRM, reservation-sync or directory endpoints exist here,
// and the client has no way to reach one.
//
// Rules encoded here:
//   - Nothing leaves the process unless `enabled` is true. A disabled client
//     throws OpenTableDisabledError before any network call, and the caller
//     records the attempt as SKIPPED with the payload it would have sent.
//   - One token per client, cached until 60 s before expiry, refreshed on 401
//     exactly once per request.
//   - Every attempt has its own AbortController timeout.
//   - 429 / 5xx / network errors are retried with jittered backoff (Retry-After
//     wins). Other 4xx are final: the request was understood and refused.
//   - Writes carry X-Request-Id from the caller, so a retry of the same payload
//     is one request as far as OpenTable is concerned. The id is stable per
//     payload hash, not per attempt.
//   - Secrets never appear in error messages or thrown objects.

import { backoffMs, isRetryableStatus, parseRetryAfterMs } from './forecast/http.js';
import type { OpenTableMenusPayload, OpenTableProfilePayload, OpenTableRemoteMenus } from '@alma/shared';

export interface OpenTableClientConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  partnerName: string;
  apiBase: string;
  oauthBase: string;
  timeoutMs: number;
  /** Total attempts including the first (default 4). */
  maxAttempts?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export class OpenTableDisabledError extends Error {
  constructor(message = 'OpenTable API calls are switched off (OPENTABLE_API_ENABLED is not "true").') {
    super(message);
    this.name = 'OpenTableDisabledError';
  }
}

export class OpenTableConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenTableConfigError';
  }
}

export class OpenTableHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly body: string;
  readonly attempts: number;
  constructor(message: string, options: { status: number; retryable: boolean; body?: string; attempts: number }) {
    super(message);
    this.name = 'OpenTableHttpError';
    this.status = options.status;
    this.retryable = options.retryable;
    this.body = (options.body ?? '').slice(0, 2000);
    this.attempts = options.attempts;
  }
}

/** The documented response of both write endpoints. */
export interface OpenTableWriteResponse {
  requestId?: number | string;
  itemStatus?: Array<{ itemId?: string; sequenceId?: string; status?: string; message?: string }>;
  totalItems?: number;
  totalProcessedItems?: number;
  created?: string;
  [key: string]: unknown;
}

export interface OpenTableCallResult<T> {
  data: T;
  status: number;
  attempts: number;
  requestKey: string | null;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Which pieces of configuration are missing, by name only — never values. */
export function missingOpenTableConfig(config: Pick<OpenTableClientConfig, 'clientId' | 'clientSecret' | 'partnerName'>): string[] {
  const missing: string[] = [];
  if (!config.clientId) missing.push('OPENTABLE_CLIENT_ID');
  if (!config.clientSecret) missing.push('OPENTABLE_CLIENT_SECRET');
  if (!config.partnerName) missing.push('OPENTABLE_PARTNER_NAME');
  return missing;
}

export class OpenTableClient {
  private token: TokenState | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxAttempts: number;

  constructor(private readonly config: OpenTableClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? defaultSleep;
    this.now = config.now ?? Date.now;
    this.random = config.random ?? Math.random;
    this.maxAttempts = Math.max(1, config.maxAttempts ?? 4);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Throws before any I/O when the integration is off or unconfigured. */
  assertCallable(): void {
    if (!this.config.enabled) throw new OpenTableDisabledError();
    const missing = missingOpenTableConfig(this.config);
    if (missing.length) throw new OpenTableConfigError(`OpenTable is not configured: ${missing.join(', ')} missing.`);
  }

  /**
   * Connection check = a real token request. Nothing else proves the
   * credentials; "the env vars exist" is not a connection.
   */
  async checkConnection(): Promise<{ ok: true; expiresInSeconds: number; scope: string | null }> {
    this.assertCallable();
    const token = await this.fetchToken();
    return { ok: true, expiresInSeconds: Math.max(0, Math.round((token.expiresAt - this.now()) / 1000)), scope: token.scope };
  }

  /** Menus Partner: replace every menu for a restaurant. Asynchronous on OpenTable's side. */
  async publishMenus(rid: string, payload: OpenTableMenusPayload, requestKey: string): Promise<OpenTableCallResult<OpenTableWriteResponse>> {
    this.assertCallable();
    const path = `/v1/partnermenu/${encodeURIComponent(this.config.partnerName)}/location/${encodeURIComponent(rid)}/menus`;
    return this.call<OpenTableWriteResponse>('POST', path, { body: payload, requestKey });
  }

  /** Menus Partner: read what OpenTable holds. Only answers for partners with distribution rights. */
  async readMenus(rid: string): Promise<OpenTableCallResult<OpenTableRemoteMenus>> {
    this.assertCallable();
    return this.call<OpenTableRemoteMenus>('GET', `/v1/menus/rid/${encodeURIComponent(rid)}`, {});
  }

  /** Restaurant Content Partner: field-level overwrite of the profile. */
  async publishProfile(rid: string, payload: OpenTableProfilePayload, requestKey: string): Promise<OpenTableCallResult<OpenTableWriteResponse>> {
    this.assertCallable();
    return this.call<OpenTableWriteResponse>('POST', `/v2/partnerrestaurants/rid/${encodeURIComponent(rid)}`, { body: payload, requestKey });
  }

  // ---------------------------------------------------------------------------

  private async fetchToken(): Promise<TokenState & { scope: string | null }> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64');
    const url = `${this.config.oauthBase.replace(/\/+$/, '')}/api/v2/oauth/token?grant_type=client_credentials`;
    const result = await this.withRetry<{ access_token?: string; expires_in?: number; token_type?: string; scope?: string }>(
      () =>
        this.fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', 'Content-Length': '0', Accept: 'application/json' },
          signal: this.signal()
        }),
      'token'
    );
    const accessToken = result.data?.access_token;
    if (!accessToken) throw new OpenTableHttpError('OpenTable token response had no access_token.', { status: result.status, retryable: false, attempts: result.attempts });
    const expiresIn = Number(result.data?.expires_in ?? 3600);
    this.token = { accessToken, expiresAt: this.now() + Math.max(60, expiresIn) * 1000 };
    return { ...this.token, scope: result.data?.scope ?? null };
  }

  private async bearer(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.accessToken;
    const token = await this.fetchToken();
    return token.accessToken;
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.config.timeoutMs);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, options: { body?: unknown; requestKey?: string }): Promise<OpenTableCallResult<T>> {
    const url = `${this.config.apiBase.replace(/\/+$/, '')}${path}`;
    let refreshed = false;
    const attempt = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.bearer(refreshed)}`,
        Accept: 'application/json'
      };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.requestKey) headers['X-Request-Id'] = options.requestKey;
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: this.signal()
      });
      if (response.status === 401 && !refreshed) {
        // One refresh per request: an expired cached token, not a bad credential.
        refreshed = true;
        return attempt();
      }
      return response;
    };
    const result = await this.withRetry<T>(attempt, `${method} ${path}`);
    return { ...result, requestKey: options.requestKey ?? null };
  }

  private async withRetry<T>(send: () => Promise<Response>, label: string): Promise<{ data: T; status: number; attempts: number }> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const isLast = attempt === this.maxAttempts - 1;
      let response: Response;
      try {
        response = await send();
      } catch (error) {
        // Network failure or timeout: retryable, but surface it if we are out of attempts.
        lastError = error;
        if (isLast) {
          const reason = error instanceof Error ? (error.name === 'TimeoutError' || error.name === 'AbortError' ? `timed out after ${this.config.timeoutMs} ms` : error.message) : String(error);
          throw new OpenTableHttpError(`OpenTable ${label} failed: ${reason}`, { status: 0, retryable: true, attempts: attempt + 1 });
        }
        await this.sleep(backoffMs(attempt, { baseMs: 500, maxMs: 8000, random: this.random }));
        continue;
      }
      const text = await response.text().catch(() => '');
      if (response.ok) {
        let data: T;
        try {
          data = (text ? JSON.parse(text) : null) as T;
        } catch {
          throw new OpenTableHttpError(`OpenTable ${label} returned a non-JSON body (HTTP ${response.status}).`, { status: response.status, retryable: false, body: text, attempts: attempt + 1 });
        }
        return { data, status: response.status, attempts: attempt + 1 };
      }
      const retryable = isRetryableStatus(response.status);
      if (!retryable || isLast) {
        throw new OpenTableHttpError(`OpenTable ${label} failed (HTTP ${response.status}) after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}.`, {
          status: response.status,
          retryable,
          body: text,
          attempts: attempt + 1
        });
      }
      const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'), this.now());
      await this.sleep(retryAfter ?? backoffMs(attempt, { baseMs: 500, maxMs: 8000, random: this.random }));
    }
    throw new OpenTableHttpError(`OpenTable ${label} retry loop exhausted.`, { status: 0, retryable: true, attempts: this.maxAttempts, body: lastError instanceof Error ? lastError.message : '' });
  }
}

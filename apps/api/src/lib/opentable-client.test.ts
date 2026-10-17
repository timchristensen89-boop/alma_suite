import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OpenTableMenusPayload } from '@alma/shared';
import { OpenTableClient, OpenTableConfigError, OpenTableDisabledError, OpenTableHttpError, missingOpenTableConfig } from './opentable-client.js';

/**
 * The client against a scripted fetch. Every path the brief names — auth
 * failure, timeout, retry on 429/5xx, no retry on 4xx, idempotency header,
 * hard off-switch — without touching the network.
 */

type Call = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function scripted(responses: Array<Response | Error | ((call: Call) => Response | Error)>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${call.url}`);
    const value = typeof next === 'function' ? next(call) : next;
    if (value instanceof Error) throw value;
    return value;
  };
  return { calls, fetchImpl };
}

function makeClient(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof OpenTableClient>[0]> = {}) {
  const sleeps: number[] = [];
  const client = new OpenTableClient({
    enabled: true,
    clientId: 'id',
    clientSecret: 'secret',
    partnerName: 'alma',
    apiBase: 'https://platform.otqa.com',
    oauthBase: 'https://oauth-pp.opentable.com',
    timeoutMs: 1000,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    now: () => 1_000_000,
    ...over
  });
  return { client, sleeps };
}

const TOKEN = () => jsonResponse(200, { access_token: 'tok', token_type: 'Bearer', expires_in: 3600, scope: 'DEFAULT' });
const menus = { menus: [{ 'alma-menu-food': { id: 'alma-menu-food', name: 'Food', type: 'DINE_IN', defaultCurrency: 'AUD', ordinal: 1, groups: [] }, groups: {}, items: {}, itemSizes: {}, modifierGroups: {}, modifiers: {}, preModifierGroups: {}, preModifiers: {} }] } as unknown as OpenTableMenusPayload;

describe('OpenTableClient', () => {
  it('makes no call at all when disabled, and names missing config without values', async () => {
    const { calls, fetchImpl } = scripted([]);
    const { client } = makeClient(fetchImpl, { enabled: false });
    await assert.rejects(() => client.checkConnection(), OpenTableDisabledError);
    await assert.rejects(() => client.publishMenus('211307', menus, 'k'), OpenTableDisabledError);
    assert.equal(calls.length, 0);
    const unconfigured = makeClient(fetchImpl, { clientSecret: '', partnerName: '' }).client;
    await assert.rejects(() => unconfigured.checkConnection(), (error: unknown) => error instanceof OpenTableConfigError && error.message.includes('OPENTABLE_CLIENT_SECRET') && !error.message.includes('id:'));
    assert.deepEqual(missingOpenTableConfig({ clientId: 'x', clientSecret: '', partnerName: '' }), ['OPENTABLE_CLIENT_SECRET', 'OPENTABLE_PARTNER_NAME']);
    assert.equal(calls.length, 0);
  });

  it('requests a token with Basic auth and an empty JSON body, then sends the bearer and X-Request-Id', async () => {
    const { calls, fetchImpl } = scripted([TOKEN(), jsonResponse(200, { requestId: 1, totalItems: 1, totalProcessedItems: 1, itemStatus: [] })]);
    const { client } = makeClient(fetchImpl);
    const result = await client.publishMenus('211307', menus, 'alma-st-alma-menus-abc123');
    assert.equal(calls.length, 2);
    const [token, publish] = calls;
    assert.equal(token!.url, 'https://oauth-pp.opentable.com/api/v2/oauth/token?grant_type=client_credentials');
    assert.equal(token!.init.method, 'POST');
    const tokenHeaders = token!.init.headers as Record<string, string>;
    assert.equal(tokenHeaders.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
    assert.equal(tokenHeaders['Content-Length'], '0');
    assert.equal(token!.init.body, undefined);
    assert.equal(publish!.url, 'https://platform.otqa.com/v1/partnermenu/alma/location/211307/menus');
    const publishHeaders = publish!.init.headers as Record<string, string>;
    assert.equal(publishHeaders.Authorization, 'Bearer tok');
    assert.equal(publishHeaders['X-Request-Id'], 'alma-st-alma-menus-abc123');
    assert.deepEqual(JSON.parse(String(publish!.init.body)), menus);
    assert.ok(publish!.init.signal, 'every attempt carries an abort signal');
    assert.equal(result.attempts, 1);
    assert.equal(result.requestKey, 'alma-st-alma-menus-abc123');
  });

  it('reuses the cached token across calls and refreshes once on 401', async () => {
    const { calls, fetchImpl } = scripted([
      TOKEN,
      jsonResponse(200, { requestId: 1 }),
      jsonResponse(401, { error: 'expired' }),
      jsonResponse(200, { access_token: 'tok2', expires_in: 3600 }),
      jsonResponse(200, { requestId: 2 })
    ]);
    const { client } = makeClient(fetchImpl);
    await client.publishProfile('211307', { id: '211307', name: 'St Alma' }, 'p1');
    const second = await client.publishProfile('211307', { id: '211307', name: 'St Alma' }, 'p2');
    assert.equal(calls.length, 5);
    assert.equal((calls[4]!.init.headers as Record<string, string>).Authorization, 'Bearer tok2');
    assert.equal(second.data.requestId, 2);
    assert.equal(calls[1]!.url, 'https://platform.otqa.com/v2/partnerrestaurants/rid/211307');
  });

  it('surfaces an auth failure as a non-retryable error without the secret in it', async () => {
    const { calls, fetchImpl } = scripted([jsonResponse(401, { error: 'invalid_client' })]);
    const { client } = makeClient(fetchImpl);
    await assert.rejects(
      () => client.checkConnection(),
      (error: unknown) => error instanceof OpenTableHttpError && error.status === 401 && error.retryable === false && !error.message.includes('secret') && !error.body.includes('secret')
    );
    assert.equal(calls.length, 1);
  });

  it('retries 429 (honouring Retry-After) and 5xx, then succeeds', async () => {
    const { calls, fetchImpl } = scripted([TOKEN(), jsonResponse(429, {}, { 'retry-after': '2' }), jsonResponse(503, {}), jsonResponse(200, { requestId: 9 })]);
    const { client, sleeps } = makeClient(fetchImpl);
    const result = await client.publishMenus('211307', menus, 'k');
    assert.equal(result.data.requestId, 9);
    assert.equal(result.attempts, 3);
    assert.equal(sleeps[0], 2000, 'Retry-After wins');
    assert.ok(sleeps[1]! > 0 && sleeps[1]! <= 8000, 'backoff otherwise');
    assert.equal(calls.filter((call) => call.url.includes('/v1/partnermenu/')).length, 3);
    for (const call of calls.slice(1)) assert.equal((call.init.headers as Record<string, string>)['X-Request-Id'], 'k', 'same request id on every attempt');
  });

  it('does not retry a 400 and gives up after maxAttempts on 5xx', async () => {
    const bad = scripted([TOKEN(), jsonResponse(400, { message: 'menus[0] missing' })]);
    const { client } = makeClient(bad.fetchImpl);
    await assert.rejects(() => client.publishMenus('211307', menus, 'k'), (error: unknown) => error instanceof OpenTableHttpError && error.status === 400 && error.attempts === 1 && error.body.includes('missing'));
    assert.equal(bad.calls.length, 2);

    const down = scripted([TOKEN(), jsonResponse(502, {}), jsonResponse(502, {}), jsonResponse(502, {})]);
    const limited = makeClient(down.fetchImpl, { maxAttempts: 3 });
    await assert.rejects(() => limited.client.publishMenus('211307', menus, 'k'), (error: unknown) => error instanceof OpenTableHttpError && error.status === 502 && error.attempts === 3 && error.retryable);
    assert.equal(down.calls.length, 4);
  });

  it('treats a timeout as retryable and reports it plainly when attempts run out', async () => {
    const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { fetchImpl } = scripted([TOKEN(), timeout(), timeout()]);
    const { client, sleeps } = makeClient(fetchImpl, { maxAttempts: 2 });
    await assert.rejects(() => client.readMenus('211307'), (error: unknown) => error instanceof OpenTableHttpError && error.status === 0 && error.retryable && /timed out after 1000 ms/.test(error.message));
    assert.equal(sleeps.length, 1);
  });

  it('reads menus with GET and no body', async () => {
    const { calls, fetchImpl } = scripted([TOKEN(), jsonResponse(200, { restaurantMenuUrl: 'https://example.com/menu.pdf' })]);
    const { client } = makeClient(fetchImpl);
    const result = await client.readMenus('211301');
    assert.equal(calls[1]!.url, 'https://platform.otqa.com/v1/menus/rid/211301');
    assert.equal(calls[1]!.init.method, 'GET');
    assert.equal(calls[1]!.init.body, undefined);
    assert.equal(result.data.restaurantMenuUrl, 'https://example.com/menu.pdf');
  });

  it('rejects a non-JSON success body instead of pretending it was accepted', async () => {
    const { fetchImpl } = scripted([TOKEN(), new Response('<html>maintenance</html>', { status: 200 })]);
    const { client } = makeClient(fetchImpl);
    await assert.rejects(() => client.publishMenus('211307', menus, 'k'), (error: unknown) => error instanceof OpenTableHttpError && /non-JSON/.test(error.message));
  });
});

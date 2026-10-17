import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyWriteResponse, deriveCapabilityState, deriveConnectionState, requestKeyFor, shrinkOf } from './opentable.service.js';
import { buildOpenTableMenusPayload, type OpenTableMenusPayload } from '@alma/shared';

/** The dashboard vocabulary, derived from facts — never from "credentials exist". */

const configured = { apiEnabled: true, missingConfig: [], rid: '211307', venueEnabled: true, lastOk: null, lastError: null };

describe('deriveConnectionState', () => {
  it('is NOT_CONFIGURED without a rid, a venue switch, or server credentials', () => {
    assert.equal(deriveConnectionState({ ...configured, rid: null }).state, 'NOT_CONFIGURED');
    assert.equal(deriveConnectionState({ ...configured, venueEnabled: false }).state, 'NOT_CONFIGURED');
    const missing = deriveConnectionState({ ...configured, missingConfig: ['OPENTABLE_CLIENT_SECRET'] });
    assert.equal(missing.state, 'NOT_CONFIGURED');
    assert.match(missing.detail, /OPENTABLE_CLIENT_SECRET/);
  });

  it('is AWAITING_APPROVAL while the master flag is off, even with every credential present', () => {
    assert.equal(deriveConnectionState({ ...configured, apiEnabled: false, lastOk: true }).state, 'AWAITING_APPROVAL');
  });

  it('is CONNECTED only after a real token succeeded, ERROR after it failed, and never before a check', () => {
    assert.equal(deriveConnectionState({ ...configured, lastOk: true }).state, 'CONNECTED');
    const failed = deriveConnectionState({ ...configured, lastOk: false, lastError: 'HTTP 401' });
    assert.equal(failed.state, 'ERROR');
    assert.equal(failed.detail, 'HTTP 401');
    assert.notEqual(deriveConnectionState({ ...configured, lastOk: null }).state, 'CONNECTED');
  });
});

describe('deriveCapabilityState', () => {
  const base = {
    connection: 'CONNECTED' as const,
    connectionDetail: 'ok',
    flagOn: true,
    flagName: 'OPENTABLE_MENUS_WRITE_ENABLED',
    capabilityEnabled: true,
    capabilityLabel: 'Menu',
    currentHash: 'aaa',
    lastAcceptedHash: null,
    lastRun: null
  };

  it('follows the connection down, and the capability flag before anything else', () => {
    assert.equal(deriveCapabilityState({ ...base, connection: 'NOT_CONFIGURED' }).state, 'NOT_CONFIGURED');
    assert.equal(deriveCapabilityState({ ...base, capabilityEnabled: false }).state, 'NOT_CONFIGURED');
    const awaiting = deriveCapabilityState({ ...base, flagOn: false, lastAcceptedHash: 'aaa' });
    assert.equal(awaiting.state, 'AWAITING_APPROVAL');
    assert.match(awaiting.detail, /OPENTABLE_MENUS_WRITE_ENABLED/);
    assert.equal(deriveCapabilityState({ ...base, connection: 'AWAITING_APPROVAL' }).state, 'AWAITING_APPROVAL');
    assert.equal(deriveCapabilityState({ ...base, connection: 'ERROR' }).state, 'ERROR');
  });

  it('tells never-sent, submitted, accepted, out of date and failed apart by hash and last run', () => {
    const ready = deriveCapabilityState(base);
    assert.equal(ready.state, 'CONNECTED');
    assert.match(ready.detail, /Ready to submit/);
    assert.equal(deriveCapabilityState({ ...base, lastRun: { status: 'SUBMITTED', error: null } }).state, 'SUBMITTED');
    const accepted = deriveCapabilityState({ ...base, lastAcceptedHash: 'aaa' });
    assert.equal(accepted.state, 'SYNCED');
    assert.match(accepted.detail, /not verified/i, 'acceptance by the API is not publication');
    assert.doesNotMatch(accepted.detail, /live|successfully synced/i);
    const verified = deriveCapabilityState({ ...base, lastAcceptedHash: 'aaa', verified: true });
    assert.equal(verified.state, 'SYNCED');
    assert.match(verified.detail, /verified: a read-back/i);
    assert.equal(deriveCapabilityState({ ...base, lastAcceptedHash: 'bbb' }).state, 'OUT_OF_DATE');
    assert.equal(deriveCapabilityState({ ...base, lastAcceptedHash: 'aaa', lastRun: { status: 'FAILED', error: 'HTTP 500' } }).state, 'ERROR');
    assert.equal(deriveCapabilityState({ ...base, lastAcceptedHash: 'aaa', lastRun: { status: 'PARTIAL', error: null } }).state, 'ERROR');
    assert.equal(deriveCapabilityState({ ...base, lastAcceptedHash: 'aaa', lastRun: { status: 'SKIPPED', error: null } }).state, 'SYNCED', 'a skipped run is not a failure');
  });
});

describe('classifyWriteResponse', () => {
  it('is ACCEPTED only when every item was processed, and never says "live"', () => {
    const ok = classifyWriteResponse({ requestId: 132658925, totalItems: 3, totalProcessedItems: 3, itemStatus: [{ itemId: 'a', status: 'Processing' }] });
    assert.equal(ok.status, 'ACCEPTED');
    assert.match(ok.summary, /request 132658925/);
    assert.match(ok.summary, /asynchronous/);
    assert.doesNotMatch(ok.summary, /live/i);
  });

  it('is PARTIAL when the counts fall short or an item status is a rejection', () => {
    assert.equal(classifyWriteResponse({ totalItems: 3, totalProcessedItems: 2 }).status, 'PARTIAL');
    const rejected = classifyWriteResponse({ totalItems: 1, totalProcessedItems: 1, itemStatus: [{ itemId: 'a', status: 'Failed', message: 'bad price' }] });
    assert.equal(rejected.status, 'PARTIAL');
    assert.match(rejected.summary, /1 item rejected/);
  });

  it('accepts an empty body as accepted-without-detail rather than crashing', () => {
    assert.equal(classifyWriteResponse(null).status, 'ACCEPTED');
  });
});

describe('requestKeyFor', () => {
  it('is stable per venue, kind and payload', () => {
    const hash = 'abcdef0123456789abcdef';
    assert.equal(requestKeyFor('st-alma', 'menus', hash), 'alma-st-alma-menus-abcdef012345');
    assert.equal(requestKeyFor('st-alma', 'menus', hash), requestKeyFor('st-alma', 'menus', hash));
    assert.notEqual(requestKeyFor('alma-avalon', 'menus', hash), requestKeyFor('st-alma', 'menus', hash));
    assert.notEqual(requestKeyFor('st-alma', 'profile', hash), requestKeyFor('st-alma', 'menus', hash));
  });
});

describe('shrinkOf', () => {
  const big = buildOpenTableMenusPayload([
    { slug: 'food', kind: 'FOOD', name: 'Food', status: 'ACTIVE', visibility: 'PUBLIC', snapshot: { schemaVersion: 2, menuId: 'm', menuName: 'Food', templateKey: 't', venue: { id: 'v', name: 'V', slug: 'v' }, versionNumber: 1, publishedAt: null, heading: '', subheading: '', whenLine: '', heroPriceCents: null, heroPriceUnit: null, conditions: '', showPrices: true, pageCount: 1, dietaryNote: '', surchargeLine: '', sections: [{ title: 'A', headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, items: ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ dishKey: name, name, description: null, priceCents: 1000, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: [], isSeafood: false, visible: true, recipeId: null })) }] } }
  ]).payload;
  const small: OpenTableMenusPayload = JSON.parse(JSON.stringify(big));
  for (const key of Object.keys(small.menus[0]!.items).slice(2)) delete small.menus[0]!.items[key];

  it('flags a payload with under half the previously accepted items, and nothing on a first submission', () => {
    assert.deepEqual(shrinkOf(big, small), { previousItems: 6, nextItems: 2 });
    assert.equal(shrinkOf(big, big), null);
    assert.equal(shrinkOf(null, small), null);
  });
});

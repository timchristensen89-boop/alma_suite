import assert from 'node:assert/strict';
import test from 'node:test';
import { complianceAttentionLine, summariseTemperatureAssets, temperatureAssetFlags } from '@alma/shared';

// 2026-09-26 in Sydney (AEST, +10). 23:00Z on the 25th is 09:00 on the 26th.
const SYDNEY_MORNING = new Date('2026-09-25T23:00:00.000Z');

const asset = (
  logs: Array<{ recordedAt: string; status: 'IN_RANGE' | 'OUT_OF_RANGE' }>,
  extra: Partial<{ status: 'ACTIVE' | 'INACTIVE'; lastSyncAt: string | null }> = {}
) => ({ status: 'ACTIVE' as const, lastSyncAt: null, ...extra, logs });

test('a missing log is not a failure: no reading today, latest reading in range', () => {
  const flags = temperatureAssetFlags(asset([{ recordedAt: '2026-09-25T06:00:00.000Z', status: 'IN_RANGE' }]), SYDNEY_MORNING);
  assert.deepEqual(flags, { outOfRange: false, missingToday: true, syncedToday: false });
});

test('a reading taken this venue morning is not missing, even though it is still yesterday in UTC', () => {
  // 22:30Z on the 25th is 08:30 on the 26th in Sydney — today's opening check.
  const flags = temperatureAssetFlags(asset([{ recordedAt: '2026-09-25T22:30:00.000Z', status: 'IN_RANGE' }]), SYDNEY_MORNING);
  assert.equal(flags.missingToday, false);
  // The same reading measured against a UTC midnight would have read as
  // missing until 10am Sydney; that was the symptom.
  const utcMidnight = new Date('2026-09-26T00:00:00.000Z');
  assert.equal(new Date('2026-09-25T22:30:00.000Z') < utcMidnight, true);
});

test('a breach is out of range whenever it was recorded, and also missing once it is stale', () => {
  const fresh = temperatureAssetFlags(asset([{ recordedAt: '2026-09-25T22:45:00.000Z', status: 'OUT_OF_RANGE' }]), SYDNEY_MORNING);
  assert.deepEqual(fresh, { outOfRange: true, missingToday: false, syncedToday: false });
  const stale = temperatureAssetFlags(asset([{ recordedAt: '2026-09-24T22:45:00.000Z', status: 'OUT_OF_RANGE' }]), SYDNEY_MORNING);
  assert.deepEqual(stale, { outOfRange: true, missingToday: true, syncedToday: false });
});

test('an asset with no readings at all is missing, not out of range', () => {
  assert.deepEqual(temperatureAssetFlags(asset([]), SYDNEY_MORNING), { outOfRange: false, missingToday: true, syncedToday: false });
});

test('the symptom: five missing logs and zero breaches count as five missing, zero out of range', () => {
  const assets = Array.from({ length: 5 }, () => asset([{ recordedAt: '2026-09-25T05:00:00.000Z', status: 'IN_RANGE' }]));
  const counts = summariseTemperatureAssets(assets, SYDNEY_MORNING);
  assert.deepEqual(counts, { activeAssets: 5, outOfRangeNow: 0, missingToday: 5, syncedToday: 0 });
  const line = complianceAttentionLine({ openIssues: 0, outOfRangeNow: counts.outOfRangeNow, missingToday: counts.missingToday });
  assert.equal(line.text, '5 temperature logs missing today.');
  assert.equal(line.tone, 'warning');
  assert.doesNotMatch(line.text, /out of range/);
});

test('inactive assets are outside every column', () => {
  const counts = summariseTemperatureAssets(
    [
      asset([{ recordedAt: '2026-09-25T22:45:00.000Z', status: 'OUT_OF_RANGE' }], { status: 'INACTIVE' }),
      asset([], { status: 'INACTIVE' })
    ],
    SYDNEY_MORNING
  );
  assert.deepEqual(counts, { activeAssets: 0, outOfRangeNow: 0, missingToday: 0, syncedToday: 0 });
});

test('synced today follows the venue day too', () => {
  const flags = temperatureAssetFlags(
    asset([{ recordedAt: '2026-09-25T22:45:00.000Z', status: 'IN_RANGE' }], { lastSyncAt: '2026-09-25T22:50:00.000Z' }),
    SYDNEY_MORNING
  );
  assert.equal(flags.syncedToday, true);
});

test('the attention line keeps each count in its own clause and severity follows the worst', () => {
  assert.deepEqual(complianceAttentionLine({ openIssues: 0, outOfRangeNow: 0, missingToday: 0 }), {
    text: 'Issues, checklists and logs are all current.',
    tone: 'positive'
  });
  assert.deepEqual(complianceAttentionLine({ openIssues: 0, outOfRangeNow: 1, missingToday: 0 }), {
    text: '1 temperature out of range.',
    tone: 'danger'
  });
  assert.deepEqual(complianceAttentionLine({ openIssues: 2, overdueIssues: 1, outOfRangeNow: 1, missingToday: 3 }), {
    text: '2 open issues (1 overdue), 1 temperature out of range and 3 temperature logs missing today.',
    tone: 'danger'
  });
  assert.deepEqual(complianceAttentionLine({ openIssues: 1, outOfRangeNow: 0, missingToday: 0 }), {
    text: '1 open issue sitting on the board.',
    tone: 'danger'
  });
});

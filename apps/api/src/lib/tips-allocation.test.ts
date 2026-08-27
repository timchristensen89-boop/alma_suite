import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocateTipsByVenue, splitByHours } from './tips-allocation.js';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const person = (name: string, venue: string | null, approvedHours: number) => ({
  staffProfileId: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  roleTitle: null,
  venue,
  approvedHours
});

describe('splitByHours', () => {
  it('splits by hours worked, not by headcount', () => {
    const lines = splitByHours(30000, [person('Ana', 'St Alma', 30), person('Ben', 'St Alma', 10)]);
    assert.deepEqual(lines.map((l) => l.amountCents), [22500, 7500]);
  });

  it('allocates every cent, however it divides', () => {
    // $100 across three equal shifts — 3333.33 each, so a cent has to land somewhere.
    const lines = splitByHours(10000, [
      person('Ana', 'St Alma', 8),
      person('Ben', 'St Alma', 8),
      person('Cal', 'St Alma', 8)
    ]);
    assert.equal(sum(lines.map((l) => l.amountCents)), 10000);
    assert.deepEqual(lines.map((l) => l.amountCents), [3333, 3333, 3334]);
  });

  it('pays nobody when nobody has approved hours', () => {
    const lines = splitByHours(10000, [person('Ana', 'St Alma', 0)]);
    assert.deepEqual(lines.map((l) => l.amountCents), [0]);
  });
});

describe('allocateTipsByVenue', () => {
  // The week that started this: Avalon took its tips through Lightspeed, St
  // Alma through Square, and the two must never end up in one pot.
  const cardEntries = [
    { serviceDate: day('2026-08-19'), venue: 'Alma Avalon', amountCents: 48315 },
    { serviceDate: day('2026-08-20'), venue: 'Alma Avalon', amountCents: 19905 },
    { serviceDate: day('2026-08-19'), venue: 'St Alma', amountCents: 40000 },
    { serviceDate: day('2026-08-21'), venue: 'St Alma', amountCents: 20000 }
  ];

  it('keeps each venue\'s money inside that venue', () => {
    const result = allocateTipsByVenue({
      cashEntries: [],
      cardEntries,
      hours: [person('Ana', 'Alma Avalon', 10), person('Ben', 'St Alma', 10), person('Cal', 'St Alma', 30)]
    });

    const avalon = result.entitlements.filter((e) => e.venue === 'Alma Avalon');
    const stAlma = result.entitlements.filter((e) => e.venue === 'St Alma');
    // Ana worked a tenth of St Alma's hours but sees none of St Alma's money.
    assert.deepEqual(avalon.map((e) => [e.name, e.amountCents]), [['Ana', 68220]]);
    assert.deepEqual(stAlma.map((e) => [e.name, e.amountCents]), [['Ben', 15000], ['Cal', 45000]]);
  });

  it('reports one trading day when both venues trade the same night', () => {
    const result = allocateTipsByVenue({ cashEntries: [], cardEntries, hours: [] });
    // Four entries, three dates, and the 19th is shared.
    assert.equal(result.tradingDays, 3);
    assert.deepEqual(result.venues.map((v) => [v.venue, v.tradingDays]), [['Alma Avalon', 2], ['St Alma', 2]]);
  });

  it('sums the venue pools without ever merging them', () => {
    const result = allocateTipsByVenue({
      cashEntries: [{ serviceDate: day('2026-08-20'), venue: 'St Alma', amountCents: 5000 }],
      cardEntries,
      hours: [person('Ana', 'Alma Avalon', 10), person('Ben', 'St Alma', 10)]
    });
    assert.equal(result.tipPoolCents, 133220);
    assert.equal(result.cashTipsCents, 5000);
    assert.equal(result.squareTipsCents, 128220);
    assert.deepEqual(result.venues.map((v) => [v.venue, v.tipPoolCents]), [['Alma Avalon', 68220], ['St Alma', 65000]]);
  });

  it('names anyone whose hours have no venue instead of dropping them', () => {
    const result = allocateTipsByVenue({
      cashEntries: [],
      cardEntries,
      hours: [person('Ana', 'Alma Avalon', 10), person('Nobody Home', null, 32)]
    });
    assert.deepEqual(result.unassigned, [{ staffProfileId: 'nobody-home', name: 'Nobody Home', approvedHours: 32 }]);
    assert.ok(!result.entitlements.some((e) => e.name === 'Nobody Home'));
    // And they take nothing from the venue that did trade.
    assert.equal(result.entitlements.find((e) => e.name === 'Ana')?.amountCents, 68220);
  });

  it('shows a venue whose pool could not be allocated rather than hiding it', () => {
    // St Alma took $600 and nobody there has approved hours yet.
    const result = allocateTipsByVenue({
      cashEntries: [],
      cardEntries,
      hours: [person('Ana', 'Alma Avalon', 10)]
    });
    const stAlma = result.venues.find((v) => v.venue === 'St Alma');
    assert.equal(stAlma?.tipPoolCents, 60000);
    assert.equal(stAlma?.allocatedCents, 0);
    assert.equal(stAlma?.staffCount, 0);
  });

  it('lists a venue that worked but took no tips', () => {
    const result = allocateTipsByVenue({
      cashEntries: [],
      cardEntries: [],
      hours: [person('Ana', 'Alma Avalon', 10)]
    });
    assert.deepEqual(result.venues.map((v) => [v.venue, v.tipPoolCents, v.approvedHours]), [['Alma Avalon', 0, 10]]);
    assert.equal(result.entitlements[0]?.amountCents, 0);
  });

  it('ignores hours rows that came to nothing', () => {
    const result = allocateTipsByVenue({
      cashEntries: [],
      cardEntries: [{ serviceDate: day('2026-08-19'), venue: 'St Alma', amountCents: 10000 }],
      hours: [person('Ana', 'St Alma', 10), person('Ghost', 'St Alma', 0)]
    });
    assert.deepEqual(result.entitlements.map((e) => e.name), ['Ana']);
    assert.equal(result.entitlements[0]?.amountCents, 10000);
  });
});

import { posFirstCardEntries } from './tips-allocation.js';

const cardRow = (venue: string, day: string, source: string, amountCents: number) => ({
  venue,
  serviceDate: new Date(`${day}T00:00:00.000Z`),
  source,
  amountCents
});

it('POS-first tips: the register wins over an import on the same venue+day', () => {
  const kept = posFirstCardEntries([
    cardRow('St Alma', '2026-08-19', 'alma-pos', 5000),
    cardRow('St Alma', '2026-08-19', 'square', 5000)
  ]);
  assert.deepEqual(kept.map((r) => r.source), ['alma-pos']);
});

it('POS-first tips: an import stands where the register recorded nothing that day', () => {
  const kept = posFirstCardEntries([cardRow('Alma Avalon', '2026-08-19', 'lightspeed', 4200)]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.source, 'lightspeed');
});

it('POS-first tips: the rule is per venue AND per day, not global', () => {
  const kept = posFirstCardEntries([
    cardRow('St Alma', '2026-08-19', 'alma-pos', 5000),
    cardRow('St Alma', '2026-08-20', 'square', 3000),
    cardRow('Alma Avalon', '2026-08-19', 'lightspeed', 4200)
  ]);
  assert.equal(kept.length, 3);
});

it('POS-first tips: manual (control) entries are always kept', () => {
  const kept = posFirstCardEntries([
    cardRow('St Alma', '2026-08-19', 'alma-pos', 5000),
    cardRow('St Alma', '2026-08-19', 'control', 1200)
  ]);
  assert.equal(kept.length, 2);
});

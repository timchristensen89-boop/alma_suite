import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySimChanges, menuTotals, simDelta, type SimDish } from './menu-sim.js';

const dish = (over: Partial<SimDish> & { id: string }): SimDish => ({
  title: over.id,
  group: 'Tacos',
  qty: 10,
  priceCents: 2000,
  costCents: 500,
  ...over
});

// A tiny menu with a deliberate spread: cheap-to-make taco, dear snapper,
// mid-range chook. Blended COGS = (10·500 + 5·1400 + 5·700) / (10·2000 + 5·4000 + 5·2400)
// = 15500/52000 ≈ 29.8%.
const MENU: SimDish[] = [
  dish({ id: 'taco', qty: 10, priceCents: 2000, costCents: 500 }),
  dish({ id: 'snapper', group: 'Mains', qty: 5, priceCents: 4000, costCents: 1400 }),
  dish({ id: 'chook', group: 'Mains', qty: 5, priceCents: 2400, costCents: 700 })
];

describe('menuTotals', () => {
  it('is sales-mix weighted, not an average of dish percentages', () => {
    const totals = menuTotals(MENU);
    assert.equal(totals.revenueCents, 52000);
    assert.equal(totals.costCents, 15500);
    assert.ok(Math.abs((totals.cogsPercent ?? 0) - 29.8) < 0.1);
    // Average of dish COGS %s (25, 35, 29.2) would be ~29.7 here but with
    // different quantities the two diverge — assert the weighted identity.
    assert.equal(totals.gpCents, 36500);
  });

  it('refuses a percentage of nothing', () => {
    assert.equal(menuTotals([]).cogsPercent, null);
  });
});

describe('remove without redistribution', () => {
  it('drops the dish and its volume entirely', () => {
    const rows = applySimChanges(MENU, [{ kind: 'remove', id: 'snapper' }], false);
    assert.equal(rows.length, 2);
    const totals = menuTotals(rows);
    // 52000-20000 revenue, 15500-7000 cost.
    assert.equal(totals.revenueCents, 32000);
    assert.equal(totals.costCents, 8500);
  });
});

describe('remove with redistribution', () => {
  it('keeps the group volume constant — guests order something else', () => {
    const rows = applySimChanges(MENU, [{ kind: 'remove', id: 'snapper' }], true);
    const mains = rows.filter((row) => row.group === 'Mains');
    assert.equal(mains.length, 1);
    // Chook absorbs the snapper's 5 units: 5 × (1 + 5/5) = 10.
    assert.equal(mains[0]!.qty, 10);
    // Killing the dearest dish improves the whole menu's number.
    const before = menuTotals(MENU).cogsPercent!;
    const after = menuTotals(rows).cogsPercent!;
    assert.ok(after < before);
  });

  it('splits the dead volume in proportion to how survivors already sell', () => {
    const menu = [
      dish({ id: 'a', group: 'G', qty: 12 }),
      dish({ id: 'b', group: 'G', qty: 6 }),
      dish({ id: 'c', group: 'G', qty: 2 })
    ];
    const rows = applySimChanges(menu, [{ kind: 'remove', id: 'a' }], true);
    const byId = new Map(rows.map((row) => [row.id, row]));
    // 12 units split 6:2 across b and c → b gets 9, c gets 3.
    assert.equal(byId.get('b')!.qty, 6 + 9);
    assert.equal(byId.get('c')!.qty, 2 + 3);
    // Total group volume preserved.
    assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), 20);
  });

  it('lets volume vanish when the group has no other sellers', () => {
    const rows = applySimChanges(MENU, [{ kind: 'remove', id: 'taco' }], true);
    // Tacos had one dish; nothing to absorb it. Mains untouched.
    assert.equal(rows.reduce((sum, row) => sum + row.qty, 0), 10);
  });

  it('never redistributes into a dish that is itself removed', () => {
    const rows = applySimChanges(
      MENU,
      [
        { kind: 'remove', id: 'snapper' },
        { kind: 'remove', id: 'chook' }
      ],
      true
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'taco');
    assert.equal(rows[0]!.qty, 10);
  });
});

describe('replace and edit', () => {
  it('replace inherits the demand but swaps the economics', () => {
    const rows = applySimChanges(
      MENU,
      [{ kind: 'replace', id: 'snapper', title: 'Market fish', priceCents: 3800, costCents: 1000 }],
      true
    );
    const fish = rows.find((row) => row.title === 'Market fish')!;
    assert.equal(fish.qty, 5);
    assert.equal(fish.priceCents, 3800);
    assert.ok(menuTotals(rows).cogsPercent! < menuTotals(MENU).cogsPercent!);
  });

  it('edit moves only the economics, and a price rise lowers the blended percent', () => {
    const rows = applySimChanges(MENU, [{ kind: 'edit', id: 'taco', priceCents: 2200, costCents: 500 }], true);
    assert.equal(menuTotals(rows).revenueCents, 52000 + 10 * 200);
    assert.ok(menuTotals(rows).cogsPercent! < menuTotals(MENU).cogsPercent!);
  });
});

describe('simDelta', () => {
  it('reports point delta and GP movement', () => {
    const before = menuTotals(MENU);
    const after = menuTotals(applySimChanges(MENU, [{ kind: 'remove', id: 'snapper' }], true));
    const delta = simDelta(before, after);
    assert.ok(delta.cogsPointDelta! < 0);
    // Redistributed onto the cheaper chook: GP holds up better than revenue.
    assert.equal(after.gpCents - before.gpCents, delta.gpDeltaCents);
  });
});

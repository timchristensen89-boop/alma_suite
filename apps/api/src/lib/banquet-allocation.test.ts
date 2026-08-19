import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocatePackageRevenue } from './banquet-allocation.js';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('allocatePackageRevenue', () => {
  it('shares by a la carte value, not by headcount', () => {
    // Four covers on a $99 menu: 3 kingfish ($26) and 1 taco ($12) to start,
    // 2 market fish ($46) and 2 orzo ($34) to follow.
    const shares = allocatePackageRevenue(39600, [
      { quantity: 3, alaCarteCents: 2600 },
      { quantity: 1, alaCarteCents: 1200 },
      { quantity: 2, alaCarteCents: 4600 },
      { quantity: 2, alaCarteCents: 3400 }
    ]);
    // Weights 7800 / 1200 / 9200 / 6800 of 25000.
    assert.deepEqual(shares, [12355, 1901, 14573, 10771]);
    assert.equal(sum(shares), 39600);
  });

  it('gives the dearer dish more per serve', () => {
    const [fish, orzo] = allocatePackageRevenue(19800, [
      { quantity: 2, alaCarteCents: 4600 },
      { quantity: 2, alaCarteCents: 3400 }
    ]);
    assert.ok(fish! / 2 > orzo! / 2);
  });

  it('allocates every cent, however it divides', () => {
    // Three equal dishes on $100 — 3333.33 each, so a cent has to go somewhere.
    const shares = allocatePackageRevenue(10000, [
      { quantity: 1, alaCarteCents: 1000 },
      { quantity: 1, alaCarteCents: 1000 },
      { quantity: 1, alaCarteCents: 1000 }
    ]);
    assert.equal(sum(shares), 10000);
    assert.deepEqual(shares, [3334, 3333, 3333]);
  });

  it('splits per serving when nothing on the table is priced', () => {
    const shares = allocatePackageRevenue(9000, [
      { quantity: 2, alaCarteCents: null },
      { quantity: 1, alaCarteCents: 0 }
    ]);
    assert.deepEqual(shares, [6000, 3000]);
    assert.equal(sum(shares), 9000);
  });

  it('is inert when there is nothing to divide or nothing to divide it among', () => {
    assert.deepEqual(allocatePackageRevenue(9900, []), []);
    assert.deepEqual(allocatePackageRevenue(0, [{ quantity: 2, alaCarteCents: 2600 }]), [0]);
    // A package with no dishes under it: no split is better than a made-up one.
    assert.deepEqual(allocatePackageRevenue(9900, [{ quantity: 0, alaCarteCents: 0 }]), [0]);
  });

  it('ignores negative prices rather than letting them steal revenue', () => {
    const shares = allocatePackageRevenue(10000, [
      { quantity: 1, alaCarteCents: -500 },
      { quantity: 1, alaCarteCents: 1000 }
    ]);
    assert.deepEqual(shares, [0, 10000]);
  });
});

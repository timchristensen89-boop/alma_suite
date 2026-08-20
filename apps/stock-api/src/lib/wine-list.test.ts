import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWineList, wineLabel } from './wine-list.js';

const HEADER = 'venue\tvintage\tproducer\tcuvee\tgrape\tregion\torigin\tsection\tband\tpours\tpairs\tflags\tnote';

function sheet(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseWineList', () => {
  it('reads a full row', () => {
    const [row] = parseWineList(
      sheet(
        "St Alma\t2019\tChâteau Domecq\t\tCabernet Sauvignon\tValle de Guadalupe\tMexico\tRed\tMedium\t750:71\tbeef,lamb\torganic\tDusty and savoury."
      )
    );
    assert.equal(row?.venue, 'St Alma');
    assert.equal(row?.vintage, 2019);
    assert.equal(row?.producer, 'Château Domecq');
    assert.equal(row?.cuvee, null);
    assert.deepEqual(row?.pours, [{ ml: 750, priceCents: 7100 }]);
    assert.deepEqual(row?.pairs, ['beef', 'lamb']);
    assert.deepEqual(row?.flags, ['organic']);
    assert.equal(row?.note, 'Dusty and savoury.');
  });

  it('reads dollars into cents, across every pour', () => {
    // The one that matters: these numbers become the price on a bottle.
    const [row] = parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\t150:16|250:26|750:73\t\t\t'));
    assert.deepEqual(row?.pours, [
      { ml: 150, priceCents: 1600 },
      { ml: 250, priceCents: 2600 },
      { ml: 750, priceCents: 7300 }
    ]);
  });

  it('does not lose a cent on a price that is not whole dollars', () => {
    const [row] = parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\t750:73.50\t\t\t'));
    assert.equal(row?.pours[0]?.priceCents, 7350);
  });

  it('treats NV as no vintage, not as a year', () => {
    const [row] = parseWineList(sheet('St Alma\tNV\tPol Roger\tBrut Rosé\t\t\t\t\t\t750:315\t\t\t'));
    assert.equal(row?.vintage, null);
  });

  it('pads the trailing empties a spreadsheet drops', () => {
    // A row saved through Excel loses its empty tail columns entirely.
    const [row] = parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\t750:73'));
    assert.equal(row?.note, null);
    assert.deepEqual(row?.flags, []);
  });

  it('refuses a row with too many columns rather than guessing', () => {
    assert.throws(
      () => parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\t750:73\t\t\t\tstray')),
      /has 14 columns/
    );
  });

  it('refuses a sheet whose header has moved', () => {
    assert.throws(() => parseWineList('venue\tproducer\n' + 'St Alma\tCapa'), /Unexpected columns/);
  });

  it('refuses a pour it cannot read as a number', () => {
    assert.throws(() => parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\tbottle:73\t\t\t')), /Bad pour size/);
    assert.throws(() => parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\t750:POA\t\t\t')), /Bad pour price/);
  });

  it('accepts a wine with no pours at all', () => {
    const [row] = parseWineList(sheet('St Alma\t2024\tCapa\t\t\t\t\t\t\t\t\t\t'));
    assert.deepEqual(row?.pours, []);
  });
});

describe('wineLabel', () => {
  it('reads the way the reports print it', () => {
    const [row] = parseWineList(sheet("St Alma\t2019\tChâteau Domecq\tReserva\t\t\t\t\t\t750:71\t\t\t"));
    assert.equal(wineLabel(row!, 750), "St Alma · 2019 Château Domecq 'Reserva' 750mL");
  });

  it('says NV where there is no vintage', () => {
    const [row] = parseWineList(sheet('St Alma\tNV\tPol Roger\t\t\t\t\t\t\t750:315\t\t\t'));
    assert.equal(wineLabel(row!), 'St Alma · NV Pol Roger');
  });
});

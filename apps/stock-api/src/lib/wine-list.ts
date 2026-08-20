/**
 * The printed wine list as a table: docs/wine-list.tsv, one row per wine, with
 * its pours and their menu prices.
 *
 * Kept out of the scripts that use it because more than one now does, and
 * because a mis-parse here does not fail loudly — it prices a bottle wrongly.
 * Covered by wine-list.test.ts.
 *
 * The file itself is transcribed from the printed drinks lists by hand, so the
 * parser is strict about shape and forgiving about nothing: a row with the
 * wrong number of columns is corruption, not a row to guess at.
 */

export type WinePourPrice = {
  ml: number;
  /** What the printed list charges for this pour. */
  priceCents: number;
};

export type WineListRow = {
  venue: string;
  /** NULL for non-vintage — champagne, most prosecco. */
  vintage: number | null;
  producer: string;
  cuvee: string | null;
  grape: string | null;
  region: string | null;
  origin: string | null;
  /** The heading it sits under on the printed list. */
  section: string | null;
  /** The style band within that heading. */
  band: string | null;
  pours: WinePourPrice[];
  pairs: string[];
  flags: string[];
  note: string | null;
};

const COLUMNS = [
  'venue', 'vintage', 'producer', 'cuvee', 'grape', 'region',
  'origin', 'section', 'band', 'pours', 'pairs', 'flags', 'note'
] as const;

/**
 * `150:16|250:26|750:73` — millilitres and DOLLARS, because that is how the
 * list is read off a menu. Cents are this function's business, not the
 * transcriber's.
 */
function parsePours(field: string): WinePourPrice[] {
  return field
    .split('|')
    .filter(Boolean)
    .map((part) => {
      const [ml = '', price = ''] = part.split(':');
      const pour = { ml: Number(ml), priceCents: Math.round(Number(price) * 100) };
      if (!Number.isFinite(pour.ml) || pour.ml <= 0) throw new Error(`Bad pour size in "${field}"`);
      if (!Number.isFinite(pour.priceCents) || pour.priceCents < 0) throw new Error(`Bad pour price in "${field}"`);
      return pour;
    });
}

export function parseWineList(text: string): WineListRow[] {
  // Defaults throughout rather than casts: split() is typed as possibly-sparse
  // and the length check below is what actually guarantees these are there, so
  // the defaults are unreachable and the compiler stays honest about it.
  const [header = '', ...lines] = text.trim().split('\n');
  const cols = header.split('\t');
  if (cols.join(',') !== COLUMNS.join(',')) {
    throw new Error(`Unexpected columns: ${cols.join(',')}`);
  }
  return lines.map((line, index) => {
    const f = line.split('\t');
    // Trailing empty columns vanish through most editors and any spreadsheet
    // round trip, so pad them back. Too MANY columns is real corruption.
    while (f.length < COLUMNS.length) f.push('');
    if (f.length !== COLUMNS.length) {
      throw new Error(`Row ${index + 2} has ${f.length} columns, expected ${COLUMNS.length}`);
    }
    const [
      venue = '', vintage = '', producer = '', cuvee = '', grape = '', region = '',
      origin = '', section = '', band = '', pours = '', pairs = '', flags = '', note = ''
    ] = f;
    return {
      venue,
      vintage: vintage === 'NV' || !vintage ? null : Number(vintage),
      producer,
      cuvee: cuvee || null,
      grape: grape || null,
      region: region || null,
      origin: origin || null,
      section: section || null,
      band: band || null,
      pours: parsePours(pours),
      pairs: pairs.split(',').filter(Boolean),
      flags: flags.split(',').filter(Boolean),
      note: note || null
    };
  });
}

/** How a wine reads in a report: "St Alma · 2019 Château Domecq 750mL". */
export function wineLabel(row: WineListRow, ml?: number): string {
  const name = `${row.producer}${row.cuvee ? ` '${row.cuvee}'` : ''}`;
  return `${row.venue} · ${row.vintage ?? 'NV'} ${name}${ml ? ` ${ml}mL` : ''}`;
}

/**
 * Reading a stocktake out of a Loaded PDF export.
 *
 * Counting is the last thing still being done in Loaded, and the way back out
 * is a PDF. The export is a real table — category, item, unit, quantity, value —
 * but PDF text has no columns: the value column arrives in a separate text run
 * from the item, so reading the page in reading order gives every item first
 * and then a wall of detached money. Extracting by position and grouping on the
 * y-coordinate puts each row back together, which is what this function is fed.
 *
 * Two details from the real files, both found by parsing them:
 *
 *  - Ligatures split a name across runs. "Cauliflower" arrives as
 *    ["Cauli", "fl", "ower"] and "Glenfiddich" as ["Glen", "fi", "ddich 12YO"].
 *    So the name is everything *before* the last three cells, joined with no
 *    separator — never cell[0].
 *  - Units contain spaces ("750 mL", "12 Pack", "100 Grams"), so the unit
 *    cannot be found by splitting on whitespace either.
 *
 * The parse is checked against the document's own arithmetic rather than
 * trusted: every category prints a total, and the sheet prints a grand total.
 * If the lines this function returns do not add up to those printed figures,
 * the parse is wrong and `discrepancies` says so. A silent mis-parse would
 * write wrong quantities into stock on hand.
 */

/** A row of cells as extracted from the PDF, in left-to-right order. */
export type PdfRow = string[];

export type LoadedCountLine = {
  category: string;
  name: string;
  /** The unit Loaded counted in — "750 mL", "Each", "Kilo". */
  unit: string;
  quantity: number;
  valueCents: number;
};

export type LoadedStocktake = {
  venue: string | null;
  /** The date as printed, e.g. "Sat 1st Aug, 10:00 AM". Not parsed here. */
  countedAtText: string | null;
  countedBy: string | null;
  lines: LoadedCountLine[];
  categoryTotals: Array<{ category: string; printedCents: number; summedCents: number }>;
  printedTotalCents: number | null;
  summedTotalCents: number;
  /** Where our arithmetic disagrees with the sheet's. Empty means it reconciles. */
  discrepancies: string[];
  /**
   * True when the sheet has items but nothing was counted — a blank sheet
   * printed to write on. Importing one would zero every item it lists.
   */
  isBlank: boolean;
};

/**
 * How far Alma's valuation of a counted line may sit from Loaded's before the
 * line is suspect.
 *
 * Loaded prints what it thinks every line is worth, which makes an import the
 * one moment where two independent valuations of the same shelf can be put side
 * by side — a much sharper test than any within-sheet heuristic, which can only
 * ask whether a line looks large next to its neighbours.
 *
 * Measured on the St Alma drinks count of 1 August, after unit reconciliation:
 * 131 comparable lines, median ratio exactly 1.000, and the entire spread from
 * 0.77x to 1.43x — all of it explained by the two systems holding different
 * average costs, none of it by quantity. A unit mistake is not a near miss: a
 * millilitre count read as 750ml bottles is out by 750x. Five leaves three and
 * a half times the clearance above anything real that has been seen, and still
 * catches a unit error a hundred and fifty times over.
 */
export const VALUATION_DISAGREEMENT_LIMIT = 5;

/**
 * A key for matching a Loaded item name to Alma's catalogue.
 *
 * The two systems name the same wine differently, because they came by it
 * differently: Loaded's name is what the floor calls it, Alma's was created
 * from a supplier invoice and carries the vintage and the case size.
 *
 *   Loaded:  Greystone Pinot Gris
 *   Alma:    2023 Greystone Pinot Gris (Case of 12)
 *
 * Dropping the vintage, the case size and the punctuation matched 36 further
 * lines on the St Alma drinks sheet. It also exposes six wines that exist in
 * Alma twice — once as the floor knows them and once as the invoice created
 * them — which is a data problem to fix rather than a match to guess at, so
 * callers should treat more than one candidate as no match.
 */
export function catalogueKey(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\(case of \d+\)/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[''`"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deciding whether a name Alma has never seen is genuinely a new product.
 *
 * This matters because the alternative to matching is *creating*, and a wrong
 * creation is a duplicate that nobody notices until the counts stop adding up.
 * The two systems' wordings differ constantly — "Gewuztraminer" for
 * "Gewurztraminer", "Puilly-Fuisse" for "Pouilly-Fuisse", "ArteNom1579" for
 * "ArteNom 1579" — and every one of those is the same bottle.
 *
 * Closeness alone cannot decide it. Measured on the 124 unmatched St Alma
 * lines, "First Press Cold Drip Coffee Mixer" and "First Press **Black** Cold
 * Drip Coffee Mixer" score 0.85 and are the same product, while "Bruxo No. 2"
 * and "Bruxo No. 4" score 0.90 and are different mezcals. The bands overlap, so
 * a threshold on similarity by itself is guaranteed to be wrong both ways.
 *
 * What separates them is digits. In drinks a number is almost always part of
 * the identity — an expression, an age, a blend number — so two names that
 * disagree about their numbers are different products however close the letters
 * are. Vintages and case sizes are stripped first by `catalogueKey`, since
 * those describe the packet rather than the product.
 */
export const NEAR_DUPLICATE_SIMILARITY = 0.93;
export const POSSIBLE_DUPLICATE_SIMILARITY = 0.8;

/** Levenshtein distance, iterative and allocation-light. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 1 for identical, 0 for nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

/** The numbers in a name, sorted — an identity check, not a similarity one. */
export function significantDigits(name: string): string {
  return (name.match(/\d+/g) ?? []).sort().join(',');
}

export type DuplicateVerdict =
  | { verdict: 'new' }
  | { verdict: 'same'; match: string; similarity: number }
  | { verdict: 'unsure'; match: string; similarity: number };

/**
 * Whether `name` is already in `existing` under a different wording.
 *
 * Returns `unsure` rather than choosing whenever something is close but not
 * decisively the same — those are for a person to confirm, because both
 * possible mistakes (a duplicate item, or a count filed against the wrong
 * product) are expensive and neither is visible afterwards.
 */
export function classifyAgainstCatalogue(name: string, existing: string[]): DuplicateVerdict {
  const key = catalogueKey(name);
  const digits = significantDigits(key);

  let best: { match: string; similarity: number } | null = null;
  for (const candidate of existing) {
    const similarity = nameSimilarity(key, catalogueKey(candidate));
    if (!best || similarity > best.similarity) best = { match: candidate, similarity };
  }
  if (!best || best.similarity < POSSIBLE_DUPLICATE_SIMILARITY) return { verdict: 'new' };

  const sameNumbers = digits === significantDigits(catalogueKey(best.match));
  return best.similarity >= NEAR_DUPLICATE_SIMILARITY && sameNumbers
    ? { verdict: 'same', ...best }
    : { verdict: 'unsure', ...best };
}

export type ValuationOutlier = {
  name: string;
  loadedCents: number;
  almaCents: number;
  ratio: number;
  message: string;
};

/**
 * Lines where Alma and Loaded disagree about what is on the shelf.
 *
 * Lines either system values at zero are skipped: a ratio needs both sides, and
 * a zero count is a legitimate answer rather than a disagreement.
 */
export function valuationOutliers(
  rows: Array<{ name: string; loadedCents: number; almaCents: number }>,
  limit: number = VALUATION_DISAGREEMENT_LIMIT
): ValuationOutlier[] {
  const outliers: ValuationOutlier[] = [];
  for (const row of rows) {
    if (row.loadedCents <= 0 || row.almaCents <= 0) continue;
    const ratio = row.almaCents / row.loadedCents;
    if (ratio <= limit && ratio >= 1 / limit) continue;
    outliers.push({
      ...row,
      ratio,
      message:
        ratio > 1
          ? `Alma values this at ${money(row.almaCents)} but Loaded counted ${money(
              row.loadedCents
            )} — ${ratio.toFixed(0)}x more. Check the unit before importing.`
          : `Alma values this at ${money(row.almaCents)} but Loaded counted ${money(
              row.loadedCents
            )} — ${(1 / ratio).toFixed(0)}x less. Check the unit before importing.`
    });
  }
  return outliers.sort((a, b) => Math.max(b.ratio, 1 / b.ratio) - Math.max(a.ratio, 1 / a.ratio));
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONEY = /^\$?\(?-?[\d,]+\.\d{2}\)?$/;
const QUANTITY = /^-?[\d,]+(?:\.\d+)?$/;

export function moneyToCents(token: string): number | null {
  const raw = token.trim();
  if (!MONEY.test(raw)) return null;
  const negative = raw.startsWith('(') || raw.includes('-');
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return null;
  const cents = Math.round(Number(digits) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Rows that are page furniture rather than data. */
function isNoise(cells: PdfRow): boolean {
  const first = (cells[0] ?? '').trim();
  return (
    first === 'Item' ||
    first === 'View Stocktake' ||
    first === 'Stocktake' ||
    first === 'Title' ||
    first === 'Date' ||
    first === 'Created By' ||
    first === 'Entered By' ||
    /^Page \d+/i.test(first)
  );
}

export function parseLoadedStocktake(rows: PdfRow[]): LoadedStocktake {
  const cleaned = rows.map((r) => r.map((c) => c.trim()).filter((c) => c.length > 0)).filter((r) => r.length > 0);

  let venue: string | null = null;
  let countedAtText: string | null = null;
  let countedBy: string | null = null;
  let printedTotalCents: number | null = null;

  const lines: LoadedCountLine[] = [];
  const printedCategoryTotals = new Map<string, number>();
  const discrepancies: string[] = [];
  let category = 'Uncategorised';
  let sawAnyQuantityColumn = false;

  for (const [index, cells] of cleaned.entries()) {
    const first = cells[0];

    // The venue is the first line of the document, above "View Stocktake".
    if (venue === null && index === 0 && cells.length === 1) {
      venue = first;
      continue;
    }
    if (first === 'Date' && cells[1]) {
      countedAtText = cells[1];
      continue;
    }
    if (first === 'Created By' && cells[1]) {
      countedBy = cells[1];
      continue;
    }

    // "Total for Bottled  $811.65" — and the sheet's own grand total.
    if (/^Total for /i.test(first)) {
      const cents = moneyToCents(cells[cells.length - 1] ?? '');
      if (cents !== null) {
        const name = first.replace(/^Total for\s+/i, '').trim();
        if (/^stocktake$/i.test(name)) printedTotalCents = cents;
        else printedCategoryTotals.set(name, cents);
      }
      continue;
    }

    if (isNoise(cells)) {
      // The header row tells us which columns this sheet carries.
      if (first === 'Item' && cells.includes('Quantity')) sawAnyQuantityColumn = true;
      continue;
    }

    // A lone cell that is not money is a category heading.
    if (cells.length === 1) {
      if (moneyToCents(first) === null) category = first;
      continue;
    }

    // A data row ends with unit, quantity, value. Everything before is the
    // name — joined with no separator, because the splits are ligatures.
    //
    // The value column is required to carry a currency marker. Loaded always
    // prints one, and without that requirement a blank sheet's trailing
    // "0.000  0.00  0.00" reads as unit/quantity/value and the name swallows
    // the unit: "Tortillas Flour 12inch12X91GM".
    const lastCell = cells[cells.length - 1] ?? '';
    if (cells.length >= 4 && /[$(]/.test(lastCell)) {
      const valueCents = moneyToCents(lastCell);
      const quantityCell = cells[cells.length - 2] ?? '';
      const unit = cells[cells.length - 3] ?? '';
      if (valueCents !== null && QUANTITY.test(quantityCell)) {
        const name = cells.slice(0, cells.length - 3).join('');
        if (name) {
          lines.push({
            category,
            name,
            unit,
            quantity: Number(quantityCell.replace(/,/g, '')),
            valueCents
          });
          continue;
        }
      }
    }

    // A blank sheet has no value column at all: name, unit, then plain numbers.
    if (cells.length >= 3 && QUANTITY.test(cells[cells.length - 1] ?? '')) {
      const trailing = [...cells].reverse().findIndex((c) => !QUANTITY.test(c));
      const numericCount = trailing === -1 ? cells.length : trailing;
      if (numericCount >= 1 && cells.length - numericCount >= 2) {
        const unit = cells[cells.length - numericCount - 1] ?? '';
        const name = cells.slice(0, cells.length - numericCount - 1).join('');
        const quantity = Number((cells[cells.length - numericCount] ?? '0').replace(/,/g, ''));
        if (name) {
          lines.push({ category, name, unit, quantity, valueCents: 0 });
        }
      }
    }
  }

  // Check our arithmetic against the sheet's own.
  //
  // Loaded totals its categories from unrounded line values and prints each
  // line rounded to the cent, so summing what is printed drifts by up to half
  // a cent per line — on the St Alma drinks sheet, one cent in four categories
  // and four across the whole count. The tolerance below is exactly that drift
  // and nothing more: the smallest real line on these sheets is $5.79, so a
  // genuinely dropped row still trips the check by a wide margin.
  const roundingToleranceCents = (lineCount: number) => Math.ceil(lineCount / 2) + 1;

  const summedByCategory = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  for (const line of lines) {
    summedByCategory.set(line.category, (summedByCategory.get(line.category) ?? 0) + line.valueCents);
    countByCategory.set(line.category, (countByCategory.get(line.category) ?? 0) + 1);
  }
  const categoryTotals = [...printedCategoryTotals.entries()].map(([name, printedCents]) => {
    const summedCents = summedByCategory.get(name) ?? 0;
    const drift = Math.abs(summedCents - printedCents);
    if (drift > roundingToleranceCents(countByCategory.get(name) ?? 0)) {
      discrepancies.push(
        `${name}: lines add to ${(summedCents / 100).toFixed(2)} but the sheet prints ${(printedCents / 100).toFixed(2)}`
      );
    }
    return { category: name, printedCents, summedCents };
  });

  const summedTotalCents = lines.reduce((total, line) => total + line.valueCents, 0);
  if (
    printedTotalCents !== null &&
    Math.abs(printedTotalCents - summedTotalCents) > roundingToleranceCents(lines.length)
  ) {
    discrepancies.push(
      `Stocktake total: lines add to ${(summedTotalCents / 100).toFixed(2)} but the sheet prints ${(printedTotalCents / 100).toFixed(2)}`
    );
  }

  const isBlank = lines.length > 0 && lines.every((line) => line.quantity === 0) && summedTotalCents === 0;

  return {
    venue,
    countedAtText,
    countedBy,
    lines,
    categoryTotals,
    printedTotalCents,
    summedTotalCents,
    discrepancies: sawAnyQuantityColumn || lines.length > 0 ? discrepancies : ['No item rows found — is this a stocktake export?'],
    isBlank
  };
}

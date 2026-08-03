/**
 * Turning pasted invoice text back into invoice lines.
 *
 * Some supplier bills arrive as a single summary line — a Xero bill synced with
 * one "Alcoholic Beverages $1,035.25" row, or a scan OCR only read the total
 * off. The detail is right there on the PDF, and a manager can select it and
 * copy it, but until now there was nowhere to put it: the invoice stayed one
 * line and every item on it went uncosted.
 *
 * This parses that paste. It is deliberately pure and lives here so it can be
 * tested against the real shapes suppliers produce without a database.
 *
 * The hard part is not the rows. It is that copying a PDF table often detaches
 * the right-hand columns: eight item rows come out first, then a block of eight
 * GST figures, then eight ex-GST figures, then eight totals. They only line up
 * by position, so a parser that zips them without checking the counts match
 * would put one line's tax against another line's item — quietly, and in a
 * costing system. Hence: zip only on an exact count match, and say so when it
 * doesn't.
 */

export type ParsedInvoiceLine = {
  lineNumber: number;
  itemCode: string | null;
  description: string;
  /** Pack size as printed, e.g. "6/750 ml". Kept for the reviewer, not costed. */
  pack: string | null;
  /** Quantity in the units the unit price is quoted in. */
  quantity: number;
  unitAmountCents: number;
  lineAmountCents: number;
  taxAmountCents: number;
  /** What was printed in the quantity column, before the money was reconciled. */
  printedQuantity: string | null;
  /** Anything about this line a human should look at. Empty when it all agreed. */
  warnings: string[];
};

export type ParsedInvoicePaste = {
  lines: ParsedInvoiceLine[];
  /** Detached columns that were recognised and applied, by name. */
  columnsApplied: string[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Document-level problems: mismatched column counts, unknown columns. */
  warnings: string[];
  /** Text that was not understood. Never silently dropped. */
  unparsed: string[];
};

/** A recognised trailing column, and what it means. */
type ColumnRole = 'gst' | 'unitExGst' | 'totalIncGst' | 'lineExGst' | 'unknown';

/**
 * Column headers seen on Australian supplier invoices.
 *
 * "LUC" is landed unit cost — Paramount Liquor's name for the ex-GST unit
 * price. Matched on a normalised header so spacing and punctuation don't
 * matter. An unrecognised header is reported rather than guessed at, because a
 * column applied to the wrong field is worse than a column left out.
 */
function columnRole(header: string): ColumnRole {
  const key = header.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return 'unknown';
  if (key === 'gst' || key === 'tax' || key === 'gst amount' || key === 'tax amount') return 'gst';
  if (/\b(inc|incl|including)\b/.test(key) && /\bgst\b/.test(key)) return 'totalIncGst';
  if (/\bluc\b/.test(key) || /\bunit\b/.test(key) || /\bnett?\b/.test(key)) return 'unitExGst';
  if (/\bex\b/.test(key) && /\bgst\b/.test(key)) return 'lineExGst';
  return 'unknown';
}

const ROLE_LABELS: Record<ColumnRole, string> = {
  gst: 'GST',
  unitExGst: 'unit price ex GST',
  totalIncGst: 'total inc GST',
  lineExGst: 'line total ex GST',
  unknown: 'unrecognised column'
};

/**
 * Whether a token is money.
 *
 * Requires a currency symbol or exactly two decimal places, so a bare quantity
 * ("4", "24") is never mistaken for a price. Accepts the shapes a PDF produces:
 * $1,035.25, -$4.00, (4.00) for a credit.
 */
function isMoneyToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  const hasCurrency = trimmed.includes('$');
  const bare = trimmed.replace(/[()$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(bare)) return false;
  return hasCurrency || /\.\d{2}$/.test(bare);
}

/** Money to whole cents. Parentheses and a leading minus both mean negative. */
export function moneyTokenToCents(token: string): number {
  const trimmed = token.trim();
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.replace(/[$\s]/g, '').startsWith('-');
  const bare = trimmed.replace(/[()$,\s-]/g, '');
  const value = Number.parseFloat(bare);
  if (!Number.isFinite(value)) return 0;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

/** Pack size as printed: "6/750 ml", "24/355ml", "12/1 L". */
const PACK_PATTERN = /\b(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg|ea|pk|pack)\b/i;

/**
 * Unit-of-measure words that sit in their own column between the description
 * and the quantity. Dropped from the description so the item matcher sees the
 * product name and not "Carton Freight MISC".
 */
const UOM_WORDS = new Set(['misc', 'ea', 'each', 'ctn', 'carton', 'btl', 'bottle', 'kg', 'pk', 'doz', 'case']);

type RowParse = {
  itemCode: string | null;
  description: string;
  pack: string | null;
  printedQuantity: string | null;
  /** Money found at the end of the row, left to right. */
  trailing: number[];
};

/**
 * Pull one item row apart.
 *
 * Rows are `<code> <description> <pack?> <uom?> <qty> <money...>` with wide
 * variation in the middle, so this works from the ends inward: money off the
 * right, an item code off the left, then the pack (identifiable by its unit
 * suffix) and the quantity from what remains.
 */
function parseRow(raw: string): RowParse | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Money off the right, stopping at the first token that isn't money.
  const trailing: number[] = [];
  let end = tokens.length;
  while (end > 0 && isMoneyToken(tokens[end - 1]!)) {
    trailing.unshift(moneyTokenToCents(tokens[end - 1]!));
    end -= 1;
  }
  const middle = tokens.slice(0, end);
  if (middle.length === 0) return null;

  // An item code is a run of digits at the very start, and only when something
  // follows it — otherwise a stray page number becomes a line.
  let itemCode: string | null = null;
  if (middle.length > 1 && /^\d{3,}$/.test(middle[0]!)) {
    itemCode = middle.shift()!;
  }

  let rest = middle.join(' ');

  // Pack first: it contains a slash, and so does the quantity, but only the
  // pack carries a unit suffix.
  const packMatch = PACK_PATTERN.exec(rest);
  const pack = packMatch ? packMatch[0].trim() : null;
  if (packMatch) rest = `${rest.slice(0, packMatch.index)} ${rest.slice(packMatch.index + packMatch[0].length)}`;
  rest = rest.replace(/\s+/g, ' ').trim();

  // Quantity off the end. "0 / 1" is cartons/singles; "C 1" flags a carton
  // line; a bare integer is the plain case.
  let printedQuantity: string | null = null;
  const slashQty = /(\d+)\s*\/\s*(\d+)\s*$/.exec(rest);
  const letterQty = /\b([A-Za-z])\s+(\d+(?:\.\d+)?)\s*$/.exec(rest);
  const plainQty = /(\d+(?:\.\d+)?)\s*$/.exec(rest);
  if (slashQty) {
    printedQuantity = `${slashQty[1]}/${slashQty[2]}`;
    rest = rest.slice(0, slashQty.index).trim();
  } else if (letterQty && letterQty[1]!.length === 1) {
    printedQuantity = `${letterQty[1]!.toUpperCase()} ${letterQty[2]}`;
    rest = rest.slice(0, letterQty.index).trim();
  } else if (plainQty) {
    printedQuantity = plainQty[1]!;
    rest = rest.slice(0, plainQty.index).trim();
  }

  // A unit-of-measure word left stranded at the end of the description.
  const restTokens = rest.split(/\s+/).filter(Boolean);
  while (restTokens.length > 1 && UOM_WORDS.has(restTokens[restTokens.length - 1]!.toLowerCase())) {
    restTokens.pop();
  }
  const description = restTokens.join(' ').replace(/\s*[:,-]\s*$/, '').trim();

  if (!description && !itemCode) return null;
  return { itemCode, description: description || (itemCode ?? 'Invoice line'), pack, printedQuantity, trailing };
}

/**
 * Quantity, decided by the money rather than the printed column.
 *
 * The printed quantity is not reliably in the same unit as the price: a
 * "1 / 0" line on a 12-bottle pack is one carton, twelve bottles, and priced
 * per bottle. Dividing the line total by the unit price gives the quantity the
 * price is actually quoted in, which is the one the costing engine needs.
 * Returns null when it does not divide cleanly, so the caller can say so
 * instead of rounding a real discrepancy away.
 */
export function quantityFromMoney(lineAmountCents: number, unitAmountCents: number): number | null {
  if (unitAmountCents === 0) return null;
  const ratio = lineAmountCents / unitAmountCents;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const rounded = Math.round(ratio);
  if (rounded === 0) return null;
  // One cent of slack per unit: suppliers round unit prices before multiplying.
  const drift = Math.abs(lineAmountCents - rounded * unitAmountCents);
  return drift <= Math.max(1, rounded) ? rounded : null;
}

/** A printed "0 / 1" or "C 1" or "4" reduced to a number, for cross-checking. */
function printedQuantityValue(printed: string | null): number | null {
  if (!printed) return null;
  const slash = /^(\d+)\/(\d+)$/.exec(printed);
  if (slash) {
    const cartons = Number(slash[1]);
    const units = Number(slash[2]);
    return units > 0 ? units : cartons;
  }
  const letter = /^[A-Z]\s+(\d+(?:\.\d+)?)$/.exec(printed);
  if (letter) return Number(letter[1]);
  const plain = Number(printed);
  return Number.isFinite(plain) ? plain : null;
}

/**
 * Parse a block of text copied off a supplier invoice.
 *
 * Handles both shapes: everything on one row per item, and the PDF-copy shape
 * where the trailing columns detach into their own blocks under a header.
 */
export function parseInvoicePaste(text: string): ParsedInvoicePaste {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const warnings: string[] = [];
  const unparsed: string[] = [];

  // Pass one: lift out detached column blocks — a header followed by a run of
  // nothing-but-money lines.
  const columns: Array<{ role: ColumnRole; header: string; values: number[] }> = [];
  const rowCandidates: string[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!;
    const isMoneyOnly = isMoneyToken(line);
    if (isMoneyOnly) {
      // A money-only line outside a block is orphaned; report it.
      unparsed.push(line);
      continue;
    }

    // A header is followed by at least two money-only lines. Two, not one, so
    // an ordinary row that happens to precede a stray figure isn't eaten.
    let run = 0;
    while (i + 1 + run < rawLines.length && isMoneyToken(rawLines[i + 1 + run]!)) run += 1;
    if (run >= 2) {
      const role = columnRole(line);
      const values = rawLines.slice(i + 1, i + 1 + run).map(moneyTokenToCents);
      columns.push({ role, header: line, values });
      i += run;
      continue;
    }

    rowCandidates.push(line);
  }

  // Pass two: the rows.
  const rows: RowParse[] = [];
  for (const candidate of rowCandidates) {
    const parsed = parseRow(candidate);
    // A row with no money and no detached columns is a table header or a note.
    if (!parsed || (parsed.trailing.length === 0 && columns.length === 0)) {
      unparsed.push(candidate);
      continue;
    }
    rows.push(parsed);
  }

  // Pass three: apply the columns, but only where the counts agree. Zipping
  // mismatched lengths is how one item ends up with another item's tax.
  const applied = new Map<ColumnRole, number[]>();
  const columnsApplied: string[] = [];
  for (const column of columns) {
    if (column.role === 'unknown') {
      warnings.push(
        `Ignored a column headed "${column.header}" — not sure what it is, so its ${column.values.length} values were left out.`
      );
      continue;
    }
    if (column.values.length !== rows.length) {
      warnings.push(
        `The ${ROLE_LABELS[column.role]} column has ${column.values.length} values but ${rows.length} item ${
          rows.length === 1 ? 'row was' : 'rows were'
        } read, so it was left out rather than lined up wrongly.`
      );
      continue;
    }
    if (applied.has(column.role)) {
      warnings.push(`Two ${ROLE_LABELS[column.role]} columns were pasted; the first was used.`);
      continue;
    }
    applied.set(column.role, column.values);
    columnsApplied.push(ROLE_LABELS[column.role]);
  }

  const gstColumn = applied.get('gst');
  const unitColumn = applied.get('unitExGst');
  const totalIncColumn = applied.get('totalIncGst');
  const lineExColumn = applied.get('lineExGst');

  const lines: ParsedInvoiceLine[] = rows.map((row, index) => {
    const lineWarnings: string[] = [];

    const taxAmountCents = gstColumn?.[index] ?? 0;

    // Line total, ex GST. In order of trust: an explicit ex-GST column, then
    // total-inc minus GST, then the last money printed on the row itself.
    const rowLineTotal = row.trailing.length > 0 ? row.trailing[row.trailing.length - 1]! : 0;
    const derivedFromInc =
      totalIncColumn && gstColumn ? totalIncColumn[index]! - gstColumn[index]! : null;
    const lineAmountCents = lineExColumn?.[index] ?? derivedFromInc ?? rowLineTotal;

    if (derivedFromInc !== null && row.trailing.length > 0 && Math.abs(derivedFromInc - rowLineTotal) > 1) {
      lineWarnings.push(
        `Printed line total ${formatCents(rowLineTotal)} but inc-GST minus GST is ${formatCents(derivedFromInc)}.`
      );
    }

    const printedValue = printedQuantityValue(row.printedQuantity);
    let quantity: number;
    let unitAmountCents: number;

    if (unitColumn) {
      // The supplier printed a unit price, so the quantity is whatever makes
      // that price produce the line total — which is not always the number in
      // the quantity column. See quantityFromMoney.
      unitAmountCents = unitColumn[index]!;
      const derived = quantityFromMoney(lineAmountCents, unitAmountCents);
      if (derived !== null) {
        quantity = derived;
      } else if (printedValue !== null && printedValue > 0) {
        quantity = printedValue;
        if (unitAmountCents !== 0) {
          lineWarnings.push(
            `Quantity ${printedValue} x ${formatCents(unitAmountCents)} does not make ${formatCents(lineAmountCents)}.`
          );
        }
      } else {
        quantity = 1;
        lineWarnings.push('No quantity could be read; assumed 1.');
      }
    } else {
      // No unit column. The other figures on the row cannot be trusted to be a
      // unit price — on this supplier's layout the second-to-last is the
      // carton price, so reading it as a unit price would cost a single bottle
      // at the price of six. Divide the line total by the printed quantity
      // instead: the line total is the figure the invoice is actually charging.
      quantity = printedValue !== null && printedValue > 0 ? printedValue : 1;
      if (printedValue === null || printedValue <= 0) {
        lineWarnings.push('No quantity could be read; assumed 1.');
      }
      unitAmountCents = Math.round(lineAmountCents / quantity);
      const drift = Math.abs(quantity * unitAmountCents - lineAmountCents);
      if (drift > 0) {
        lineWarnings.push(
          `${formatCents(lineAmountCents)} over ${quantity} does not divide evenly — unit price rounded to ${formatCents(unitAmountCents)}.`
        );
      }
    }

    if (lineAmountCents === 0) lineWarnings.push('No line amount was read.');

    return {
      lineNumber: index + 1,
      itemCode: row.itemCode,
      description: row.description,
      pack: row.pack,
      quantity,
      unitAmountCents,
      lineAmountCents,
      taxAmountCents,
      printedQuantity: row.printedQuantity,
      warnings: lineWarnings
    };
  });

  const subtotalCents = lines.reduce((sum, line) => sum + line.lineAmountCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxAmountCents, 0);

  if (lines.length === 0) warnings.push('No item lines were found in that text.');

  return {
    lines,
    columnsApplied,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    warnings,
    unparsed
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * How a parse compares with the invoice it is meant to replace.
 *
 * The invoice header total came from Xero or the supplier and is the thing
 * worth checking against — if the pasted lines add up to it, the paste is
 * almost certainly complete. Suppliers round per line, so a few cents apart is
 * normal and a dollar apart is not; the caller gets the number and decides.
 */
export function reconcilePaste(
  parsed: Pick<ParsedInvoicePaste, 'subtotalCents' | 'taxCents' | 'totalCents'>,
  invoice: { subtotalCents: number; taxCents: number; totalCents: number }
): { totalVarianceCents: number; subtotalVarianceCents: number; taxVarianceCents: number; matches: boolean } {
  const totalVarianceCents = parsed.totalCents - invoice.totalCents;
  return {
    totalVarianceCents,
    subtotalVarianceCents: parsed.subtotalCents - invoice.subtotalCents,
    taxVarianceCents: parsed.taxCents - invoice.taxCents,
    // A cent per line is rounding. Anything more means a line is missing or doubled.
    matches: Math.abs(totalVarianceCents) <= 5
  };
}

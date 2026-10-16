import { convertQuantityToCostUnit, isMeasureUnit, type CostUnitItem } from '@alma/shared';

/**
 * Applying a stocktake writes each line's countedQty straight into on-hand, in
 * the item's count unit. A line counted in another unit — "19400 mL" of an
 * item counted in bottles, "970 g" of one counted by the bag, "2 case" of one
 * counted by the bottle — would be written as that many count units. That is
 * how Alma Avalon came to hold 19 400 bottles of gin ($873k) in October 2026.
 *
 * The line's VALUE was right all along (valuation converts), so nothing on the
 * sheet looked wrong. Rather than convert silently at apply time — the
 * conversion leans on the item's measure, which is itself a placeholder on
 * many kitchen items — the apply is refused and the lines are named, so the
 * count is restated in the count unit by someone who knows what was meant.
 *
 * A line whose number carries across unchanged is fine: same unit, a generic
 * "each", a pack label ("700ml") on a bottle item, or one countable named
 * differently ("bottle" on an item counted in "each").
 */
export type GuardLine = { label: string; countedQty: number | null; unit: string | null; item: (CostUnitItem & { name?: string }) | null };
export type UnitMismatch = { label: string; countedQty: number; unit: string | null; countUnit: string; convertsTo: number | null };

export function unitMismatches(lines: GuardLine[]): UnitMismatch[] {
  const out: UnitMismatch[] = [];
  for (const line of lines) {
    if (!line.item || line.countedQty === null || line.countedQty === undefined) continue;
    const countUnit = line.item.countUnit ?? line.item.unit;
    const converted = convertQuantityToCostUnit(line.countedQty, line.unit, line.item);
    const mismatch =
      converted.via === 'unknown'
        ? isMeasureUnit(line.unit) !== isMeasureUnit(countUnit)
        : Math.abs(converted.quantity - line.countedQty) > 1e-9;
    if (!mismatch) continue;
    out.push({
      label: line.label,
      countedQty: line.countedQty,
      unit: line.unit,
      countUnit,
      convertsTo: converted.via === 'unknown' ? null : Math.round(converted.quantity * 10000) / 10000
    });
  }
  return out;
}

export function unitMismatchMessage(mismatches: UnitMismatch[]): string {
  const shown = mismatches.slice(0, 8).map((m) => {
    const hint = m.convertsTo === null ? '' : ` (about ${m.convertsTo} ${m.countUnit})`;
    return `${m.label}: ${m.countedQty} ${m.unit ?? ''} — counted in ${m.countUnit}${hint}`;
  });
  const more = mismatches.length > shown.length ? `; and ${mismatches.length - shown.length} more` : '';
  return (
    `${mismatches.length} line${mismatches.length === 1 ? ' is' : 's are'} in a unit other than the item's count unit, ` +
    `and applying would store the number as that many count units: ${shown.join('; ')}${more}. ` +
    'Restate those lines in the count unit, then apply.'
  );
}

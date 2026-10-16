import { convertQuantityToCostUnit, isMeasureUnit, normaliseUnitLabel, type CostUnitItem } from '@alma/shared';

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

/**
 * A quantity in the item's count unit — the one unit every stored count and
 * every applied holding uses, so a manager never has to think about units.
 *
 * Converted automatically when the conversion cannot be wrong for this item:
 * the same unit or a generic "each"; a pack label naming the container
 * ("700ml" on a bottle item); the item's purchase unit (cases → bottles by the
 * item's pack size); one metric unit to another (g → kg, mL → L); or a weight /
 * volume on a pack item whose measure is real ("970 g" of a 1 kg bag = 0.97).
 *
 * Refused, with a message the manager can act on, when it could be wrong: a
 * weight or volume on an item with no measure, or with the placeholder measure
 * (100 g / 100 mL on a pack item, left by the first catalogue import on 80
 * items), or a measure on an item counted by another kind of thing.
 */
export type CountUnitResult =
  | { ok: true; countedQty: number | null; unit: string; converted: boolean }
  | { ok: false; countUnit: string; message: string };

export function isPlaceholderMeasure(item: CostUnitItem): boolean {
  const countUnit = item.countUnit ?? item.unit;
  return item.measurePerCountUnit === 100 && ['g', 'ml'].includes(normaliseUnitLabel(item.measureUnit)) && !isMeasureUnit(countUnit);
}

export function inCountUnit(
  countedQty: number | null | undefined,
  unit: string | null | undefined,
  item: CostUnitItem,
  options: { label?: string; allowMeasure?: boolean } = {}
): CountUnitResult {
  const countUnit = item.countUnit ?? item.unit;
  if (countedQty === null || countedQty === undefined) return { ok: true, countedQty: null, unit: countUnit, converted: false };
  const converted = convertQuantityToCostUnit(countedQty, unit, item);
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  const refuse = (why: string): CountUnitResult => ({
    ok: false,
    countUnit,
    message: `${options.label ? `${options.label}: ` : ''}${countedQty} ${unit ?? ''} can't be turned into ${countUnit} — ${why}. Enter it in ${countUnit}.`
  });
  switch (converted.via) {
    case 'same-unit':
    case 'pack-label':
      return { ok: true, countedQty, unit: countUnit, converted: false };
    case 'pack':
    case 'measure':
      return { ok: true, countedQty: round(converted.quantity), unit: countUnit, converted: true };
    case 'measure-pack':
      if (options.allowMeasure === false) return refuse(`it depends on how much one ${countUnit} holds, so it has to be entered as a count`);
      if (isPlaceholderMeasure(item)) return refuse(`the item doesn't yet say how much one ${countUnit} holds`);
      return { ok: true, countedQty: round(converted.quantity), unit: countUnit, converted: true };
    default:
      // Two names for one kind of thing ("bottle" on an item counted in
      // "each") carry across; a measure against a count cannot.
      if (isMeasureUnit(unit) === isMeasureUnit(countUnit)) return { ok: true, countedQty, unit: countUnit, converted: false };
      return refuse(isMeasureUnit(unit) ? `the item doesn't say how much one ${countUnit} holds` : `the item is counted by measure`);
  }
}

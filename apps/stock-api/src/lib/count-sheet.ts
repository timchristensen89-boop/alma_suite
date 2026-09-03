import { STOCKTAKE_PREP_AREA, type StocktakeCountSheetRow, type StocktakeCountSheetSection } from '@alma/shared';

/**
 * The paper count sheet's grouping rule, in one place.
 *
 * Staff walk the venue in a fixed order — bar, cool room, dry store, kitchen —
 * and the sheet has to follow that walk, not the alphabet. Sections keep the
 * order in which their area first appears in the line list (a template
 * resolves in count-area order; a saved count keeps the order it was seeded
 * in), rows keep their position within a section, and prepped items always
 * print as the last block because the production fridge is where a count
 * ends.
 */
export const UNASSIGNED_COUNT_AREA = 'Unassigned area';

export function countSheetArea(row: { kind: StocktakeCountSheetRow['kind']; area: string | null | undefined }): string {
  if (row.kind === 'PREPPED_ITEM') return STOCKTAKE_PREP_AREA;
  const area = (row.area ?? '').trim();
  return area || UNASSIGNED_COUNT_AREA;
}

export function buildCountSheetSections(
  rows: Array<StocktakeCountSheetRow & { area: string | null }>
): StocktakeCountSheetSection[] {
  const sections = new Map<string, StocktakeCountSheetRow[]>();
  for (const row of rows) {
    const area = countSheetArea(row);
    const { area: _ignored, ...sheetRow } = row;
    const list = sections.get(area) ?? [];
    list.push(sheetRow);
    sections.set(area, list);
  }
  const ordered = Array.from(sections.entries()).map(([area, list]) => ({ area, rows: list }));
  const prepIndex = ordered.findIndex((section) => section.area === STOCKTAKE_PREP_AREA);
  if (prepIndex >= 0 && prepIndex !== ordered.length - 1) {
    const [prep] = ordered.splice(prepIndex, 1);
    ordered.push(prep!);
  }
  const unassignedIndex = ordered.findIndex((section) => section.area === UNASSIGNED_COUNT_AREA);
  // Unassigned goes just before prep: it is the "we did not know where this
  // lives" pile, walked last, and it prints as a reminder to set count areas.
  if (unassignedIndex >= 0) {
    const [unassigned] = ordered.splice(unassignedIndex, 1);
    const prepAt = ordered.findIndex((section) => section.area === STOCKTAKE_PREP_AREA);
    ordered.splice(prepAt >= 0 ? prepAt : ordered.length, 0, unassigned!);
  }
  return ordered;
}

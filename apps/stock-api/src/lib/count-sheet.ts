import {
  STOCKTAKE_PREP_AREA,
  organiseCountRows,
  type StocktakeCountSheetRow,
  type StocktakeCountSheetSection
} from '@alma/shared';

/**
 * The paper count sheet's grouping rule, in one place.
 *
 * Sections are categories, in the order a bar-and-kitchen count is walked
 * (spirits → liqueurs → wine → beer → soft → kitchen — see
 * stock-count-order.ts in @alma/shared), with made (prep) items printing as
 * the last block because the production fridge is where a count ends. Inside
 * a wine section the wines group by name with their vintages underneath.
 *
 * It used to section by count area. Every item in the catalogue carries the
 * count area "Default", so a 300-line sheet printed as ONE section called
 * "Default" with no category break anywhere in it — the same rule now orders
 * the screen, the paper sheet and the Excel template, so they agree.
 */
export const UNASSIGNED_COUNT_AREA = 'Unassigned area';

export function buildCountSheetSections(
  rows: Array<StocktakeCountSheetRow & { area?: string | null }>
): StocktakeCountSheetSection[] {
  const organised = organiseCountRows(rows, {
    name: (row) => row.label,
    category: (row) => row.category,
    isPrep: (row) => row.kind === 'PREPPED_ITEM'
  });
  return organised.map((section) => ({
    area: section.category === 'Prep (made items)' ? STOCKTAKE_PREP_AREA : section.category,
    rows: section.groups.flatMap((group) =>
      group.entries.map(({ row, vintageLabel, detail }) => {
        const { area: _ignored, ...sheetRow } = row;
        return {
          ...sheetRow,
          wineName: group.wine ? group.name : null,
          vintage: group.wine ? vintageLabel : null,
          vintageDetail: group.wine ? detail : null,
          group: group.wine && group.entries.length > 1 ? group.name : null
        };
      })
    )
  }));
}

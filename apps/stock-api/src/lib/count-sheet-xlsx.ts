import ExcelJS from 'exceljs';
import type { StocktakeCountSheet, StocktakeCountSheetRow } from '@alma/shared';

/**
 * The blank Excel count sheet.
 *
 * One worksheet, one row per line, the same sections and wine grouping as
 * the printed sheet. Columns: Item · Vintage · Unit · Count · Notes, with the
 * line/item ids in a hidden column at the end so a filled-in sheet can be
 * matched back to its lines without a lookup by name. No colours beyond a
 * grey category band, no formulas: it has to print from Excel on A4 and be
 * written on with a pen.
 */

const COLUMNS = [
  { key: 'item', header: 'Item', width: 46 },
  { key: 'vintage', header: 'Vintage', width: 9 },
  { key: 'unit', header: 'Unit', width: 11 },
  { key: 'count', header: 'Count', width: 11 },
  { key: 'notes', header: 'Notes', width: 26 },
  { key: 'ref', header: 'Ref', width: 4 }
] as const;

const REF_COLUMN = COLUMNS.length;
const THIN = { style: 'thin' as const, color: { argb: 'FFBBBBBB' } };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };

function formatQty(value: number | null): number | '' {
  return value === null || value === undefined ? '' : value;
}

// A grouped vintage row shows its qualifier (or, failing one, the line's own
// name) indented under the wine; a standalone row shows the wine or item name.
function itemLabel(row: StocktakeCountSheetRow): string {
  if (row.group) return `    ${row.vintageDetail ?? (row.vintage && row.vintage !== 'No year' ? '' : row.label)}`.trimEnd() || `    ${row.label}`;
  return row.wineName ?? row.label;
}

function vintageCell(row: StocktakeCountSheetRow): string {
  if (!row.vintage) return '';
  if (row.vintage === 'No year') return row.group ? 'no year' : '';
  return row.vintage;
}

export async function buildCountSheetWorkbook(
  sheet: StocktakeCountSheet,
  options: { blank?: boolean } = {}
): Promise<Buffer> {
  const blank = options.blank ?? true;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Alma Stock';
  workbook.created = new Date(sheet.generatedAt);
  const ws = workbook.addWorksheet('Stocktake', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: '3:3'
    },
    views: [{ state: 'frozen', ySplit: 3 }]
  });
  ws.columns = COLUMNS.map((column) => ({ key: column.key, width: column.width }));
  ws.getColumn(REF_COLUMN).hidden = true;

  const title = ws.addRow([sheet.name]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, REF_COLUMN - 1);
  const when = sheet.countedAt ? new Date(sheet.countedAt) : new Date(sheet.generatedAt);
  const meta = ws.addRow([
    `${sheet.venue ?? 'Venue not set'} · ${when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}` +
      `${sheet.template && sheet.template !== sheet.name ? ` · ${sheet.template}` : ''} · ${sheet.lineCount} lines · Counted by: ______________`
  ]);
  meta.font = { size: 10, color: { argb: 'FF444444' } };
  ws.mergeCells(2, 1, 2, REF_COLUMN - 1);

  const header = ws.addRow(COLUMNS.map((column) => column.header));
  header.font = { bold: true, size: 10 };
  header.eachCell((cell, col) => {
    if (col >= REF_COLUMN) return;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
    cell.border = BOX;
    cell.alignment = { vertical: 'middle' };
  });
  header.height = 18;

  for (const section of sheet.sections) {
    const band = ws.addRow([section.area.toUpperCase()]);
    ws.mergeCells(band.number, 1, band.number, REF_COLUMN - 1);
    band.font = { bold: true, size: 10 };
    band.height = 18;
    band.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    band.getCell(1).alignment = { vertical: 'middle' };
    band.getCell(1).border = BOX;

    let lastGroup: string | null = null;
    for (const row of section.rows) {
      if (row.group && row.group !== lastGroup) {
        const head = ws.addRow([row.group, '', row.unit, '', '']);
        head.font = { bold: true, size: 10 };
        head.eachCell({ includeEmpty: true }, (cell, col) => {
          if (col >= REF_COLUMN) return;
          cell.border = BOX;
        });
      }
      lastGroup = row.group ?? null;
      const excel = ws.addRow([
        itemLabel(row),
        vintageCell(row),
        row.unit,
        blank ? '' : formatQty(row.countedQty),
        blank ? '' : row.notes ?? '',
        row.lineId ?? row.itemId ?? row.recipeId ?? ''
      ]);
      excel.font = { size: 10, italic: row.kind === 'PREPPED_ITEM' };
      excel.height = 17;
      excel.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col >= REF_COLUMN) return;
        cell.border = BOX;
        cell.alignment = { vertical: 'middle', wrapText: col === 1 };
      });
      excel.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      excel.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
      excel.getCell(4).numFmt = '0.##';
    }
  }

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

export function countSheetFilename(sheet: StocktakeCountSheet): string {
  const stem = `${sheet.venue ? `${sheet.venue} ` : ''}${sheet.name}`
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${stem || 'stocktake'}.xlsx`;
}

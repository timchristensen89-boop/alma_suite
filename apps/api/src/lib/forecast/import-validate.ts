// Import validation and coercion.
//
// Pure: rows in, validated rows and a downloadable error report out. No
// database, so the dry run and the real run share exactly one code path and a
// preview cannot disagree with what an apply would do.
//
// Money arrives as dollars and leaves as integer cents. A row that fails
// validation is never silently dropped — it is returned with its row number
// and reason so the operator gets a usable error file.

import type { ColumnSpec, DatasetSpec } from "./import-templates.js";

export type Severity = "INFORMATIONAL" | "WARNING" | "BLOCKING";

export interface RowError {
  rowNumber: number;
  column: string | null;
  severity: Severity;
  code: string;
  message: string;
}

export interface ValidatedRow {
  rowNumber: number;
  values: Record<string, unknown>;
  naturalKey: string;
  duplicateOfRow?: number;
}

export interface ValidationResult {
  dataset: string;
  totalRows: number;
  validRows: ValidatedRow[];
  errors: RowError[];
  /** Rows dropped as duplicates of an earlier row in the same file. */
  duplicateRowNumbers: number[];
  /** Columns in the file that the template does not know about. */
  unknownColumns: string[];
  /** Required template columns missing from the file. */
  missingColumns: string[];
  canApply: boolean;
}

const TRUE_VALUES = new Set(["true", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "no", "n", "0"]);

/** Dollars → cents without float drift ("1,234.56" and "$1234.56" both work). */
export function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d+)?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole = "0", fraction = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Accepts YYYY-MM-DD and DD/MM/YYYY (Australian order), pinned to UTC. */
export function parseImportDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const au = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) {
    const [, d, m, y] = au;
    const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function coerce(
  column: ColumnSpec,
  raw: string,
  rowNumber: number,
  errors: RowError[],
): unknown | undefined {
  const value = raw.trim();

  if (value === "") {
    if (column.required) {
      errors.push({
        rowNumber,
        column: column.name,
        severity: "BLOCKING",
        code: "REQUIRED",
        message: `${column.name} is required.`,
      });
      return undefined;
    }
    return null;
  }

  switch (column.type) {
    case "money": {
      const cents = dollarsToCents(value);
      if (cents === null) {
        errors.push({ rowNumber, column: column.name, severity: "BLOCKING", code: "NOT_MONEY", message: `${column.name} must be an amount in dollars, got "${raw}".` });
        return undefined;
      }
      return cents;
    }
    case "date": {
      const date = parseImportDate(value);
      if (!date) {
        errors.push({ rowNumber, column: column.name, severity: "BLOCKING", code: "NOT_DATE", message: `${column.name} must be YYYY-MM-DD or DD/MM/YYYY, got "${raw}".` });
        return undefined;
      }
      return date;
    }
    case "integer": {
      if (!/^-?\d+$/.test(value.replace(/,/g, ""))) {
        errors.push({ rowNumber, column: column.name, severity: "BLOCKING", code: "NOT_INTEGER", message: `${column.name} must be a whole number, got "${raw}".` });
        return undefined;
      }
      return Number(value.replace(/,/g, ""));
    }
    case "decimal":
    case "percent": {
      const numeric = Number(value.replace(/[%,\s]/g, ""));
      if (!Number.isFinite(numeric)) {
        errors.push({ rowNumber, column: column.name, severity: "BLOCKING", code: "NOT_NUMBER", message: `${column.name} must be a number, got "${raw}".` });
        return undefined;
      }
      return numeric;
    }
    case "boolean": {
      const lower = value.toLowerCase();
      if (TRUE_VALUES.has(lower)) return true;
      if (FALSE_VALUES.has(lower)) return false;
      errors.push({ rowNumber, column: column.name, severity: "BLOCKING", code: "NOT_BOOLEAN", message: `${column.name} must be true or false, got "${raw}".` });
      return undefined;
    }
    case "enum": {
      const allowed = column.values ?? [];
      const match = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
      if (!match) {
        errors.push({ rowNumber, column: column.name, severity: "BLOCKING", code: "NOT_ALLOWED", message: `${column.name} must be one of ${allowed.join(", ")}, got "${raw}".` });
        return undefined;
      }
      return match;
    }
    default:
      return value;
  }
}

export interface ValidateOptions {
  /** Keys already in the database, so a re-upload does not double count. */
  existingKeys?: Set<string>;
  /** Stop the whole import if any row fails. */
  allOrNothing?: boolean;
}

/**
 * Validate parsed rows against a template.
 *
 * `rows` are raw string maps, exactly as read from CSV/XLSX, so the same
 * function serves both formats.
 */
export function validateRows(
  dataset: DatasetSpec,
  rows: Array<Record<string, string>>,
  options: ValidateOptions = {},
): ValidationResult {
  const errors: RowError[] = [];
  const validRows: ValidatedRow[] = [];
  const duplicateRowNumbers: number[] = [];
  const seenKeys = new Map<string, number>();

  const templateColumns = new Set(dataset.columns.map((column) => column.name));
  const fileColumns = new Set(rows.flatMap((row) => Object.keys(row)));
  const unknownColumns = [...fileColumns].filter((name) => !templateColumns.has(name));
  const missingColumns = dataset.columns
    .filter((column) => column.required && !fileColumns.has(column.name))
    .map((column) => column.name);

  for (const name of missingColumns) {
    errors.push({ rowNumber: 0, column: name, severity: "BLOCKING", code: "MISSING_COLUMN", message: `Required column "${name}" is not in the file.` });
  }
  for (const name of unknownColumns) {
    errors.push({ rowNumber: 0, column: name, severity: "INFORMATIONAL", code: "UNKNOWN_COLUMN", message: `Column "${name}" is not part of this template and will be ignored.` });
  }

  rows.forEach((row, index) => {
    // Row 1 is the header, so data starts at 2 — matching what the operator
    // sees in their spreadsheet.
    const rowNumber = index + 2;
    const before = errors.length;
    const values: Record<string, unknown> = {};

    for (const column of dataset.columns) {
      const coerced = coerce(column, row[column.name] ?? "", rowNumber, errors);
      if (coerced !== undefined) values[column.name] = coerced;
    }

    if (errors.length > before) return; // row already reported

    const naturalKey = dataset.naturalKey
      .map((name) => {
        const value = values[name];
        return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
      })
      .join("|");

    const firstSeenAt = seenKeys.get(naturalKey);
    if (firstSeenAt !== undefined) {
      duplicateRowNumbers.push(rowNumber);
      errors.push({ rowNumber, column: null, severity: "WARNING", code: "DUPLICATE_IN_FILE", message: `Duplicate of row ${firstSeenAt} (same ${dataset.naturalKey.join(" + ")}). Skipped.` });
      return;
    }
    if (options.existingKeys?.has(naturalKey)) {
      duplicateRowNumbers.push(rowNumber);
      errors.push({ rowNumber, column: null, severity: "WARNING", code: "ALREADY_IMPORTED", message: `Already imported (same ${dataset.naturalKey.join(" + ")}). Skipped so it is not counted twice.` });
      return;
    }

    seenKeys.set(naturalKey, rowNumber);
    validRows.push({ rowNumber, values, naturalKey });
  });

  const blocking = errors.filter((error) => error.severity === "BLOCKING");
  const canApply = options.allOrNothing === true ? blocking.length === 0 : validRows.length > 0;

  return {
    dataset: dataset.key,
    totalRows: rows.length,
    validRows,
    errors,
    duplicateRowNumbers,
    unknownColumns,
    missingColumns,
    canApply,
  };
}

/** Downloadable CSV error report for the operator. */
export function buildErrorReportCsv(result: ValidationResult): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = [
    "row,column,severity,code,message",
    ...result.errors.map((error) =>
      [String(error.rowNumber || ""), error.column ?? "", error.severity, error.code, escape(error.message)].join(","),
    ),
  ];
  return rows.join("\n") + "\n";
}

/** Minimal RFC-4180 CSV parser: quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const body = text.replace(/^﻿/, ""); // strip BOM from Excel exports

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (inQuotes) {
      if (char === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...dataRows] = rows;
  if (!header) return [];
  return dataRows
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((name, index) => { record[name.trim()] = cells[index] ?? ""; });
      return record;
    });
}

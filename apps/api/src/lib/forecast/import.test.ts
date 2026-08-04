import assert from "node:assert/strict";
import test from "node:test";
import { buildSampleCsv, DATASETS, datasetByKey } from "./import-templates.js";
import { buildErrorReportCsv, dollarsToCents, parseCsv, parseImportDate, validateRows } from "./import-validate.js";

const salesDaily = datasetByKey("sales_daily")!;

test("all 13 datasets from the brief are registered", () => {
  assert.equal(DATASETS.length, 13);
  for (const key of [
    "sales_daily", "sales_items", "square_payouts", "xero_transactions", "bills_due",
    "payroll_weekly", "stocktakes", "cash_commitments", "bas_history", "creditor_claims",
    "forecast_overrides", "bookings_daily", "business_events",
  ]) {
    assert.ok(datasetByKey(key), `${key} is missing`);
  }
});

test("every dataset declares a natural key made of real columns", () => {
  for (const dataset of DATASETS) {
    assert.ok(dataset.naturalKey.length > 0, `${dataset.key} has no natural key`);
    for (const keyColumn of dataset.naturalKey) {
      assert.ok(
        dataset.columns.some((column) => column.name === keyColumn),
        `${dataset.key} natural key references unknown column ${keyColumn}`,
      );
    }
  }
});

test("every money column states a GST basis so nothing has to guess", () => {
  for (const dataset of DATASETS) {
    for (const column of dataset.columns) {
      if (column.type === "money") {
        assert.ok(column.gstBasis, `${dataset.key}.${column.name} has no GST basis`);
      }
    }
  }
});

test("sample files round-trip: generated CSV parses back to the template columns", () => {
  for (const dataset of DATASETS) {
    const parsed = parseCsv(buildSampleCsv(dataset));
    assert.equal(parsed.length, 2, `${dataset.key} sample should have two example rows`);
    for (const column of dataset.columns) {
      assert.ok(column.name in (parsed[0] ?? {}), `${dataset.key} sample missing ${column.name}`);
    }
  }
});

test("every sample file passes its own validator", () => {
  for (const dataset of DATASETS) {
    const result = validateRows(dataset, parseCsv(buildSampleCsv(dataset)), { allOrNothing: true });
    const blocking = result.errors.filter((error) => error.severity === "BLOCKING");
    assert.deepEqual(blocking, [], `${dataset.key} sample fails validation: ${JSON.stringify(blocking)}`);
    assert.equal(result.validRows.length, 2, `${dataset.key} sample rows did not validate`);
  }
});

test("dollars convert to cents without float drift", () => {
  assert.equal(dollarsToCents("1234.56"), 123_456);
  assert.equal(dollarsToCents("$1,234.56"), 123_456);
  assert.equal(dollarsToCents("0.1"), 10);
  assert.equal(dollarsToCents("-45.5"), -4_550);
  assert.equal(dollarsToCents("12828.77"), 1_282_877);
  assert.equal(dollarsToCents("abc"), null);
  assert.equal(dollarsToCents(""), null);
});

test("dates accept ISO and Australian order, pinned to UTC", () => {
  assert.equal(parseImportDate("2026-07-28")?.toISOString().slice(0, 10), "2026-07-28");
  assert.equal(parseImportDate("28/07/2026")?.toISOString().slice(0, 10), "2026-07-28");
  assert.equal(parseImportDate("07-28-2026"), null, "US order is rejected rather than silently misread");
  assert.equal(parseImportDate(""), null);
});

test("a missing required column blocks the import", () => {
  const result = validateRows(salesDaily, [{ date: "2026-07-01", venue_code: "AVALON", gross_sales_inc_gst: "100.00" }], { allOrNothing: true });
  assert.ok(result.missingColumns.includes("company_code"));
  assert.equal(result.canApply, false);
});

test("an unknown company code is rejected, not coerced", () => {
  const result = validateRows(salesDaily, [
    { date: "2026-07-01", company_code: "XYZ", venue_code: "AVALON", gross_sales_inc_gst: "100.00" },
  ]);
  const error = result.errors.find((e) => e.code === "NOT_ALLOWED");
  assert.ok(error, "bad entity code must be blocking — it decides which company the money belongs to");
  assert.equal(result.validRows.length, 0);
});

test("duplicate rows within a file are skipped, not double counted", () => {
  const row = { date: "2026-07-01", company_code: "TCC", venue_code: "AVALON", gross_sales_inc_gst: "4210.55" };
  const result = validateRows(salesDaily, [row, { ...row }]);
  assert.equal(result.validRows.length, 1);
  assert.deepEqual(result.duplicateRowNumbers, [3]);
  assert.ok(result.errors.some((e) => e.code === "DUPLICATE_IN_FILE"));
});

test("re-uploading a file already imported does not double count", () => {
  const rows = [{ date: "2026-07-01", company_code: "TCC", venue_code: "AVALON", gross_sales_inc_gst: "4210.55" }];
  const existingKeys = new Set(["2026-07-01|TCC|AVALON"]);
  const result = validateRows(salesDaily, rows, { existingKeys });
  assert.equal(result.validRows.length, 0);
  assert.ok(result.errors.some((e) => e.code === "ALREADY_IMPORTED"));
});

test("money is stored as cents and dates as Dates", () => {
  const result = validateRows(salesDaily, [
    { date: "2026-07-01", company_code: "TCC", venue_code: "AVALON", gross_sales_inc_gst: "4210.55", transactions: "142" },
  ]);
  const values = result.validRows[0]?.values ?? {};
  assert.equal(values.gross_sales_inc_gst, 421_055);
  assert.equal(values.transactions, 142);
  assert.ok(values.date instanceof Date);
});

test("row numbers match the operator's spreadsheet, counting the header", () => {
  const result = validateRows(salesDaily, [
    { date: "2026-07-01", company_code: "TCC", gross_sales_inc_gst: "1.00" },
    { date: "bad-date", company_code: "TCC", gross_sales_inc_gst: "1.00" },
  ]);
  const error = result.errors.find((e) => e.code === "NOT_DATE");
  assert.equal(error?.rowNumber, 3, "second data row is row 3 in the file");
});

test("all-or-nothing blocks the whole import on one bad row", () => {
  const rows = [
    { date: "2026-07-01", company_code: "TCC", gross_sales_inc_gst: "1.00" },
    { date: "2026-07-02", company_code: "TCC", gross_sales_inc_gst: "not money" },
  ];
  assert.equal(validateRows(salesDaily, rows, { allOrNothing: true }).canApply, false);
  // Partial mode still lets the good row through.
  const partial = validateRows(salesDaily, rows, { allOrNothing: false });
  assert.equal(partial.canApply, true);
  assert.equal(partial.validRows.length, 1);
});

test("the error report is downloadable CSV with row, code and message", () => {
  const result = validateRows(salesDaily, [{ date: "nope", company_code: "TCC", gross_sales_inc_gst: "1.00" }]);
  const csv = buildErrorReportCsv(result);
  assert.ok(csv.startsWith("row,column,severity,code,message"));
  assert.ok(csv.includes("NOT_DATE"));
});

test("CSV parser handles quoted fields, embedded commas and BOM", () => {
  const csv = '﻿date,notes\n2026-07-01,"Quiet, then busy"\n2026-07-02,"He said ""hello"""\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.date, "2026-07-01");
  assert.equal(rows[0]?.notes, "Quiet, then busy");
  assert.equal(rows[1]?.notes, 'He said "hello"');
});

test("blank lines are ignored rather than becoming empty rows", () => {
  const rows = parseCsv("date,notes\n2026-07-01,ok\n\n\n");
  assert.equal(rows.length, 1);
});

test("creditor claims template carries the class that drives participation", () => {
  const claims = datasetByKey("creditor_claims")!;
  const classColumn = claims.columns.find((column) => column.name === "creditor_class");
  assert.ok(classColumn?.values?.includes("DIRECTOR_LOAN"));
  assert.ok(classColumn?.values?.includes("EXTERNAL_TRADE"));
  assert.equal(classColumn?.required, true);
});

test("payroll template documents that gross wages already contain PAYG", () => {
  const payroll = datasetByKey("payroll_weekly")!;
  const gross = payroll.columns.find((column) => column.name === "gross_wages");
  assert.match(gross?.description ?? "", /INCLUDING PAYG/i);
});

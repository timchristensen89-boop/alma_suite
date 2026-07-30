import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSalesErrorCsv, parseSalesCsv, resolveVenue, salesTemplateCsv, toExGstCents } from './sales-import.js';

const D = (dollars: number) => Math.round(dollars * 100);
const VENUES = ['Alma Avalon', 'St Alma'];
const opts = { defaultBasis: 'INCLUSIVE' as const, venues: VENUES };

test('gross till takings are converted to the ex-GST figure the forecast stores', () => {
  // The bug this prevents: typing $4,210.55 off the till into a field that
  // stores ex-GST overstates sales by 10% and drags COGS%, labour% and prime
  // cost with it.
  assert.equal(toExGstCents(D(1_100), 'INCLUSIVE'), D(1_000));
  assert.equal(toExGstCents(D(1_000), 'EXCLUSIVE'), D(1_000), 'an ex-GST figure passes through untouched');
});

test('a basic upload converts GST and lands ready for the forecast', () => {
  const csv = 'date,venue,gross_sales_inc_gst\n2026-08-01,Alma Avalon,4210.55\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0]!;
  assert.equal(row.venue, 'Alma Avalon');
  assert.equal(row.serviceDate.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(row.enteredCents, D(4_210.55));
  assert.equal(row.salesCents, Math.round(D(4_210.55) / 1.1), 'stored ex GST');
  assert.equal(row.enteredBasis, 'INCLUSIVE');
});

test('a column that names its basis beats the dropdown', () => {
  // The uploader said INCLUSIVE, but the file explicitly says ex-GST.
  const csv = 'date,venue,net_sales_ex_gst\n2026-08-01,Alma Avalon,3827.77\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.rows[0]?.salesCents, D(3_827.77), 'not divided again');
  assert.equal(result.rows[0]?.enteredBasis, 'EXCLUSIVE');
  assert.equal(result.basisFromFile, true);
});

test('an ambiguous "sales" column uses the basis the operator selected', () => {
  const inclusive = parseSalesCsv('date,venue,sales\n2026-08-01,Alma Avalon,1100\n', opts);
  assert.equal(inclusive.rows[0]?.salesCents, D(1_000));

  const exclusive = parseSalesCsv('date,venue,sales\n2026-08-01,Alma Avalon,1100\n', { ...opts, defaultBasis: 'EXCLUSIVE' });
  assert.equal(exclusive.rows[0]?.salesCents, D(1_100));
});

test('column names people actually use are accepted', () => {
  // A real export quotes an amount containing a thousands separator.
  const csv = 'Business Date,Location,Takings\n01/08/2026,avalon,"$4,210.55"\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(result.rows[0]?.venue, 'Alma Avalon');
  assert.equal(result.rows[0]?.serviceDate.toISOString().slice(0, 10), '2026-08-01', 'Australian date order');
  assert.equal(result.rows[0]?.enteredCents, D(4_210.55), 'currency symbol and thousands separator');
});

test('venue shorthand resolves, and an unknown venue is rejected not guessed', () => {
  assert.equal(resolveVenue('Alma Avalon', VENUES), 'Alma Avalon');
  assert.equal(resolveVenue('avalon', VENUES), 'Alma Avalon');
  assert.equal(resolveVenue('ST ALMA', VENUES), 'St Alma');
  assert.equal(resolveVenue('Freshwater', VENUES), 'St Alma');
  assert.equal(resolveVenue('Some Other Pub', VENUES), null);
});

test('an unknown venue produces a usable error rather than silent loss', () => {
  const result = parseSalesCsv('date,venue,sales\n2026-08-01,Some Other Pub,1100\n', opts);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0]?.message ?? '', /does not match a configured venue/);
  assert.equal(result.errors[0]?.rowNumber, 2, "row 2 is the first data row, as the operator sees it");
});

test('a venue selected for the upload fills in rows that omit it', () => {
  const csv = 'date,sales\n2026-08-01,1100\n2026-08-02,1210\n';
  const result = parseSalesCsv(csv, { ...opts, defaultVenue: 'St Alma' });
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.venue === 'St Alma'));
});

test('two rows for the same venue and day cannot both be counted', () => {
  const csv = 'date,venue,sales\n2026-08-01,Alma Avalon,1100\n2026-08-01,Alma Avalon,1100\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.duplicateRowNumbers, [3]);
  assert.match(result.errors[0]?.message ?? '', /Duplicate of row 2/);
});

test('the same day at different venues is not a duplicate', () => {
  const csv = 'date,venue,sales\n2026-08-01,Alma Avalon,1100\n2026-08-01,St Alma,1210\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.rows.length, 2);
  assert.equal(result.duplicateRowNumbers.length, 0);
});

test('negative takings are rejected with an explanation', () => {
  const result = parseSalesCsv('date,venue,sales\n2026-08-01,Alma Avalon,-500\n', opts);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0]?.message ?? '', /Record refunds separately/);
});

test('a bad amount or date is reported per row, and good rows still parse', () => {
  const csv = 'date,venue,sales\n2026-08-01,Alma Avalon,1100\n2026-08-02,Alma Avalon,not money\nnope,Alma Avalon,1100\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.rows.length, 1, 'the good row survives');
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.errors.map((error) => error.rowNumber), [3, 4]);
});

test('a missing sales column is reported clearly rather than importing zeroes', () => {
  const result = parseSalesCsv('date,venue,covers\n2026-08-01,Alma Avalon,186\n', opts);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0]?.message ?? '', /No sales amount found/);
});

test('blank lines and a BOM from Excel are tolerated', () => {
  const csv = '﻿date,venue,sales\n2026-08-01,Alma Avalon,1100\n\n\n';
  const result = parseSalesCsv(csv, opts);
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 0);
});

test('the downloadable template parses cleanly through the same code path', () => {
  const result = parseSalesCsv(salesTemplateCsv(), opts);
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.venue, 'Alma Avalon');
  assert.equal(result.rows[1]?.venue, 'St Alma');
});

test('the error report is downloadable CSV', () => {
  const result = parseSalesCsv('date,venue,sales\nnope,Alma Avalon,1100\n', opts);
  const csv = buildSalesErrorCsv(result.errors);
  assert.ok(csv.startsWith('row,column,message'));
  assert.ok(csv.includes('is not a date'));
});

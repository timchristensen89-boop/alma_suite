# Stocktake scope and date remediation — proposal, no writes

_Prepared from the 27 Sep 2026 dump (`alma-alma_suite_v18-20260926T170002Z.sql.gz`)
restored in isolation. Nothing in this document has been applied. Every
change below needs Tim's approval and is a single explicit update per
record; there is no bulk backfill, and the migration that adds `scope`
sets every existing record to `UNKNOWN` and nothing else._

## Why

Actual COGS now needs, at each month boundary, one **COMBINED** count or a
**FOOD** count plus a **BEVERAGE** count, each of known scope and
sufficiently valued (no line counted above zero without a value), within
±7 days. Every existing count is `UNKNOWN`, so until scopes are set on
review, every month reads _unavailable_ — which is the honest state, not a
regression: the one month that read _complete_ (Alma Avalon, June, $12,194.52
/ 18.9 %) was a food-only opening against combined purchases.

Setting a scope on a historical record is a **reviewed decision** recorded
in `scopeEvidence`; the rule never infers it from the dollar value. The
evidence column below is what a reviewer would be agreeing to.

## Records since May 2026 (the ones that can affect Jun–Sep)

| Record (name · venue · status) | Current `countedAt` | Proposed `countedAt` | Current scope | Proposed scope | Evidence | Confidence | Requires approval |
|---|---|---|---|---|---|---|---|
| Loaded import · Alma Avalon · 2026-05-31 · REVIEWED | 2026-05-31 12:00 server-local (CSV date) | unchanged | UNKNOWN | **FOOD** | 137 lines, $4,088.11, 100 % in food categories, 0 % beverage; 10 unlinked lines (valuation to check in section 8 of the validator) | high | yes |
| Loaded import · Alma Avalon · 2026-06-02 · REVIEWED | 2026-06-02 12:00 (CSV date) | unchanged | UNKNOWN | **BEVERAGE** | 226 lines, $18,673.49, 99.5 % beverage ($91.27 food); 7 unlinked | high | yes |
| Loaded import · St Alma · 2026-06-02 (bar session) · REVIEWED | 2026-06-02 12:00 (CSV date) | unchanged | UNKNOWN | **BEVERAGE** | 311 lines, $21,811.24, 99 % beverage; **151 unlinked, unvalued lines** — insufficiently valued, will be refused for COGS whatever its scope | high (scope) | yes |
| Loaded import · St Alma · 2026-06-02 (food session) · REVIEWED | 2026-06-02 12:00 (CSV date) | unchanged | UNKNOWN | **FOOD** | 204 lines, $1,906.02, 100 % food; **146 unlinked** — insufficiently valued | high (scope) | yes |
| VOID — stray count · no venue · IN_PROGRESS · 2026-06-07 | 2026-06-07 11:07 | unchanged | UNKNOWN | leave UNKNOWN | Not finalised, no venue, named VOID; never a candidate | — | no action |
| Loaded import · Alma Avalon · 2026-06-30 · LOCKED | 2026-06-30 12:00 (CSV date) | unchanged | UNKNOWN | **leave UNKNOWN** (or COMBINED only if Tim confirms both sheets were exported together) | 373 lines, $4,833.95: beverage $2,989.36 + food $1,844.59; 88 unlinked. A bar holding of $2,989 against $18,673 four weeks earlier is not a full bar count — treating this as COMBINED would give June a negative COGS and July a fictitious opening | low | yes — needs Tim's knowledge of what was exported |
| Loaded import · St Alma · 2026-06-30 · LOCKED | 2026-06-30 12:00 (CSV date) | unchanged | UNKNOWN | **leave UNKNOWN** | 527 lines, $2,531.65: beverage $400.05 + food $2,131.60; **323 unlinked** — insufficiently valued regardless | low | yes |
| St Alma — Sat 1st Aug, 10:00 AM (from Loaded) · REVIEWED · `loaded-pdf:drinks.json` | **2026-08-03 06:11 UTC (import time — wrong)** | **2026-08-01 10:00 Sydney = 2026-08-01T00:00:00Z** | UNKNOWN | **BEVERAGE** | Printed "Sat 1st Aug, 10:00 AM" (1 Aug 2026 is a Saturday); 311 lines, $52,321.80, 100 % beverage. Unmatched sheet lines were **dropped** by the old importer, so its value is understated by the unmatched share (the notes record "N of M lines matched") | high | yes |
| Alma Avalon — Fri 31st Jul, 10:55 PM (from Loaded) · REVIEWED · `loaded-pdf:avalonfood.json` | **2026-08-03 06:11 UTC (import time — wrong)** | **2026-07-31 22:55 Sydney = 2026-07-31T12:55:00Z** | UNKNOWN | **FOOD** | Printed "Fri 31st Jul, 10:55 PM" (31 Jul 2026 is a Friday); 132 lines, $2,604.15, 100 % food; dropped unmatched lines as above | high | yes |
| St Alma — Kitchen 31/8 · SUBMITTED · template "St Alma — Kitchen" | 2026-08-30 15:50 UTC (31 Aug 01:50 Sydney) | unchanged | UNKNOWN | **FOOD** | Template "St Alma — Kitchen" (13 food categories); 332 lines, $4,401.27; 11 unlinked lines (prep lines are linked by recipe; the validator's section 8 says whether any counted line is unvalued) | high | yes |
| St Alma — Bar & FOH 31/08 · SUBMITTED · template "St Alma — Bar & FOH" | 2026-08-30 17:00 UTC (31 Aug 03:00 Sydney) | unchanged | UNKNOWN | **BEVERAGE** | Template "St Alma — Bar & FOH" (11 beverage categories); 331 lines, $50,136.09, 0 unlinked | high | yes |
| Stocktake 9/1 · venue "Avalon" · IN_PROGRESS · template "Full count" | 2026-08-31 15:39 UTC | unchanged | UNKNOWN | leave UNKNOWN | 830 lines, $0.00, not finalised; venue label "Avalon" resolves to Alma Avalon by alias. Not a candidate until counted and submitted | — | no action |
| Alma Avalon — Bar & FOH 9/1 · SUBMITTED · template "Alma Avalon — Bar & FOH" | 2026-08-31 15:39 UTC (1 Sep 01:39 Sydney) | unchanged | UNKNOWN | **BEVERAGE** | Template "Alma Avalon — Bar & FOH"; 436 lines, $20,870.49, 0 unlinked | high | yes |

## Older records (Aug 2025 – Apr 2026)

The seventeen "Historical Bar Stocktake • MM.YY" / "Historical Kitchen
Stocktake • MM.YY" counts carry the templates `bar` and `kitchen`; the
template name alone supports **BEVERAGE** / **FOOD** respectively (medium
confidence — the categories behind those legacy templates are not
recorded). St Alma 14 Mar 2026 "Month end stocktake" (`kitchen`, $0.00,
122 lines) is a blank sheet and should stay UNKNOWN. The three Loaded CSV
imports of 31 Mar, 30 Apr (St Alma) have no scope evidence and stay
UNKNOWN. None of these affects Jun–Sep 2026 and none is proposed for
change in this batch.

## Expected effect on Jun–Sep once the "high" rows above are approved

| Period · venue | Opening | Closing | Result |
|---|---|---|---|
| June · Alma Avalon | 31 May FOOD $4,088 + 2 Jun BEVERAGE $18,673 (composed, 2 days apart, within ±7) | 30 Jun UNKNOWN → refused | **unavailable** (was "complete $12,194.52 / 18.9 %") |
| June · St Alma | 2 Jun FOOD + 2 Jun BEVERAGE, both **insufficiently valued** → refused | 30 Jun UNKNOWN, insufficiently valued → refused | **unavailable** (missing components; the 1 Jul drinks import alone does not fix June: the 2 Jun bar count is undervalued and June would read negative) |
| July · Alma Avalon | 30 Jun UNKNOWN → refused | 31 Jul FOOD $2,604 alone (no bar count within ±7 of 1 Aug) → incomplete | **unavailable** |
| July · St Alma | 30 Jun UNKNOWN → refused | 1 Aug BEVERAGE $52,322 alone (no kitchen count within ±7) → incomplete; with the 1 Jul drinks import it would be a BEVERAGE-only opening too | **unavailable** |
| August · Alma Avalon | 31 Jul FOOD alone → incomplete | 1 Sep BEVERAGE $20,870 alone; the kitchen "Stocktake 9/1" is IN_PROGRESS at $0 | **unavailable** |
| August · St Alma | 1 Aug BEVERAGE alone → incomplete | 31 Aug FOOD $4,401 + BEVERAGE $50,136 = **$54,537.36 complete** (components 1 h apart) | **unavailable** (opening incomplete) — the closing is the first complete combined boundary |
| September · St Alma | 31 Aug FOOD + BEVERAGE $54,537.36 — a valid opening | none yet | in progress; complete once a 30 Sep / 1 Oct pair or full count exists |
| September · Alma Avalon | 1 Sep BEVERAGE only → incomplete (kitchen count never submitted) | none yet | **unavailable** until the Avalon kitchen count is finished and submitted |

The same-dump re-run (validator sections 2 and 8) is the check on this
table; it will show every candidate, its scope, its valuation and why each
was used or rejected.

## The two mis-dated PDF imports — remediation commands (NOT run)

Both records were written with `countedAt` = the import time. The printed
dates are unambiguous. Proposed, one `UPDATE` each, after approval:

```sql
-- St Alma drinks, printed "Sat 1st Aug, 10:00 AM" (1 Aug 2026 is a Saturday): 10:00 AEST.
UPDATE "Stocktake"
SET "countedAt" = '2026-08-01T00:00:00Z',
    "countedAtText" = 'Sat 1st Aug, 10:00 AM',
    "countedAtSource" = 'operator',
    "scope" = 'BEVERAGE',
    "scopeEvidence" = 'reviewed: Loaded sheet drinks.json, all headings beverage; date from the printed text (import stamped 2026-08-03 06:11Z)'
WHERE "importSource" = 'loaded-pdf:drinks.json' AND "countedAt" = '2026-08-03T06:11:00Z'::timestamptz  -- confirm exact value first
  AND "scope" = 'UNKNOWN';

-- Alma Avalon food, printed "Fri 31st Jul, 10:55 PM" (31 Jul 2026 is a Friday): 22:55 AEST.
UPDATE "Stocktake"
SET "countedAt" = '2026-07-31T12:55:00Z',
    "countedAtText" = 'Fri 31st Jul, 10:55 PM',
    "countedAtSource" = 'operator',
    "scope" = 'FOOD',
    "scopeEvidence" = 'reviewed: Loaded sheet avalonfood.json, all headings food; date from the printed text (import stamped 2026-08-03 06:11Z)'
WHERE "importSource" = 'loaded-pdf:avalonfood.json' AND "scope" = 'UNKNOWN';
```

Each statement must affect exactly one row (`SELECT` first with the same
`WHERE`). Because the old importer dropped the unmatched sheet lines, the
alternative is to **re-import** both from their `.json` extracts with the
corrected script (which keeps unmatched lines as unlinked valued lines and
parses the date itself), then delete the mis-dated originals — a larger
change that also needs approval and the original `.json` files.

## The 1 July St Alma drinks count — import command (NOT run)

The Drive PDF ($54,018, header reflows to "St View Stocktake / Alma") was
never imported. With the corrected importer, from the API container:

```bash
# 1. dry run — reads the sheet, resolves the venue, parses the date, reports scope and matches; writes nothing
node --import tsx scripts/import-loaded-stocktake.ts /var/tmp/st-alma-drinks-2026-07-01.json --venue "St Alma" --scope BEVERAGE

# 2. only after the dry run reconciles ("Reconciles against all N category totals") and the instant reads 2026-07-01:
node --import tsx scripts/import-loaded-stocktake.ts /var/tmp/st-alma-drinks-2026-07-01.json --venue "St Alma" --scope BEVERAGE --apply
```

Expected result of step 2: one `IN_PROGRESS` stocktake, venue St Alma,
`scope = BEVERAGE` (evidence: operator + headings), `countedAt` = the
printed 1 July time in Sydney (`countedAtSource = 'printed'`, text kept),
value ≈ $54,018 including unmatched lines as unlinked valued lines. It
then needs review and submission to become finalised. Effect on COGS:
none on June (the 2 Jun bar count is insufficiently valued, and 30 Jun is
UNKNOWN); none on July (still no St Alma kitchen count within ±7 days of 1
Jul or 1 Aug). It is a correct record to have, not a fix for either month.

If the sheet's date does not parse (`Instant UNKNOWN`), the script refuses;
pass `--counted-at 2026-07-01T10:00:00+10:00` only after reading the
printed time off the PDF.

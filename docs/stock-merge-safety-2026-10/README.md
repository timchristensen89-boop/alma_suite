# Duplicate merge safety fix (17 Oct 2026, **not deployed**)

## Audit: what production runs today

Production (main `5994f7f4`, image `release-5994f7f`) still runs the original Items → Duplicates merge (`mergeItemsWithin` in `items.service.ts`). PR #326 repaired the **data** damaged by the 06:48 merges. It did **not** change the merge. The deployed merge:

- **Adds holdings together.** At every venue where both records hold stock, the two quantities are summed. This is how this morning's leftovers doubled up: Giffard Rose at St Alma went 4.5 + 3.1 + 0.97 = 8.57.
- **Adds count lines together and deletes one.** It does this on any count with lines for both records, applied counts included, so the recorded history changes.
- **Ignores units.** A 12.5 kg bag merged into a per-kilo record adds 1, not 12.5. Five-litre juice containers merged into a per-litre record add 1 L each.
- **Copies unit-dependent fields across units.** For example, "5000 mL" was copied onto a per-litre record, and a placeholder $1.08 price onto a 4 L tin.
- **Gives no preview.** The confirmation said only "per-venue stock is combined".

Only group-wide managers can merge, which was already enforced.

## What changes

The merge now lives in `apps/stock-api/src/services/item-merge.ts`. One planning function feeds both the preview and the merge.

**History is repointed, never rewritten.** Every count line, movement, invoice line, recipe line, order line, transfer, wastage record and supplier alias moves to the kept item. Count lines keep their quantity, unit, value and notes. No line is added together or deleted, and every movement keeps the line it came from.

**Stock is never added together.** It is decided venue by venue:

| At a venue | What happens |
|---|---|
| No record holds stock | Nothing changes |
| Only the kept item holds stock | Unchanged |
| Only one duplicate holds stock | Carried across, converted to the kept item's unit: one 12.5 kg bag becomes 12.5 in a per-kg record; 3.32 five-litre containers become 16.6 L |
| Two or more records hold stock | **The manager decides:** keep one record's quantity, or enter what is on the shelf. Nothing is pre-selected. The record counted most recently is marked as a hint |
| The units cannot be converted | **The manager decides,** the same way |

Holdings never move between venues. Every change to a holding is written to the ledger as a stocktake-correction movement, on both the kept item and the duplicate.

**Counts that can still be applied block the merge.** This applies when an open, submitted or reopened count lists two of the records, because apply keeps one line per item and would silently drop the other. It also applies when such a count has a duplicate counted in a different unit. Applied and locked counts are history: they are repointed and never block.

**Safe under concurrency, and safe to repeat.** The records and their counts are locked for the duration of the merge. The merge re-plans inside the transaction and refuses if stock or counts changed since the manager's review (`planToken`). Repeating a finished merge changes nothing (`alreadyMerged`). Two simultaneous clicks produce one merge and one no-op.

**Unit-dependent fields** (measure, costs, par, reorder point, count unit) are copied onto the kept item only from a duplicate that counts in the same unit and size.

**API:**
- `POST /api/items/merge/preview` returns the plan and changes nothing.
- `POST /api/items/merge` now takes `holdings` (one decision per venue that needs one) and `planToken`.

**Screen:** "Keep X, review merge" opens a review drawer, from both the Duplicates panel and the selected-items merge. It shows:
- what happens to history
- a promise that stock is never added together
- each venue's records, with quantity, converted quantity and last count
- the outcome at each venue, and the decision wherever one is needed
- the stock value before and after

Merge stays disabled until every venue is decided, then the typed MERGE ITEMS confirmation follows.

**Scripted merges** (`scripts/lib/duplicate-merge.ts`) now pass their reviewed per-venue decisions explicitly. Their reviewed same-sheet treatments are applied before the merge, and rollback also removes the new ledger rows. Their tests pass unchanged.

## Tests

`apps/stock-api/tests/item-merge-safety.test.ts`:

- unit factors: same unit, 12.5 kg bag, mL to L, unknown
- a conflict is refused without a decision, and a refused merge writes nothing
- decisions apply exactly per venue, and every change is on the ledger
- a single holder is carried and converted, and a 12.5 kg measure is not copied onto a 1 kg record
- an unconvertible unit needs a counted quantity, and a per-box cost is never copied onto a per-litre item
- history is identical before and after: every line and movement, with nothing folded
- an open count listing both records blocks the merge
- a stale review is refused, a repeated merge is a no-op, and simultaneous clicks produce one merge
- **property:** across 12 randomised three-record merges, no venue ever ends above its largest record, and never at the sum

The stock-api suite passes 348 of 348.

## Rehearsal on restored production copies

**Today's production (17 Oct, 17:01):** no duplicate groups remain. A run changes nothing: values, 9,312 count lines and every movement are identical.

**Production at 06:37, just before the 27 app merges, using the same 25 keep-groups:**

| Run | Merged | Waiting for a decision | Alma Avalon | St Alma | History and movements |
|---|---:|---:|---|---|---|
| Old merge (what happened at 06:48) | 25 | — | $37,596 → $39,322 | $63,528 → $64,567 | 53 lines deleted, 18 summed |
| **New merge, no decisions** | 4 | 21 | **unchanged** | **unchanged** | identical |
| New merge, keeping the most recently counted record | 25 | 0 | $37,596 → $39,765 | $63,528 → $62,871 | identical |

In the last row, no venue ever exceeded its largest record. The Avalon rise in that row comes from juice counted in 5 L containers being converted to litres at the then-uncorrected $70/L price, which PR #324 has since fixed. It is not from adding stock.

`scripts/rehearse-safe-merge.ts` reproduces these runs. It refuses to run against anything but a local copy.

## Not done

Nothing has been merged, deployed or run against production. Deploying means the stock-api image and the stock web app. There is no migration and no data change.

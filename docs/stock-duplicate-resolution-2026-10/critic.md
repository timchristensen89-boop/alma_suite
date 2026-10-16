# Critic report: how complete and consistent the duplicate-merge decisions are

Inputs: the 232 decisions in `decisions/*.json`, the 452 verdicts in `verdicts/*.json` (220 identity+stock pairs and 12 `separate`), the specialist reports in `special/`, the facts in `facts/*.json` and the read-only clone `alma_stock_orig`. Nothing was written to any database or to `alma-stock-simplify`. Money is in cents unless shown as $. The machine-readable corrections are in `special/critic-corrections.json`: 226 entries across 141 clusters, each with `{index, field, current, corrected, reason}`. Every reason starts with a tag:

- `[verdict-endorsed]`: a verdict's correction that I accept.
- `[critic-consistency]`: a pattern applied unevenly across clusters.
- `[critic-new]`: something the per-cluster review missed.

Two code facts underpin most of the findings below. I checked both against the source:

- **mergeItems step 6 backfills every NULL field on the parent from the first duplicate that has a value.** The test is `!== null`, so a cost of 0 also counts as a value and gets copied (items.service.ts 1546-1590). The fold runs on every stocktake status and only merges lines whose units match (1414-1447).
- **applyStocktake does no unit conversion.** It writes `quantityAfter = line.countedQty` (+ prep contribution) as the stored number, ignoring the line's unit. When an item has several counted lines, the last one wins (stocktakes.service.ts 1430-1453).

## 0. Headline numbers

| Check | Result |
|---|---|
| (8) Clusters never decided | **0 of 232**. All indices 0-231 are present. Five files (48-50, 51-53, 63-65, 78-80, 81-83) wrap their list as `{"decisions":[...]}` instead of a bare array, so the merge script's loader must accept both shapes. |
| (1) Decision and verdict disagree | **36 clusters**, one refuting verdict each. I endorse all 36. I add my own call on 149, 150 and 199 (§1). |
| (4) unitSafe=false but marked merge or merge_partial | **62 clusters** (§4) |
| (6) Same-sheet double counts in the facts | 133 sheet pairs where two members both have a count. The decisions mark `present=true` on all of them, so none is missing. However, **14 clusters** use a single cluster-wide treatment that is wrong for at least one of their sheets, and **3** use `recount`, which is not an executable fold treatment (§6). |
| (5) Holdings missing from onHandPlan | **0** |
| (5) Prep-held holdings discarded as "drift" | **20** discarded, **13** kept, **6** marked recount, all of the same class (stale-decisions `PREP-HELD`). Verdicts fixed 11. I fix 6 more and keep one exception, 82 (§2 P1). |
| (5) Duplicate holdings marked `recount` | 7 on duplicates (130, 144, 149, 151, 185, 228, 231). The script sums them raw. |
| (3) Canonical has no avgCost | 12 clusters. 182 would backfill a **0**. 217 has no cost anywhere. 145 and 203 now stay separate (§3). |
| Backfill hazards that no costTreatment handles | measure: 24 clusters, **224 missed** by both decision and verdict. latestCost: 34 clusters, of which **169 and 226 are wrong and unflagged** and **120** only says "watch" (§3) |
| (7) Items in two clusters | 4: 17/188, 103/194, 145/203, 159/205. Spec §5.2 refuses the whole run while any of these remain. |
| (7) Canonical that is a duplicate elsewhere / archived members / mL-g recipes with no measure after backfill | 0 / 0 / 0. Two clusters have mL recipes against a g measure (107, 192), and both decisions handle it. |
| Unapplied AA "Stocktake 10/1/2026" lines in g/kg/mL/L on items counted in each or bottle | **22 lines in 20 merge clusters**. Applied raw, they would book about **$144,063** of phantom stock (§5) |
| Discards on members that are not merged | 11 holdings, $1,528.26 (164, 188, 193, 199, 205-208, 213, 225). The merge script never executes these; they need a standalone adjustment. |

## 1. Decision vs verdict disagreements (36). Critic call: endorse all, with three amendments

| # | Cluster | What the verdict changes | Critic call |
|---|---|---|---|
| 81 | Woodford Reserve | Swap the St Alma treatments: keep the canonical's 0.4 (latest applied 31/08 count) and discard the twin's 0.05 (2025 residue). Stale 4907, retained 3603. | Endorse. This becomes rule P2. |
| 101 | Giffard Ginger Syrup | Keep the twin's AA 0.6875 (prep-held in Ginger Spice Batch). Stale 6463, retained 1471. | Endorse (P1) |
| 105 | Lime Juice 5 L | Keep the twin's StA 8 L (applied 31/08). keep_duplicate_line on StA 31/08 and on AA 10/1 (25.1 L). Measure 1000 ml, avg 1400. | Endorse |
| 128 | Serenello Prosecco | Use a separate treatment per sheet; AA 9/1 is keep_duplicate_line. | Endorse (P5) |
| 129 | Panko | Restate the 561 g line on AA 10/1 to 0.561 each; measure 1000 g. | Endorse (P6) |
| 136 | Garlic powder | The surviving AA 10/1 line must read 1 each, not 540; category Herbs & Spices. | Endorse |
| 137 | Onion powder | Swap the AA treatments: discard the twin's Nov-25 holding of 1, keep the canonical's 3 Aug 0.6. Collapse the AA 10/1 lines after a shelf check. | Endorse |
| 140 | Pistachio | Per-sheet treatment; restate the 970 g line to 0.97 each; set the duplicate's measure to 1000 g before the merge. | Endorse |
| 145 | Sea salt flakes | Do not merge the Olssons 6 kg carton into the 2 kg item. | Endorse: **keep_separate**. 203 agrees. |
| 146 | Sesame | Keep the twin's StA 0.312161 (prep-held); restate 969 g. | Endorse |
| 148 | White wine vinegar | Keep the twin's StA 0.137842 (prep-held). | Endorse |
| 149 | Olive oil pomace | Zero the twin's StA "recount" holding, then set the canonical after the merge. Measure 1000 ml. | Endorse, and **amend**: set St Alma to **1.66924 L** (0.3 loose plus 0.11731 tins held in prep, times 4 L) rather than the verdict's hedged 1.2 L, so the result matches P1. |
| 150 | Guajillo | Keep the twin's StA prep share, converted to 1.75988; latestCost 482. | Endorse, and **amend**: the verdict says the repointed 157 g line on AA 10/1 "converts to 1.57 each when applied". It does not, because apply is raw (157 × 482c = $757). Restate the line to 1.57 each. |
| 151 | Allspice | Keep the twin's StA 0.367277 (0.17 loose + 0.197 held); measure 350 g. | Endorse. I add a per-sheet split, because a cluster-wide keep_duplicate_line would blank the AA 350 g count, and that 350 g line must be restated to 1 each. |
| 160 | Honey | Pre-set latestCost to 2030; the backfill would copy a per-kg 678. | Endorse |
| 168 | Mozzarella | Pre-set measure to 1000 g and latestCost to 1150; costReviewed true. | Endorse |
| 173 | Chicken thigh | merge_partial: keep the 5 kg pack separate. | Endorse |
| 199 | Teusner Wark | Do not rename to "2023", and stop contradicting the decision's own reasoning about the 2022. | **Critic call: merge both vintaged records into the undated floor item.** This is the verdict's preferred option. The vintage split follows spelling, not stock: 'Teusner' lines went to the 2022 at St Alma and 'Tesuner' lines to the 2023 at Avalon. The floor item continues both count series, and the decision itself discards the 2022 St Alma 15 as "the same bin". The same pattern is merged everywhere else (112-126 and 200-202 fold vintaged invoice twins into undated floor items). This needs Tim to confirm that vintages are not tracked; if they are, merge nothing. Relink the Avatar and Big Jim history lines first. |
| 201 | Schlumberger | latestCost 4752 (the backfill would copy a 28512 case price). | Endorse |
| 203 | Salt Flakes | keep_separate pending a shelf check. | Endorse. This also clears the 145/203 double membership. |
| 204 | Dried thyme | Keep the twin's StA prep share, converted to 0.059591 kg. | Endorse |
| 206 | Chipotle | Keep the Faro StA 0.244853 (prep-held). | Endorse |
| 210 | Eggs | merge_partial: the Packet dozen stays separate until free-range or caged is confirmed. | Endorse |
| 215, 217, 218, 219, 223, 229 | kg produce | Block the 100 g measure backfill; delete the duplicate blank lines on AA 10/1. | Endorse. **224 has the same hazard and nobody flagged it** (§2 P3). |
| 216 | Cauliflower | Discard the canonical's AA 1 (480). | Endorse |
| 220 | Coriander | Keep StA 3.73 bunches (prep-held). | Endorse |
| 224 | Red capsicum | Keep the canonical's StA 0.238 kg (prep-held). | Endorse, plus the measure fix |
| 225 | Limes | Set measure to 1000 g; avg and latest cost 1852. | Endorse |
| 227 | Brown onions | Keep the canonical's StA 5.04 kg (prep-held); keep_duplicate_line on AA 10/1 (11 kg). | Endorse |
| 228 | Spanish onions | Change the duplicate's StA "recount" to discard_stale. | Endorse |
| 231 | Tomatoes | Keep the LRG prep share; correct the Large Box's 100x prep mis-scaling to 0.476839. | Endorse |

## 2. The same pattern treated differently

| Pattern | How the decisions split | Correction (rule) | Clusters corrected |
|---|---|---|---|
| **P1 Prep-held holdings** (an applied sheet counted 0 loose and credited stock held inside counted prep batches to the twin that the recipe points at) | 20 discarded as "drift" or "residue", 13 kept, 6 recount. Verdicts flipped 11. | Keep the holding and convert it to canonical units. It is real stock, and the merge repoints the recipe lines, so later credits land on the canonical. The one exception is when the 1 Oct sheet recounted the batch and the canonical's line there is blank, so a later apply would never overwrite the credit. That exception is cluster **82** (Lyre's White Cane StA 4.37), and the decision states the reason. | **99** (+1372c), **100** (+521c), **102** (carry only the 0.225 held share, +534c), **106** (+2883c), 141 (+119c). 152, 215 and 218 are under 25c each and listed only. |
| **P2 Interim holding when the canonical is on the 1 Oct sheet but the twin has the later applied 31/08 count** | 113 and 117 keep the twin's 31/08 count and zero the canonical's 3 Aug figure. 114, 89 and 200 do the opposite. 81 zeroed a real 31/08 count and kept a 2025 ghost (verdict). | The surviving holding is the most recent APPLIED real count. The end state after the 1 Oct apply is the same either way, but the interim on-hand and valuation are right. | **114** (17.3 → 10.2 at StA), **89** (1.42 → 1.1). **200 is left as decided**, with the reason that the 31/08 figure of 2.4 on the case row is contradicted by 12.9 before it and 12 after it, and may be cases. |
| **P3 Measure backfill onto kg or L items** | 105, 109, 144, 149 and 168 and the verdicts on 215-229 block it. **224 does not.** | Pre-set the canonical's measure before the merge, so the copied value can never land. | 224 plus machine-readable entries for all |
| **P4 latestCost backfill of case or per-kg prices** | 121, 122 and 123 give a fix. 120 says "watch". 160, 201 and 225 were missed (verdicts caught them). **169 and 226 are missed by both.** 157 and 183 give the fix in prose only. | Pre-set latestCostCents to the per-count-unit price. | 120, 121, 122, 123, 157, **169**, 183, **226** |
| **P5 One cluster-level same-sheet treatment** | The detail text is usually right per sheet, but the field holds a single string. Spec §7 expects a per-sheet list with line ids. | Use a per-sheet array (§6). | 18 clusters |
| **P6 Does apply convert g/mL to each?** | 129, 140, 150, 151, 152 and 203 assume it does. 136, 146, 153, 154 and 169 say it does not. **The code does not.** | Restate every metric line on the unapplied AA 10/1 sheet before it is applied (§5). | 16 preApplyLineFix entries |
| **P7 700 vs 750 mL spirits** (52 clusters) | 26 say "set 700", 10 say "check", 5 say keep 750, and the rest only mention it. All 123 floor-wave (cmptov) spirits are 750, so 750 there is a blanket default, not evidence. | Set 700 where the invoice name says 700ML and the Loaded labels say 700 or nothing. **Shelf check** where the Loaded labels say 750 (0, 36, 44) or the Aug-wave canonical conflicts with an invoice "750ML" (5, 37, 67). Spec §5.1 refuses all 52 until the measures agree. | 45 overrides + 6 shelf checks |
| **P8 Category re-filing** | 27, 37, 38, 47, 63-66 and 136/137 re-file in prose. 138, 204, 148, 149 and 190 are silent on the same pattern. | Add a categoryOverride field. Lyre's (190) belongs in Non-Alcoholic & Mixers, as in 82 and 106. | 16 |
| **P9 Vintaged invoice twin folded into an undated floor item** | 8 of 18 suggested names add a year, and 10 drop it. | Use undated names. | 112, 113, 114, 116, 118, 201, 202 (and 199) |
| **P10 "(Case of N)" twins** | Merged consistently as the same product. The case cost stored per bottle only inflates discarded values (for example 117's $5,302 is a case price on bottles). | No change | — |
| **P11 `recount` on a duplicate holding** | Seven decisions use it. The merge script does not zero it, so it is summed raw, including the unit errors. | Use `keep` with a converted onHand, or `discard_stale`. | 130 (→ 9.96 tortillas), 144 (→ 15.27 kg), 149, 151, 228, 231. In 185 "recount" was meant as keep, which happens to equal summing. |

## 3. Canonical config gaps no costTreatment closes

| # | Gap | Correction |
|---|---|---|
| 182 Lemons | avgCost is NULL and the duplicate's is 0. The decision says "do not let a 0 be backfilled", but step 6 copies any non-null value, so the 0 is copied. | Pre-set avgCost to 200 |
| 217 Habanero | No avgCost on either member, so every holding values at 0. | avgCost 2233 (25 Jun invoice) |
| 169 Cream | latestCost is NULL. The backfill copies 773 (a per-litre price) onto the 5 L tub. costTreatment says nothing is backfilled. | latestCost 3720 |
| 226 Mesclun | latestCost is NULL. The backfill copies 1759 (per kg) onto the 1.5 kg box. | latest and avg 2423 |
| 224 Red capsicum | measure is NULL on a kg item. The backfill copies the floor item's 100 g. | measure 1000 g |
| 120 Loic Mahe | latestCost is NULL. The backfill copies the case price 45581. | latestCost 3798 |
| 2, 43, 63, 64, 133, 134, 141, 181 | avgCost is NULL, and the backfilled value is correct for the count unit. | none |

## 4. unitSafe=false merges (62). Critic call

- **Counts combine 1:1; only recipe costing depends on the measure.** Merge is OK once the measureOverride runs before the merge: 7, 75, 82, 96, 103, 104, 107, 110, 132, 139, 141, 142, 143, 147, 156, 157, 158, 159, 160, 161, 162, 166, 167, 177, 180, 187, 190, 192, 195, 196, 198, 215, 217, 218, 219, 220, 221, 223, 224, 227, 229. Most floor-wave kitchen "each/100 g" rows are really kg or pack counts, as Loaded's "Kilo" labels and the values show.
- **Holdings or lines need arithmetic.** Merge is OK only with the converted onHand in the plan: 105, 109, 129, 130, 140, 144, 149, 150, 151, 168, 169, 204, 214, 226, 231.
- **Now keep_separate or partial per the verdicts:** 145, 203, 206 (partial), 98 (OK as decided).
- Spec §5.1 refuses any cluster whose `countUnit` differs (32 clusters) or whose measures differ (100 clusters). Either the script needs an override path driven by the decision fields, or each cluster needs a pre-merge patch that makes the duplicate match. As written, the decisions cannot pass the script.

## 5. Unapplied Alma Avalon "Stocktake 10/1/2026": metric lines on each/bottle items

Apply is raw, so each of these lines would store its number as count units. Totalled at the canonical's cost, that is $144,063:

| # | Line | Raw | Should be |
|---|---|---|---|
| 140 | 970 g pistachio | $43,165 | 0.97 each |
| 169 | 800 mL cream | $29,760 | 0.16 tub |
| 226 | 800 g mesclun | $22,400 | 0.533 box |
| 142 | 757 g pepitas | $9,137 | 0.757 |
| 146 | 969 g sesame | $8,721 | 0.969 |
| 151 | 350 g allspice | $4,900 | 1 |
| 136 | 540 g garlic powder | $4,887 | 1 |
| 137 | 500 g onion powder | $4,500 | shelf check |
| 153 | 400 g quills | $4,000 | 2 |
| 157 | 237 g peppercorns | $3,674 | 0.474, or delete |
| 129 | 561 g panko | $3,501 | 0.561 |
| 152 | 300 g cinnamon | $3,369 | 0.75 |
| 154 | 100 g cumin | $1,100 | 0.222 |
| 150 | 157 g guajillo | $757 | 1.57 |
| 195 / 196 / 214 / 98 / 162 / 138 | L, kg | small | see JSON |

## 6. Same-sheet treatments that are wrong on at least one sheet

| # | Single treatment | The sheet it gets wrong |
|---|---|---|
| 100 | keep_duplicate_line | AA 10/1: canonical 1.25, twins blank, so the count would be blanked |
| 116 | keep_canonical_line_only | StA 31/08 (applied): canonical blank, twin **28**, which would be deleted |
| 117 | keep_canonical_line_only | StA 31/08 (applied): twin 3.6 deleted |
| 140, 150, 169, 226, 227 | keep_canonical_line_only | AA 10/1: the only count is on the duplicate (970 g, 157 g, 800 mL, 800 g, 11 kg) |
| 144, 151, 200, 209, 214, 225 | keep_duplicate_line | A second sheet where the canonical holds the count (AA 10/1 2 kg, 350 g, 1700, 1.473 kg, 5.8 kg; AA 9/1 7 for 200) |
| 105, 137, 157 | recount | Not executable. Units differ, so there is no fold; two counted lines are left and apply keeps the last one. |
| 128 | keep_canonical_line_only | AA 9/1: canonical blank (verdict) |

## 7. What the per-cluster view cannot see

- **103 and 194 share the same canonical** (Giffard Strawberry). Run them as one merge (103.duplicateIds += `cmsdf10g1001rmiiowqgdccbj`). Otherwise §5.2 refuses the run. 194's risk note confirms the AA 10/1 0.4 must stay single.
- **145 and 203 share `cmsdf12uj`.** Both are now keep_separate.
- **159 and 205 share `cmoqfbld6`** (merged in 159, keepSeparate in 205). Drop it from 205's list.
- **17 and 188 share `cmptovvyb`.** There is no conflict, but a keep_separate cluster should carry canonicalId null.
- **Twins outside any cluster:**
  - Manly Spirits Dry Gin `cmptovwfz00drs601ep9r8o8y` belongs with 192. It is also tied to the Manly mL-as-bottles corruption.
  - Manly Triple Sec `cmptovwge00dus601f7xn8avx` and Triple Sec No Sugar `cmptovwgv00dxs601pi20zgpp` belong with 193's two bulk items. 193 discards $1,084 of stale holdings that only these follow-up merges would execute.
  - Loaded's 'Sea Salt Flakes 2 KG' lines are mislinked to the Olssons 6 kg item (203).
- **Mislinked history moves with the merges and should be relinked first:** Teusner Avatar and Big Jim (199), "Strawberry Habanero Sour" batch lines on the syrup (103), "Ginger Spice" bar lines on Allspice (151), "Teusner The G" lines on Chips (162), "Chartreuse Green" on Tomatillos (185), Alipus mezcal lines on San Marcos chipotle (206). The merge preserves these, but they then sit on the canonical.
- **Verdict 179's statement that "category is null on both" is wrong.** Both members are Produce. It changes nothing.

## 8. Before running anything

1. Add machine-readable fields to the decisions schema: `measureOverride`, `categoryOverride`, cost overrides, a per-sheet `sameSheetDoubleCount[]` with line ids, `onHand` conversions inside onHandPlan, and `preApplyLineFix`. Today those instructions exist only in prose, which the script cannot read.
2. Normalise the five wrapped decision files.
3. Run the merges before applying either 1 Oct sheet. Restate the §5 lines before applying AA 10/1.
4. Execute the 11 standalone discards on non-merged members ($1,528.26) as separate adjustments.

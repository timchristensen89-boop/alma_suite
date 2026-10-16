# Alma Suite stock catalogue: category and data audit

Source: local clone `alma_stock_simplify`, read-only. Run on 16 Oct 2026. Nothing was changed.

Scope: 830 ACTIVE `StockItem` rows (plus 21 ARCHIVED ones, used for context only), across 21 categories in use plus 5 empty legacy categories.

**How to read the numbers**

- "ST lines" means stocktake lines from real-venue stocktakes only ("Alma Avalon" / "St Alma"). It leaves out the phantom "Avalon" stocktake and the null-venue stocktake (see section 6).
- The "1 Oct sheet" is the two SUBMITTED stocktakes dated 2026-10-01: 825 lines at Alma Avalon, 301 at St Alma.
- "onHand" comes from `VenueStockItem` for each venue.
- Costs are in cents. A floor-named bottle item usually carries the default 750 mL measure even when the bottle is really 700 mL (see section 6).

## Headline numbers

| Finding | Count |
|---|---|
| Unambiguous category moves (section 1) | **45 items** (19 of them are agave spirits sitting in Spirits — Other) |
| Uncertain category calls (section 2) | 22 items |
| Categories that can be retired | 2 in use ("Spirits", 1 item; "Other", 3 items to 1) plus 5 empty legacy ones (Dairy, Dry Goods, Meat, Review, Wine) |
| Near-certain duplicate clusters | **188 clusters / 390 items**, so about 202 surplus items |
| Possible duplicate clusters | 44 clusters / 102 items |
| Near-certain clusters where more than one twin still holds onHand | 161 |
| onHand value parked on duplicate twins that were *not* on the 1 Oct sheet | ≈ **$16.3k at Alma Avalon and $21.5k at St Alma** (313 venue rows) |
| Clusters double-counted *in the same* 1 Oct stocktake | 7 |
| ALL-CAPS supplier-invoice names | 233 (179 of them are duplicate twins) |
| "(Case of N)" names | 64 |
| Phantom `VenueStockItem` venue "Avalon" | 830 rows, all onHand NULL, par 0 |
| Historic stocktake lines mapped to the wrong item | 284 lines on 32 items (Aug–Dec 2025), worth $27,994 |
| Active items with NULL / 0 avgCost | 56 / 8 |

### Root cause of most duplicates

The catalogue was loaded in three waves, and each wave named the same products differently:

| id prefix | Created | Rows | Naming | What hangs off it in the duplicate clusters |
|---|---|---|---|---|
| `cmoqfb…` | 2026-05-03 | 403 | Supplier-invoice style ("PATRON SILVER 700 ML BOTTLE", "(Case of 6)") | Recipe lines on 188 of 192 twins, invoice lines on 45, current counts on 33 |
| `cmptov…` / `cmptow…` | 2026-05-31 | 309 | Floor / bar-sheet style ("Patron Silver") | Current counts on 98 of 133, almost no recipes or invoices |
| `cmsdf1…` | 2026-08-03 | 135 | Floor style, from the August stocktake import | Aliases on all 65 twins, current counts on 48 |

So, for one product, recipes and invoices still point at the May invoice-named item while staff count the floor-named item. The invoice-named twin keeps a frozen onHand from its last count, often the Dec 2025 Loaded import, and that inflates stock value.

**Recommended merge direction:** keep the item that is on the 1 Oct sheet, usually the floor-named one. Then repoint `RecipeLine.itemId`, `SupplierInvoiceLine.itemId`, `stock_item_aliases` and historic `StocktakeLine.itemId` to it, set the retired twin's onHand to 0 / NULL, and archive it.

---

## 1. Unambiguous category errors (45 items)

These are moves a hospitality manager would agree with on sight. Only existing categories are used.

### 1a. Agave spirits filed under Spirits — Other: move to **Spirits — Tequila & Mezcal** (19)

| id | name | current | reason |
|---|---|---|---|
| `cmsdf10pr008fmiio3kzyqh72` | ArteNom 1414 | Spirits — Other | Reposado tequila (ArteNom 1579 is already in T&M) |
| `cmsdf10qh008rmiioa42wvk7i` | Bruxo X | Spirits — Other | Mezcal (its twin BRUXO X is already in T&M) |
| `cmsdf10qp008xmiiossa0j9qq` | Cascahuin Reposado (4x375mL) | Spirits — Other | Tequila |
| `cmsdf10qy0093miiou0t2xgs8` | Cascahuin Resposado | Spirits — Other | Tequila |
| `cmsdf10re009fmiio6jfpteha` | Del Maguey San Luis Del Rio | Spirits — Other | Mezcal |
| `cmsdf10rw009rmiioi52w7q63` | Del Maguey Wild Jabali | Spirits — Other | Mezcal |
| `cmsdf10s3009xmiio9qzu4kni` | Don Fulano Extra Anejo | Spirits — Other | Tequila |
| `cmsdf10sc00a3miio2f92xj98` | El Jimador Reposado | Spirits — Other | Tequila |
| `cmsdf10sk00a9miiot0xezhg3` | G4 Anejo | Spirits — Other | Tequila |
| `cmsdf10st00afmiio81ozy5zv` | G4 Blanco | Spirits — Other | Tequila |
| `cmsdf10t200almiio3hhg2qb1` | G4 Blanco 54% | Spirits — Other | Tequila (high-proof) |
| `cmsdf10ua00bfmiio8z9o0rzf` | Ilegal Anejo | Spirits — Other | Mezcal |
| `cmsdf10uh00blmiio7jcruybj` | Ilegal Joven | Spirits — Other | Mezcal |
| `cmsdf10ux00bxmiiosyc7g5ac` | Koch Barril | Spirits — Other | Mezcal (the other Koch expressions are in T&M) |
| `cmsdf10wb00cxmiiozjcangrn` | Nuestra Soledad Lachigui Mihuatlan | Spirits — Other | Mezcal |
| `cmsdf10wz00dfmiiofgmeq8wa` | Tromba Anejo | Spirits — Other | Tequila |
| `cmsdf10x900dlmiioc9on3c6z` | Tromba Reposado | Spirits — Other | Tequila |
| `cmsdf10xj00drmiio7if3hegd` | Volans Blanco | Spirits — Other | Tequila |
| `cmsdf10xt00dxmiiojavtjmsw` | Volans Extra Anejo | Spirits — Other | Tequila |

All 19 are from the 2026-08-03 import, which seems to have defaulted agave products to Spirits — Other.

### 1b. Beer & Cider holding non-beer (3)

| id | name | current | proposed | reason |
|---|---|---|---|---|
| `cmsdf10ac0009miiooz0labvx` | ADG 20L Cube - 20L - 40% ABV (ADG-20L) | Beer & Cider | **Spirits — Other** | 20 L cube of 40% Australian Dry Gin, so a spirit |
| `cmsdf10eo000xmiio3su1xxt1` | Rhubarb Grapefruit Paloma | Beer & Cider | **Spirits — Tequila & Mezcal** | 20 L batched tequila cocktail. The matching "Spicy Pineapple Margarita Keg 20L" already lives in T&M; see section 2 if you'd rather have both in Other |
| `cmsdf10ee000rmiiovvs8b9iq` | empty bottles (half blue/half clear) | Beer & Cider | **Other** | Packaging, not beer (or archive it, since it isn't stock) |

### 1c. Bar items in the wrong bar category (7)

| id | name | current | proposed | reason |
|---|---|---|---|---|
| `cmoqfbq7w00eu9ky2gcs0n6ja` | LYRES WHITE CANE SPIRIT 700ML BOTTLE | Spirits — Other | **Non-Alcoholic & Mixers** | Lyre's is non-alcoholic; its twin "Lyres White Cane" is already in NA |
| `cmoqfbq7100es9ky295pz087i` | LYRES TRIPLE SEC 700ML BOTTLE | Liqueurs & Aperitifs | **Non-Alcoholic & Mixers** | Non-alcoholic (Lyre's Orange Sec is already in NA) |
| `cmsdf10g1001rmiiowqgdccbj` | GIFFARD STRAWBERRY FRASIS SYRUP 6PK : 100 | Liqueurs & Aperitifs | **Non-Alcoholic & Mixers** | Syrup; every other Giffard syrup is in NA |
| `cmoqfbp8b00ck9ky299ayujyi` | GIFFARD STRAWBERRY 1000ML BOTTLE | Produce | **Non-Alcoholic & Mixers** | Bar syrup, not fruit |
| `cmoqfbpi700d69ky2f8gje5og` | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) | Oils & Condiments | **Non-Alcoholic & Mixers** | Bar agave nectar; its twin "Herradura Agave Nectar" is in NA |
| `cmoqfbtf400m49ky2a0orrz04` | Triple SEC 20L - 20% ABV | Spirits | **Liqueurs & Aperitifs** | Triple sec is a liqueur (the bulk "TSEC 20L" is already in Liqueurs). This also empties the "Spirits" category |
| `cmoqfbm58005i9ky2i8jc8sy9` | Billecart Salmon Rose | Wine — Rosé | **Wine — Sparkling** | Billecart-Salmon Brut Rosé is Champagne (Pol Roger Brut Rosé is already in Sparkling) |

### 1d. Kitchen items in the wrong category (16)

| id | name | current | proposed | reason |
|---|---|---|---|---|
| `cmoqfbmrs006y9ky2jknan3jn` | Celery Bunch | Other | **Produce** | Fresh veg |
| `cmoqfbrmm00i29ky2e6zhjbll` | PEPITAS, PUMPKIN SEED 1KG (Galaxy) EA (12) | Other | **Dry / Pantry** | Its twin "Pepita Seeds" is in Dry / Pantry |
| `cmoqfbu2s00nm9ky2obvg1wm5` | Whole dried Cascabel Chilli 1kg | Other | **Dry / Pantry** | Every other whole dried chilli is in Dry / Pantry |
| `cmoqfbn2h007m9ky23kc27jqf` | Chilli Morita | Produce | **Dry / Pantry** | Morita is a dried smoked chilli (5000¢, priced like the dried ones) |
| `cmoqfbn51007s9ky24h5tiwej` | CHIPOTLE CHILLIS A10 IN ADOBE SCE 3KG (Faro) EA (6) | Produce | **Oils & Condiments** | Canned; the other chipotle-in-adobo items are in O&C |
| `cmoqfbt6e00lk9ky2s49xhsub` | TOMATILLOS A10 GREEN TOMATO (Faro) EA (6) | Produce | **Dry / Pantry** | A10 can |
| `cmptowb6i00tas601fb42rtbn` | Tomatillos Green Can | Produce | **Dry / Pantry** | Can (twin of the line above) |
| `cmoqfbtbn00lw9ky2oy3ilcko` | TOMATO PEELED PELATI A9 2.5KG (Mutti) EA (6) | Produce | **Dry / Pantry** | Canned tomatoes. Passata and paste sit in O&C, so consolidating them is also fine; either way, not Produce |
| `cmptowatg00qvs601oasi3tiy` | Coriander Ground | Produce | **Herbs & Spices** | Ground spice |
| `cmptowbm700w1s601v69vps2z` | Thyme Dried | Dry / Pantry | **Herbs & Spices** | Dried herb (THYME LEAVES 200GM is in H&S) |
| `cmsdf12sy0010mij9lyo56458` | Garlic Powder | Dry / Pantry | **Herbs & Spices** | Its twin GARLIC POWDER 540GM is in H&S |
| `cmsdf12th001cmij97z2i2rgw` | Onion Powder | Dry / Pantry | **Herbs & Spices** | Its twin ONION POWDER 500GM is in H&S |
| `cmsdf12tr001imij9wegfg9q4` | Paprika Smoked | Dry / Pantry | **Herbs & Spices** | Its twin PAPRIKA SMOKED 500GM is in H&S |
| `cmsdf12t70016mij91xsikjsq` | Oil Olive Pomace | Dry / Pantry | **Oils & Condiments** | Every other oil is in O&C, including its twin |
| `cmsdf12vb002imij9keor7liy` | Vinegar White Wine | Dry / Pantry | **Oils & Condiments** | Every other vinegar is in O&C, including its twin |
| `cmoqfbqc900f49ky2w05b2hki` | MASECA TORTILLA YELLOW CORN  FLOUR 1kg | Bakery | **Dry / Pantry** | Masa flour (dry); White Corn Flour (MASA LISTA) is in Dry / Pantry |

### 1e. Fortified wine: flagged, not moved

| id | name | current | note |
|---|---|---|---|
| `cmsdf10ll005fmiiof3t1k6pi` | All Saints Grand Rutherglen Muscat | Wine — Red | Fortified dessert wine (375 mL). There is no Fortified category; this is the only fortified item, and there's no Port, Sherry or Tokay. Leave it in Red with a note, or move it to Liqueurs & Aperitifs. Add a "Wine — Fortified & Dessert" category only if more arrive |

### Category sizes after the 1a–1d moves

T&M 184 → **204** · Spirits — Other 63 → **44** · Liqueurs 51 → 50 · NA & Mixers 53 → **58** · Beer & Cider 19 → 16 · Rosé 8 → 7 · Sparkling 8 → 9 · Produce 110 → 104 · Dry / Pantry 63 → 64 · Herbs & Spices 27 → 32 · Oils & Condiments 38 → 40 · Bakery 8 → 7 · Other 3 → 1 · Spirits 1 → **0**. The total is unchanged at 830.

---

## 2. Uncertain / needs review (22)

| id | name | current | possible move | why it's uncertain |
|---|---|---|---|---|
| `cmoqfbspe00kg9ky2ic9tde14` | Spicy Pineapple Margarita Keg 20L | T&M | Other | Batched cocktail with no obvious home. Keep it with the Paloma (1b) wherever you decide |
| `cmptovwoy00ffs601aoc4ww3l` | Origen Raiz Sotol | T&M | Spirits — Other | Sotol isn't agave (Dasylirion), but bars usually shelve it with mezcal |
| `cmptovwdh00d9s601gfsn77wt` | La Fee Absinthe | Liqueurs | Spirits — Other | Absinthe is a high-proof spirit, but it's often filed with liqueurs |
| `cmoqfbs7900jc9ky2ubm4bauh` | Rum | Spirits — Other | (identify first) | Generic name, avgCost 40482¢. Probably a bulk/drum or mis-costed line; it has 3 recipe lines |
| `cmptovum3000as601zbxhbfyt` | Heaps Normal Another Lager | Beer & Cider | NA & Mixers | Non-alcoholic beer; Beer & Cider is defensible |
| `cmptovumn000ds601vvr3abs2` | Heaps Normal Quiet XPA | Beer & Cider | NA & Mixers | As above |
| `cmoqfbph800d49ky2azdg1s27` | HEAPS NORMAL CAN - (CASE OF 24) | Beer & Cider | NA & Mixers | As above |
| `cmsdf10lb0059miioekjf1ipn` | Angostura Bitters | NA & Mixers | Liqueurs | 44.7% ABV, but bitters usually sit with mixers; consistent with Fee Brothers |
| `cmoqfbtvr00n69ky229xlw6a5` | Water | NA & Mixers | (not stock) | 1 mL @ 1¢ placeholder used by 6 recipe lines. Make it a recipe-only / non-stock item |
| `cmoqfbnug009e9ky2xcl291f9` | Cuvée Colette Rosé 2024 (Case of 6) | Wine — Rosé | Wine — Sparkling? | If it's a Champagne rosé (avgCost 10200¢) it's sparkling. If it's La Belle Colette (1964¢) it's a still rosé and a duplicate |
| `cmoqfbsat00jk9ky2p2chx5z4` | SALT COD FILLETS 1KG + R/W (Fresh) | Dry / Pantry | Seafood | Salted fish, usually chilled |
| `cmptowb9b00tss6018qwk7nnl` | Wakame | Produce | Dry / Pantry | Dry / Pantry if it's dried seaweed (2250¢) |
| `cmoqfbly300529ky2zhbuedjg` | Bay Leaves Bunch | Herbs & Spices | Produce | A fresh bunch, and the other fresh herbs (Thyme, Dill, Basil) are in Produce |
| `cmptowaqp00qds6019uh8qktj` | Breadcrumbs Panko | Bakery | Dry / Pantry | Shelf-stable crumb |
| `cmoqfbm65005k9ky253vhxlsp` | BREADCRUMBS JAPANESE PANKO YELLOW 1KG … | Bakery | Dry / Pantry | As above |
| `cmsdf12qh0006mij918l5a1ff` | Wonton Egg Wrapper | Bakery | (pick one) | Its twin WONTON EGG WRAPPER 300GM is in Dry / Pantry; choose one category |
| `cmoqfbo2f009w9ky2g81ngh56` | Dulce de Leche 1.5L - Gelato Messina | Frozen | Desserts & Sweets | Frozen is fine if Frozen means storage |
| `cmoqfbpzd00ea9ky2qriviqse` | Lemon Oil | O&C | NA & Mixers | NA & Mixers if it's a bar essential oil |
| `cmoqfbs5i00j89ky2pdxzmlmt` | ROSE WATER 330ML | NA & Mixers | Dry / Pantry | Used in both kitchen and bar |
| `cmoqfbtza00ne9ky29w4bx3gj` | White Cooking Wine 15L - Elegre | O&C | (keep) | Correct as a cooking ingredient; flagged so nobody moves it to wine |
| `cmptovv150036s601c09m15sy` / Midnight Mixers etc. | NA mixers | NA & Mixers | (keep) | Category correct, but measures are in grams (see section 6) |
| `cmoqfbmgm00689ky2l6j9dwty` | Callebaut Chocolate White Callet 28% 2.5kg | Desserts & Sweets | Dry / Pantry | Desserts & Sweets holds only 3 items: two white chocolates and pistachio paste |

---

## 3. Category fragmentation / overlap

| Issue | Items | Recommendation |
|---|---|---|
| **"Spirits"** (legacy parent) vs "Spirits — Other" / "Spirits — Tequila & Mezcal" | 1: `cmoqfbtf400m49ky2a0orrz04` Triple SEC 20L | Move it to Liqueurs & Aperitifs (1c) and retire "Spirits" |
| **"Other"** | 3: `cmoqfbmrs006y9ky2jknan3jn` Celery Bunch, `cmoqfbrmm00i29ky2e6zhjbll` PEPITAS, `cmoqfbu2s00nm9ky2obvg1wm5` Cascabel Chilli | All three have obvious homes (1d). Afterwards "Other" holds only "empty bottles" (1b). Keep "Other" as a catch-all but review it monthly, or archive the empty-bottles item and retire "Other" |
| **Empty legacy categories** | 0 items each: Dairy `cmoqfbjjp00019ky2z3dosrik`, Dry Goods `cmoqfbjkx00029ky2vdxldx1l`, Meat `cmoqfbjm700039ky25l1qhq63`, Review `cmoqfbji000009ky2gta3nqxe`, Wine `cmoqfbjsg00089ky2b6mv3u7k` | Delete them. They're May-import leftovers, superseded by "Dairy & Eggs", "Dry / Pantry", "Meat & Poultry" and the four "Wine — …" categories |
| Dry / Pantry vs Herbs & Spices | Garlic/onion powder, smoked paprika and dried thyme are split between the two; every one has a twin in H&S | Rule: ground or dried spices and dried herbs go in **H&S**. Dried whole chillies stay in Dry / Pantry (current majority) |
| Dry / Pantry vs Oils & Condiments | Pomace oil, white wine vinegar and canned tomato products are split | Rule: oils, vinegars and sauces go in **O&C**; canned and dry goods go in **Dry / Pantry** |
| NA & Mixers vs Oils & Condiments | Two agave nectars (Herradura = bar, organic 4 L = kitchen) | Bar-bought goes in NA & Mixers; kitchen-bought goes in O&C. This is fine once the Herradura case moves |
| Produce vs canned goods | A10/A9 cans in Produce | Fix via 1d |
| Desserts & Sweets (3 items) | 2 white chocolates (duplicates of each other) and pistachio paste | Small but legitimate; keep it, or fold it into Dry / Pantry |
| Spirits — Tequila & Mezcal (204 after moves) | About 75 surplus duplicates inside it | Fine as one category; the size problem is duplication, not taxonomy |

No new categories are needed. The only unavoidable gap is a fortified/dessert wine slot, and it holds just 1 item.

---

## 4. Likely duplicate items

**Classification**

- **Near-certain:** same product, packaging and size, differing only in naming style or a size/pack suffix. 188 clusters, 390 items.
- **Possible:** same product but a different pack/size/brand, or a name that can't be resolved without the shelf. 44 clusters, 102 items.

**Exclusions**

- Different vintages are never merged. For example, 2022 and 2023 Teusner Wark Family stay separate, and so do Rockford Basket Press 2004/2017/2018. An undated floor item is flagged as duplicating *one* vintage only.
- Different expressions are kept apart: Bruxo No. 2 vs No. 4 vs X; G4 Blanco vs G4 Blanco 54%; Arette Reposado vs Los Primos Edition; Manly Triple Sec vs No Sugar; Greywacke 750 vs 375 mL; Rockford vintages.
- Different pack sizes of a kitchen good are not merged. Examples: Butter 500 g vs 1 kg, Flour 1 kg vs 12.5 kg, Mayonnaise 10 vs 15 kg.

**Double counting**

- Only **7 clusters** were counted twice in the same 1 Oct stocktake:
  - Giffard Strawberry Syrup (AA)
  - Lime Juice 5 L (StA)
  - i Lauri Pecorino (AA)
  - Garlic powder, Onion powder, Smoked paprika, Black peppercorns whole (all AA)
- The bigger exposure is **stale onHand on the uncounted twin**: about $37.8k across both venues. The largest are:
  - HERRADURA AGAVE NECTAR case: 15 @ AA, $2,023
  - SAMMY PIQUANT 700ML: 10.7 @ AA, $1,923
  - BEEF SHORT RIBS 3 RIB: 24.6 kg @ StA, $1,274
  - LYRES AGAVE BLANCO 700ML: 6 @ StA, $1,267
  - LYRES WHITE CANE SPIRIT 700ML: AA $1,227 and StA $894
  - 2023 Bonnet & Cotton (Case of 12): 28 @ StA, $980

**Key:** "on 1 Oct sheet" shows the venues where the item appears with a non-null count in the 2026-10-01 SUBMITTED stocktake. The member with a ✓ is the natural survivor.

### 4a. Near-certain duplicates (188 clusters)

**Tequila & mezcal**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Aguas Mansas**<br>_Aguas Mansas is an espadin; all four are the same mezcal (one is the case-of-6 invoice item)_ | `cmptovvht006cs601a21zsvns` | Aguas Mansas | T&M | bottle | 6505 | 7 | 2.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.95 | 4.1 |
|  | `cmoqfble0003s9ky2wvf7mtfg` | AGUAS MANSAS 700ML - (CASE OF 6) | T&M | bottle | 6500 | 5 | 5.5 (StA 2025-12-31) |  | 0 | 7 | – | 6.1 |
|  | `cmoqfblev003u9ky20w4npfe3` | AGUAS MANSAS 700ML BOTTLE | T&M | bottle | 6500 | 5 | 3.9 (AA 2025-12-31) |  | 0 | 6 | 4.4 | – |
|  | `cmsdf10pi0089miio9x0ayy86` | Aguas Mansas Espadin | T&M | bottle | 6502 | 2 | 6.65 (StA 2026-08-03) |  | 0 | 0 | – | 6.65 |
| **Aprendiz** | `cmoqfblmp004c9ky2qynqiqjd` | APRENDIZ 750ML BOTTLE | T&M | bottle | 13299 | 12 | 0.9 (AA 2026-09-01) |  | 0 | 2 | 0.9 | 0.8 |
|  | `cmptovvjf006os601q8ojgcux` | Aprendiz Ensamble Mezcal | T&M | bottle | 13300 | 9 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.8 |
| **Arette Blanco** | `cmptovvjw006rs601t26qd4hd` | Arette Blanco | T&M | bottle | – | 8 | 0.8 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0 | 0 |
|  | `cmoqfblnk004e9ky2z0zsja3e` | ARETTE BLANCO 700ML BOTTLE | T&M | bottle | 6772 | 8 | 0.2 (StA 2025-12-31) |  | 0 | 2 | 0.95 | 0.2 |
| **Arette Reposado**<br>_Los Primos Edition (ptovvkm006x) is a separate product_ | `cmptovvk8006us601ou84ww95` | Arette Reposado | T&M | bottle | 7993 | 9 | 0.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.4 | 0.1 |
|  | `cmoqfblog004g9ky2u9bwo86q` | ARETTE REPOSADO 700ML BOTTLE | T&M | bottle | 7994 | 16 | 0.4 (AA 2026-09-01) |  | 0 | 4 | 0.4 | 0.8 |
| **Arette Suave Blanco** | `cmptovvkz0070s601192af70l` | Arette Suave Blanco | T&M | bottle | 12106 | 10 | 0.7 (StA 2026-10-01) | ✓ StA | 0 | 0 | 0.8 | 0.6 |
|  | `cmoqfblpc004i9ky2slcm5tns` | ARETTE SUAVE BLANCO 750ML BOTTLE | T&M | bottle | 12106 | 12 | 0.9 (StA 2025-12-31) |  | 0 | 3 | 0.8 | 0.8 |
| **Bruxo X**<br>_Bruxo X pair (one in Spirits — Other)_ | `cmsdf10qh008rmiioa42wvk7i` | Bruxo X | SpO | bottle | 7700 | 6 | 0.8 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.85 |
|  | `cmoqfbmak005u9ky2jaoabsdi` | BRUXO X 750ML BOTTLE | T&M | bottle | 7700 | 6 | 0.8 (StA 2025-12-31) |  | 0 | 1 | – | 0.9 |
| **Calle 23 Blanco** | `cmptovvop007rs601jheanhrc` | Calle 23 Blanco | T&M | bottle | 7720 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.6 | 1 |
|  | `cmoqfbmex00649ky2a8dwjdzn` | CALLE 23 BLANCO 750ML BOTTLE | T&M | bottle | 7724 | 16 | 1 (StA 2025-12-31) |  | 0 | 2 | 0.5 | 1 |
| **Calle 23 Reposado** | `cmptovvp6007us601klxpkgxq` | Calle 23 Reposado | T&M | bottle | 8880 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 1 |
|  | `cmoqfbmfs00669ky2267j01he` | CALLE 23 REPOSADO 700ML BOTTLE | T&M | bottle | 8883 | 11 | 0.9 (StA 2025-12-31) |  | 0 | 2 | 0.7 | 0.95 |
| **Codigo 1530 Rosa** | `cmptovvrn008fs6016lmcda3e` | Codigo 1530 Rosa | T&M | bottle | 10829 | 10 | 0.2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.25 |
|  | `cmoqfbnfc008g9ky2r9ziwzn4` | CODIGO 1530 BLANCO ROSA 750ML BOTTLE | T&M | bottle | 10830 | 11 | 0.6 (StA 2025-12-31) |  | 0 | 3 | 0.95 | 0.9 |
| **Del Maguey Vida** | `cmptovvt7008rs601e8b0092x` | Del Maguey Vida | T&M | bottle | 9060 | 5 | 0.5 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.5 | 0.4 |
|  | `cmoqfbnvb009g9ky26vs8a7vd` | DEL MAGUEY VIDA 750ML BOTTLE | T&M | bottle | 9061 | 11 | 0.2 (AA 2025-12-31) |  | 0 | 1 | 0.3 | – |
| **Don Julio 1942** | `cmptovvui0090s601bvpnwb8z` | Don Julio 1942 | T&M | bottle | 24247 | 10 | 0.7 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1 | 0.75 |
|  | `cmoqfbnyv009o9ky2yxfcha96` | DON JULIO 1942 750ML BOTTLE | T&M | bottle | 24247 | 9 | 0.9 (StA 2025-12-31) |  | 0 | 2 | 1 | 0.9 |
| **Don Julio Anejo** | `cmptovvuu0093s601ojyqx51d` | Don Julio Anejo | T&M | bottle | 13032 | 10 | 0.9 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.9 |
|  | `cmoqfbnzr009q9ky25nbry076` | DON JULIO ANEJO 750ML BOTTLE | T&M | bottle | 13012 | 17 | 0.9 (StA 2025-12-31) |  | 0 | 4 | 0.35 | 0.9 |
| **Don Julio Blanco**<br>_invoice item avgCost 50010c is a case cost_ | `cmptovvv70096s601mzhseahb` | Don Julio Blanco | T&M | bottle | 8340 | 10 | 0.7 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.7 |
|  | `cmoqfbo0n009s9ky23tatpkjn` | DON JULIO BLANCO 750ML BOTTLE | T&M | bottle | 50010 | 16 | 1.1 (StA 2025-12-31) |  | 0 | 2 | 0.2 | 0.05 |
| **Don Julio Reposado** | `cmptovvvo0099s6017b3y9unw` | Don Julio Reposado | T&M | bottle | 10567 | 10 | 0.7 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.4 | 0.7 |
|  | `cmoqfbo1i009u9ky2co0lnou4` | DON JULIO REPOSADO 750ML BOTTLE | T&M | bottle | 10567 | 11 | 0.75 (StA 2025-12-31) |  | 0 | 2 | 0.5 | 0.7 |
| **El Jimador Reposado**<br>_floor item sits in Spirits — Other_ | `cmsdf10sc00a3miio2f92xj98` | El Jimador Reposado | SpO | bottle | – | 3 | 0 (StA 2026-08-03) |  | 0 | 0 | – | 0 |
|  | `cmoqfbo6s00a69ky2ec9oo7we` | EL JIMADOR REPOSADO 700ML - (CASE OF 6) | T&M | bottle | 5304 | 23 | 0 (AA 2026-09-01) |  | 0 | 2 | 0 | – |
|  | `cmoqfbo7n00a89ky2wndy34ao` | EL JIMADOR REPOSADO 700ML BOTTLE | T&M | bottle | 5304 | 26 | 0 (AA 2026-10-01) | ✓ AA | 0 | 1 | 0 | 3.3 |
| **El Jolgorio Espadin** | `cmptovvwn009is601t5uie803` | El Jolgorio Espadin (Green) | T&M | bottle | 16107 | 8 | 0.8 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.85 | 0 |
|  | `cmoqfbo8i00aa9ky24jvzky7q` | EL JOLGORIO ESPADIN (GREEN) 750ML BOTTLE | T&M | bottle | 16106 | 43 | 0.4 (StA 2025-12-31) |  | 0 | 3 | 0.85 | 0.05 |
| **El Jolgorio Mexicano** | `cmptovvxo009rs601zcqi9eax` | El Jolgorio Mexicano (Brown) | T&M | bottle | 20693 | 10 | 1.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 1.4 |
|  | `cmoqfbo9g00ac9ky26vzlars6` | EL JOLGORIO MEXICANO (BROWN) 750ML BOTTLE | T&M | bottle | 20693 | 36 | 0.75 (StA 2025-12-31) |  | 0 | 3 | 0.9 | 1.25 |
| **El Jolgorio Pechuga (Yellow)** | `cmptovvyb009xs6016axnnhxj` | El Jolgorio Pechuga (Yellow) | T&M | bottle | 29551 | 10 | 0.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.7 | 0.2 |
|  | `cmoqfboac00ae9ky2ef7te2im` | EL JOLGORIO PECHUGA (YELLOW) 750ML BOTTLE | T&M | bottle | 29550 | 21 | 0.25 (StA 2025-12-31) |  | 0 | 2 | 0.65 | 0.2 |
| **El Jolgorio Tepeztate** | `cmptovvz000a3s6015h89q0uw` | El Jolgorio Tepeztate (Blue) | T&M | bottle | 27520 | 10 | 0.2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.5 | 0.2 |
|  | `cmoqfboba00ag9ky2dn9e3v63` | EL JOLGORIO TEPEZTATE (BLUE) 750ML BOTTLE | T&M | bottle | 27518 | 26 | 0.25 (StA 2025-12-31) |  | 0 | 2 | 0.5 | 0.3 |
| **El Jolgorio Tobasiche** | `cmptovvzc00a6s601wlaxdpc5` | El Jolgorio Tobasiche (Black Brown) | T&M | bottle | 27328 | 9 | 0.9 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.88 | 0 |
|  | `cmoqfboc500ai9ky2bb9zv8j6` | EL JOLGORIO TOBASICHE (BLACK BROWN) 750ML BOTTLE | T&M | bottle | 27328 | 31 | 0.9 (StA 2025-12-31) |  | 0 | 2 | 0.7 | 0.6 |
| **El Tequileno 1959 Anejo** | `cmptovw0c00afs601ofscu5mh` | El Tequileno 1959 Anejo | T&M | bottle | 12766 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.85 | 0.8 |
|  | `cmoqfbod100ak9ky2um90p39d` | EL TEQUILENO 1959 ANEJO 750ML BOTTLE | T&M | bottle | 12766 | 20 | 0.85 (StA 2025-12-31) |  | 0 | 2 | 0.9 | 0.9 |
| **El Tequileno 1959 Platinum** | `cmptovw0p00ais6014t4uy6no` | El Tequileno 1959 Platinum | T&M | bottle | 8688 | 10 | 0.9 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.9 |
|  | `cmoqfbodw00am9ky29nhf378y` | EL TEQUILENO 1959 PLATINUM 750ML BOTTLE | T&M | bottle | 8688 | 10 | 0.9 (StA 2025-12-31) |  | 0 | 2 | 0.9 | 0.8 |
| **El Tequileno 1959 Reposado Rare** | `cmptovw1i00aos601ptttqxvx` | El Tequileno 1959 Reposado Rare | T&M | bottle | 25888 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.8 |
|  | `cmoqfboes00ao9ky27grn21c4` | EL TEQUILENO 1959 REPOSADO RARE 750ML BOTTLE | T&M | bottle | 25887 | 12 | 0.8 (StA 2025-12-31) |  | 0 | 5 | 0.95 | 0.7 |
| **El Tequileno 1959 Reposado Gran Reserva** | `cmptovw1200als601i7hrddqo` | El Tequileno 1959 Reposado Gran Reserva | T&M | bottle | 9000 | 10 | 0.9 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.9 |
|  | `cmoqfbofo00aq9ky2qhanmuam` | EL TEQUILENO 1959 RESERVA REPOSADO 750ML BOTTLE | T&M | bottle | 8989 | 11 | 0.8 (StA 2025-12-31) |  | 0 | 7 | 0.9 | 0.2 |
| **El Tequileno Blanco** | `cmptovw1w00ars601aagggwkw` | El Tequileno Blanco | T&M | bottle | 4900 | 10 | 4.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 3.6 | 0.7 |
|  | `cmoqfbogk00as9ky26ir0xs4m` | EL TEQUILENO BLANCO 750ML - (CASE OF 12) | T&M | bottle | 4900 | 25 | 0.65 (StA 2025-12-31) |  | 0 | 11 | – | 10.95 |
|  | `cmoqfbohe00au9ky2b5jv59fq` | EL TEQUILENO BLANCO 750ML BOTTLE | T&M | bottle | 4900 | 37 | 0.7 (AA 2025-12-31) |  | 0 | 11 | 10.5 | – |
| **Fortaleza Blanco**<br>_invoice item avgCost 15c is wrong_ | `cmptovw4m00bcs6011ec7d7l9` | Fortaleza Blanco | T&M | bottle | 11200 | 10 | 0.2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.5 | 0.25 |
|  | `cmoqfbory00bi9ky29bqkgj74` | FORTALEZA BLANCO 750ML BOTTLE | T&M | bottle | 15 | 16 | 0.4 (StA 2025-12-31) |  | 0 | 7 | 0.6 | 7 |
| **Fortaleza Reposado** | `cmptovw4z00bfs601hm4l4ksx` | Fortaleza Reposado | T&M | bottle | 12745 | 10 | 0.2 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.25 | 0 |
|  | `cmoqfboss00bk9ky24y28tfq0` | FORTALEZA REPOSADO 750ML BOTTLE | T&M | bottle | 12745 | 11 | 1 (StA 2025-12-31) |  | 0 | 1 | 0.6 | 0.25 |
| **G4 Anejo**<br>_G4 Blanco 54% (sdf10t200al) is a different product_ | `cmsdf10sk00a9miiot0xezhg3` | G4 Anejo | SpO | bottle | 17280 | 5 | 0.9 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.9 |
|  | `cmoqfbovf00bq9ky29jv0c2ib` | G4 ANEJO 750ML BOTTLE | T&M | bottle | 17280 | 11 | 0.9 (StA 2025-12-31) |  | 0 | 4 | 0.2 | 0.95 |
|  | `cmptovw5q00bls601l3m2stkj` | G4 Añejo Tequila | T&M | bottle | – | 6 | 0 (AA 2026-09-01) |  | 0 | 0 | 0 | 0.9 |
| **G4 Blanco** | `cmsdf10st00afmiio81ozy5zv` | G4 Blanco | SpO | bottle | 9548 | 6 | 0.1 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.2 |
|  | `cmoqfbow900bs9ky2dg7w0bp7` | G4 BLANCO 750ML BOTTLE | T&M | bottle | 9550 | 16 | 0.8 (StA 2025-12-31) |  | 0 | 4 | 0.1 | 0.95 |
|  | `cmptovw6400bos601bkmekizq` | G4 Blanco Tequila | T&M | bottle | 9550 | 6 | 0.05 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.05 | 0.2 |
| **G4 Reposado** | `cmptovw6h00brs6012r5a0wd6` | G4 Reposado | T&M | bottle | 10883 | 10 | 0.3 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.05 | 0.3 |
|  | `cmoqfbox400bu9ky22jfzdog5` | G4 REPOSADO 750ML BOTTLE | T&M | bottle | 10883 | 11 | 0.4 (StA 2025-12-31) |  | 0 | 3 | 0.6 | 0.4 |
| **Gracias a Dios Espadin** | `cmsdf10tj00axmiionu4t5qzw` | Gracias a Dios Espadin | T&M | bottle | 8748 | 5 | 0.5 (StA 2026-10-01) | ✓ StA | 0 | 0 | 0 | 0.5 |
|  | `cmoqfbpbw00cs9ky26n6inyhn` | GRACIAS A DIOS ESPADIN 700ML BOTTLE | T&M | bottle | 8748 | 11 | 0.75 (StA 2025-12-31) |  | 0 | 1 | – | 0.6 |
| **Gran Centenario Anejo** | `cmptovw7e00bxs601cduq6u8z` | Gran Centenario Anejo | T&M | bottle | 8275 | 10 | 0.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.1 | 0.4 |
|  | `cmoqfbpct00cu9ky2yvtn8pem` | GRAN CENTENARIO ANEJO 700ML BOTTLE | T&M | bottle | 8276 | 17 | 0.75 (StA 2025-12-31) |  | 0 | 1 | 0.15 | 0.8 |
| **Herradura Anejo** | `cmptovw8k00c6s601hsjnsmzn` | Herradura Anejo | T&M | bottle | 9172 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.7 |
|  | `cmoqfbpk100da9ky2zirjrtyv` | HERRADURA ANEJO 700ML BOTTLE | T&M | bottle | 9173 | 10 | 0.7 (StA 2025-12-31) |  | 0 | 3 | 0.9 | 0.75 |
| **Herradura Plata** | `cmptovw8w00c9s601m96wrpig` | Herradura Plata | T&M | bottle | 7282 | 10 | 2.9 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 3.5 | 2.95 |
|  | `cmoqfbpkx00dc9ky28s34qym7` | HERRADURA PLATA 700ML BOTTLE | T&M | bottle | 7282 | 15 | 3 (StA 2025-12-31) |  | 0 | 5 | 3.3 | 3.2 |
| **Herradura Reposado** | `cmptovw9900ccs601gj7x3q5x` | Herradura Reposado | T&M | bottle | 8433 | 10 | 2.5 (AA 2026-10-01) | ✓ AA | 0 | 0 | 2.5 | 0 |
|  | `cmoqfbplt00de9ky2fplyh97z` | HERRADURA REPOSADO 700ML BOTTLE | T&M | bottle | 8433 | 10 | 0.1 (StA 2025-12-31) |  | 0 | 3 | 3.95 | 0.1 |
| **Herradura Seleccion Suprema** | `cmptovw9m00cfs601l33gptp6` | Herradura Seleccion Suprema Extra Anejo | T&M | bottle | 49624 | 10 | 0.85 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.6 | 0.85 |
|  | `cmoqfbpmn00dg9ky26x2fue4q` | HERRADURA SELECCION SUPREMA 750ML BOTTLE | T&M | bottle | 49624 | 20 | 0.9 (StA 2025-12-31) |  | 0 | 5 | 0.8 | 0.95 |
| **Herradura Ultra** | `cmptovw9x00cis601oa628jny` | Herradura Ultra | T&M | bottle | 14180 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.7 |
|  | `cmoqfbpnh00di9ky2fq25vwwl` | HERRADURA ULTRA 700ML BOTTLE | T&M | bottle | 11847 | 10 | 0.45 (StA 2025-12-31) |  | 0 | 2 | 0.85 | 0.7 |
| **Ilegal Anejo** | `cmsdf10ua00bfmiio8z9o0rzf` | Ilegal Anejo | SpO | bottle | 14906 | 5 | 0.7 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.7 |
|  | `cmoqfbpqw00dq9ky2rtighdzv` | ILEGAL ANEJO 750ML BOTTLE | T&M | bottle | 14906 | 6 | 0.2 (StA 2025-12-31) |  | 0 | 1 | – | 0.35 |
| **Ilegal Joven** | `cmsdf10uh00blmiio7jcruybj` | Ilegal Joven | SpO | bottle | 9578 | 5 | 0.5 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.5 |
|  | `cmoqfbprp00ds9ky2ou14ul8t` | ILEGAL JOVEN 700ML BOTTLE | T&M | bottle | 9578 | 6 | 0.75 (StA 2025-12-31) |  | 0 | 2 | – | 0.8 |
| **Ilegal Reposado** | `cmptovwa800cls60125pick3j` | Ilegal Reposado | T&M | bottle | 11586 | 10 | 1.7 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1 | 1.6 |
|  | `cmoqfbpsj00du9ky2kuexxbon` | ILEGAL REPOSADO 700ML BOTTLE | T&M | bottle | 11586 | 10 | 1.9 (StA 2025-12-31) |  | 0 | 5 | 1.3 | 1.95 |
| **Lagrimas de Dolores** | `cmptovwdt00dcs601w04plil2` | Lagrimas de Delores | T&M | bottle | 10880 | 10 | 0.9 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.9 |
|  | `cmoqfbpxo00e69ky2wvhupjxx` | LAGRIMAS DE DOLORES JOVEN 700ML BOTTLE | T&M | bottle | 10883 | 11 | 0.95 (StA 2025-12-31) |  | 0 | 2 | 0.95 | 0.95 |
| **Los Siete Misterios Doba-Yej** | `cmptovwe900dfs601n8qi99wn` | Los Siete Misterios Doba-Yej | T&M | bottle | 8280 | 10 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.4 | 0.5 |
|  | `cmoqfbsnm00kc9ky2jbruf7um` | SIETE MISTERIOS DOBA YEJ 700ML BOTTLE | T&M | bottle | 8281 | 11 | 0.6 (StA 2025-12-31) |  | 0 | 3 | 0.7 | 0.6 |
| **Madre Mezcal Ensamble** | `cmsdf10v600c3miioyyfbktmm` | Madre Mezcal Ensamble | T&M | bottle | 8986 | 5 | 0.4 (StA 2026-10-01) | ✓ StA | 0 | 0 | 0 | 0.5 |
|  | `cmoqfbq8r00ew9ky2o9g3194v` | MADRE MEZCAL ENSAMBLE 750ML BOTTLE | T&M | bottle | 8986 | 6 | 0.65 (StA 2025-12-31) |  | 0 | 1 | – | 0.6 |
| **Madre Mezcal Espadin** | `cmsdf10ve00c9miioe6tjyhbp` | Madre Mezcal Espadin | T&M | bottle | – | 5 | 0 (AA 2026-09-01) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbq9k00ey9ky2unh96abz` | MADRE MEZCAL ESPADIN 750ML BOTTLE | T&M | bottle | 8394 | 26 | 0.3 (StA 2025-12-31) |  | 0 | 2 | – | 0.2 |
| **Mezcal Verde Momento** | `cmptovwi300e6s6012ryyx12w` | Mezcal Verde | T&M | bottle | 7660 | 10 | 1.7 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.7 | 1.7 |
|  | `cmoqfbqhg00fg9ky23y8bv1fv` | MEZCAL VERDE MOMENTO 700ML BOTTLE | T&M | bottle | 7636 | 19 | 1.8 (StA 2025-12-31) |  | 0 | 2 | 0.3 | 1.85 |
| **Milagro Silver** | `cmptovwik00e9s6014qj6gcen` | Milagro Silver | T&M | bottle | 6515 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 1 |
|  | `cmoqfbqia00fi9ky2xqhikf6t` | MILAGRO SILVER 700ML BOTTLE | T&M | bottle | 6515 | 6 | 0.95 (AA 2025-12-31) |  | 0 | 1 | 0.95 | – |
| **Nuestra Soledad La Campania Ejutla** | `cmptovwkb00efs6013kfp5f1l` | Nuestra Soledad La Campania Ejutla | T&M | bottle | 8880 | 10 | 1.15 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.6 | 1.2 |
|  | `cmoqfbqq500g09ky2bdvyakhn` | NUESTRA SOLEDAD LA CAMPANIA EJUTLA 700ML BOTTLE | T&M | bottle | 8883 | 10 | 1.2 (StA 2025-12-31) |  | 0 | 4 | 0.65 | 1.2 |
| **Nuestra Soledad Lachigui**<br>_floor item sits in Spirits — Other_ | `cmsdf10wb00cxmiiozjcangrn` | Nuestra Soledad Lachigui Mihuatlan | SpO | bottle | 9773 | 5 | 0.7 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.67 |
|  | `cmoqfbqr100g29ky2hhbu3lnm` | NUESTRA SOLEDAD LACHIGUI 700ML BOTTLE | T&M | bottle | 9772 | 5 | 0.75 (StA 2025-12-31) |  | 0 | 2 | – | 0.8 |
| **Nuestra Soledad San Baltazar** | `cmptovwks00eis601onudogzm` | Nuestra Soledad San Baltazar | T&M | bottle | 8550 | 10 | 1.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 1.8 |
|  | `cmoqfbqrx00g49ky2i87w7lax` | NUESTRA SOLEDAD SAN BALTAZAR 700ML BOTTLE | T&M | bottle | 8883 | 15 | 2 (StA 2025-12-31) |  | 0 | 3 | 0.5 | 2 |
| **Nuestra Soledad San Luis del Rio** | `cmptovwl800els6012s8qu4op` | Nuestra Soledad San Luis del Rio | T&M | bottle | 8880 | 10 | 1.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.5 | 1.6 |
|  | `cmoqfbqss00g69ky2hi3d3bfo` | NUESTRA SOLEDAD SAN LUIS DEL RIO 700ML BOTTLE | T&M | bottle | 8883 | 25 | 0.2 (StA 2025-12-31) |  | 0 | 3 | 0.75 | 0.8 |
| **Nuestra Soledad Santiago Matatlan** | `cmptovwlo00eos60132mym7tt` | Nuestra Soledad Santiago Matatlan | T&M | bottle | 8883 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.3 | 0.95 |
|  | `cmoqfbqtp00g89ky2tyw4fc43` | NUESTRA SOLEDAD SANTIAGO MATATLAN 750ML BOTTLE | T&M | bottle | 8550 | 10 | 1 (StA 2025-12-31) |  | 0 | 4 | 0.3 | 1 |
| **Ocho Plata** | `cmptovwmq00exs601dt0q6fsv` | Ocho Plata | T&M | bottle | 9730 | 10 | 0.01 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.1 |
|  | `cmoqfbqy400gi9ky291amz8q3` | OCHO PLATA 700ML BOTTLE | T&M | bottle | 9732 | 16 | 0.1 (StA 2025-12-31) |  | 0 | 3 | 0.1 | 0.6 |
| **Ocho Reposado** | `cmptovwn200f0s6010x46ew77` | Ocho Reposado | T&M | bottle | 10430 | 10 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.1 | 0 |
|  | `cmoqfbqz000gk9ky25i26hcwv` | OCHO REPOSADO 700ML BOTTLE | T&M | bottle | 10428 | 8 | 0.1 (AA 2025-12-31) |  | 0 | 2 | 0.1 | 0.6 |
| **Pasote Blanco** | `cmptovwpd00fis601ilg3xx2a` | Pasote Blanco | T&M | bottle | 12439 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1 | 0.8 |
|  | `cmoqfbrdv00hi9ky22dhwwlrp` | PASOTE BLANCO 750ML BOTTLE | T&M | bottle | 12439 | 10 | 0.85 (StA 2025-12-31) |  | 0 | 3 | 1 | 0.9 |
| **Patron Anejo** | `cmptovwpp00fls601ijo8easd` | Patron Anejo | T&M | bottle | 9070 | 10 | 0.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.2 | 0.1 |
|  | `cmoqfbreq00hk9ky2aod5ii8q` | PATRON ANEJO 700ML BOTTLE | T&M | bottle | 9071 | 10 | 0.4 (StA 2025-12-31) |  | 0 | 4 | 0.35 | 0.4 |
| **Patron El Cielo** | `cmptovwq100fos601xpt5f1gw` | Patron El Cielo | T&M | bottle | 14319 | 10 | 0.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 0.3 |
|  | `cmoqfbrfm00hm9ky2ggy5xaaw` | PATRON EL CIELO 700ML BOTTLE | T&M | bottle | 14319 | 10 | 0.8 (StA 2025-12-31) |  | 0 | 3 | 0.8 | 0.8 |
| **Patron Reposado** | `cmptovwqc00frs601o94orylr` | Patron Reposado | T&M | bottle | 7442 | 10 | 0.3 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.4 |
|  | `cmoqfbrgk00ho9ky2rm48baau` | PATRON REPOSADO 700ML BOTTLE | T&M | bottle | 7441 | 10 | 0.7 (StA 2025-12-31) |  | 0 | 2 | 0.7 | 0.6 |
| **Patron Silver** | `cmptovwqn00fus601284l8wjj` | Patron Silver | T&M | bottle | 6780 | 10 | 0.15 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.1 | 0.2 |
|  | `cmoqfbrhf00hq9ky2zwzhccoy` | PATRON SILVER 700 ML BOTTLE | T&M | bottle | 6787 | 15 | 0.7 (StA 2025-12-31) |  | 0 | 2 | 0.4 | 1 |
| **Quiquiriqui** | `cmptovwrj00g0s601r8y310lg` | Quiquiriqui | T&M | bottle | 7856 | 7 | 0.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.75 | 0.2 |
|  | `cmoqfbry900is9ky24ir5h90c` | QUIQUIRIQUI 700ML BOTTLE | T&M | bottle | 7859 | 4 | 0.75 (AA 2025-12-31) |  | 0 | 1 | 0.7 | – |
|  | `cmsdf10ws00d9miioetyx9h42` | Quiquiriqui Mezcal | T&M | bottle | 7860 | 2 | 0.75 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 0.1 |
| **San Cosme Mezcal** | `cmptovwt500gcs601czvc6lxc` | San Cosme Mezcal | T&M | bottle | 7880 | 10 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.45 |
|  | `cmoqfbsek00js9ky21sror8nz` | SAN COSME MEZCAL 700ML BOTTLE | T&M | bottle | 7872 | 11 | 0.4 (StA 2025-12-31) |  | 0 | 2 | 0.85 | 0.5 |
| **Siete Leguas Blanco** | `cmptovwtk00gfs601o2i4xi55` | Siete Leguas Blanco | T&M | bottle | 11328 | 9 | 0.8 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.8 | 0 |
|  | `cmoqfbsmr00ka9ky25kgibm0p` | SIETE LEGUAS BLANCO 700ML BOTTLE | T&M | bottle | 11328 | 6 | 0.75 (AA 2025-12-31) |  | 0 | 2 | 0.9 | – |
| **Tapatio Blanco** | `cmptovwtx00gis601c1p518qq` | Tapatio Blanco | T&M | bottle | 9637 | 10 | 0.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.75 | 0.4 |
|  | `cmoqfbszi00l49ky20186fdvv` | TAPATIO BLANCO 750ML BOTTLE | T&M | bottle | 9637 | 11 | 0.85 (StA 2025-12-31) |  | 0 | 2 | 1 | 0.4 |
| **Terralta Blanco** | `cmptovwuo00gos6011tygee78` | Terralta Blanco | T&M | bottle | 9438 | 10 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.95 | 0.5 |
|  | `cmoqfbt0d00l69ky2khlkq5fv` | TERRALTA BLANCO 750ML BOTTLE | T&M | bottle | 9439 | 11 | 0.5 (StA 2025-12-31) |  | 0 | 3 | 1 | 0.5 |
| **Tromba Anejo** | `cmsdf10wz00dfmiiofgmeq8wa` | Tromba Anejo | SpO | bottle | – | 3 | 0 (StA 2026-08-03) |  | 0 | 0 | – | 0 |
|  | `cmoqfbtgt00m89ky2v7pzcdrq` | TROMBA ANEJO 750ML BOTTLE | T&M | bottle | 10025 | 7 | 0.05 (StA 2025-12-31) |  | 0 | 1 | – | 0.05 |
| **Tromba Reposado** | `cmsdf10x900dlmiioc9on3c6z` | Tromba Reposado | SpO | bottle | – | 3 | 0 (StA 2026-08-03) |  | 0 | 0 | – | 0 |
|  | `cmoqfbthn00ma9ky23ppjp85o` | TROMBA REPOSADO 750ML BOTTLE | T&M | bottle | 8447 | 2 | – |  | 0 | 1 | – | – |
| **Volans Blanco** | `cmsdf10xj00drmiio7if3hegd` | Volans Blanco | SpO | bottle | 10000 | 5 | 0.3 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.3 |
|  | `cmoqfbttz00n29ky2gb1j8bmm` | VOLANS BLANCO 750ML BOTTLE | T&M | bottle | 9999 | 7 | 0.35 (StA 2025-12-31) |  | 0 | 1 | – | 0.35 |
| **Volans Extra Anejo** | `cmsdf10xt00dxmiiojavtjmsw` | Volans Extra Anejo | SpO | bottle | 19299 | 5 | 1.3 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 1.1 |
|  | `cmoqfbtuu00n49ky2fio5gbff` | VOLANS EXTRA ANEJO 750ML BOTTLE | T&M | bottle | 19299 | 7 | 1.3 (StA 2025-12-31) |  | 0 | 3 | – | 1.25 |

**Other spirits**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Abasolo** | `cmoqfblbf003m9ky2ayhlu6vs` | ABASOLO 750ML BOTTLE | SpO | bottle | 11592 | 8 | 0.25 (StA 2026-08-31) |  | 0 | 1 | – | 0.25 |
|  | `cmsdf10p90083miioq1ahrouf` | Abasolo Whiskey | SpO | bottle | 11592 | 4 | 0.2 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.25 |
| **Ballantine's**<br>_invoice item is 1 L; check bottle size_ | `cmoqfbltn004s9ky24hn6hffc` | BALLANTINE'S SCOTCH 1000ML BOTTLE | SpO | bottle | 6701 | 11 | 1.4 (StA 2025-12-31) |  | 0 | 2 | 0.55 | 1.75 |
|  | `cmptovvln0076s601e9458auh` | Ballantines Scotch | SpO | bottle | 6701 | 8 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1 | 1.1 |
| **Barsol Pisco** | `cmptovvlz0079s601ova9xztj` | Barsol Pisco | SpO | bottle | 7020 | 10 | 0.2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.7 | 0.25 |
|  | `cmoqfblwb004y9ky2qjtc555d` | BARSOL PISCO 700ML BOTTLE | SpO | bottle | 7029 | 11 | 0.45 (StA 2025-12-31) |  | 0 | 2 | 1.1 | 0.5 |
| **Belvedere** | `cmoqfbm3g005e9ky26hl02zpe` | BELVEDERE PURE VODKA : 700 ml | SpO | bottle | 6196 | 11 | 0.3 (StA 2025-12-31) |  | 0 | 2 | 1.9 | 0.8 |
|  | `cmptovvne007is6011o39orz5` | Belvedere Vodka | SpO | bottle | 6196 | 10 | 0.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.4 | 0.2 |
| **Four Pillars Rare Dry Gin** | `cmptovw5e00bis601f8hofoqm` | Four Pillars Rare Dry Gin | SpO | bottle | 6333 | 10 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.25 | 0.6 |
|  | `cmoqfbotm00bm9ky2kbbvk06z` | FOUR PILLARS RARE DRY GIN 700ML BOTTLE | SpO | bottle | 6333 | 6 | 1.5 (AA 2025-12-31) |  | 0 | 2 | 0.4 | – |
| **Glenfiddich 12** | `cmptovw6u00bus6018sk0oul2` | Glen fi ddich 12yo Whiskey | SpO | bottle | 7380 | 3 | 0.85 (StA 2026-03-31) |  | 0 | 0 | – | 0.85 |
|  | `cmsdf10ta00armiion18jgcaz` | Glenfiddich 12YO | SpO | bottle | 8039 | 5 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.8 | 0.6 |
| **Hendrick's** | `cmptovw8300c3s601umb3r9uu` | Hendricks Gin | SpO | bottle | 6960 | 7 | 0.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.5 | 0.8 |
|  | `cmsdf10u200b9miiob620vnu3` | HENDRICKS GIN : 700 ml | SpO | bottle | 6708 | 2 | 1 (StA 2026-08-03) |  | 0 | 0 | – | 1 |
| **Jack Daniel's** | `cmptovwak00cos601n7ng1vxa` | Jack Daniels | SpO | bottle | 5180 | 10 | 1.5 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.2 | 0 |
|  | `cmoqfbptf00dw9ky2yeuz5jh6` | JACK DANIELS 700ML BOTTLE | SpO | bottle | 5182 | 11 | 1 (StA 2025-12-31) |  | 0 | 5 | 1.5 | 0.95 |
| **Jameson**<br>_invoice item is 1 L; check bottle size_ | `cmptovwb100crs601rhjpc4gh` | Jameson Irish Whiskey | SpO | bottle | 5428 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.38 | 1 |
|  | `cmoqfbpu900dy9ky2cdu9wgjw` | JAMESON IRISH WHISKEY 1000ML BOTTLE | SpO | bottle | 7754 | 24 | 0.25 (StA 2025-12-31) |  | 0 | 2 | 0.5 | 1 |
| **Katun Gin** | `cmsdf10up00brmiiok0qgp9vs` | Katun Gin | SpO | bottle | 8550 | 5 | 0.8 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.8 |
|  | `cmoqfbpv300e09ky29e8aoks7` | KATUN GIN 700ML BOTTLE | SpO | bottle | 8550 | 6 | 0.9 (StA 2025-12-31) |  | 0 | 1 | – | 0.2 |
| **Old Forester** | `cmsdf10wk00d3miiolkw54z2q` | Old Forester | SpO | bottle | 4998 | 5 | 0.8 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.8 |
|  | `cmoqfbr5a00gy9ky29gmscdwi` | OLD FORESTER 700ML BOTTLE | SpO | bottle | 4998 | 7 | 0.7 (StA 2025-12-31) |  | 0 | 1 | – | 0.05 |
| **Ron Santiago de Cuba Carta Blanca** | `cmptovwsn00g9s601x55rocsc` | Ron Santiago de Cuba Carta Blanca | SpO | bottle | 4647 | 8 | 3.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 3.1 | 3.7 |
|  | `cmoqfbs4m00j69ky21vymlq04` | RON SANTIAGO DE CUBA BLANCA 700ML BOTTLE | SpO | bottle | 4650 | 19 | 0.4 (StA 2025-12-31) |  | 0 | 9 | 3.65 | 0.9 |
| **Thoquino Cachaca** | `cmptovwuz00grs601mh510dwu` | Thoquino Cachaca | SpO | bottle | 5987 | 8 | 1 (StA 2026-08-03) |  | 0 | 0 | 0 | 1 |
|  | `cmoqfbt2x00lc9ky2bdi99n44` | THOQUINO CACACHA 700ML BOTTLE | SpO | bottle | 5987 | 5 | 1 (StA 2026-10-01) | ✓ StA | 0 | 2 | – | 1 |
| **Vodka One** | `cmptovwvy00h0s601sz1gsrbr` | Vodka One | SpO | bottle | 3850 | 7 | 0 (StA 2026-08-03) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbtrc00mw9ky2zrisntsx` | VODKA ONE 700ML BOTTLE | SpO | bottle | 3849 | 10 | 5.3 (AA 2025-12-31) |  | 0 | 15 | 5.9 | 2.9 |
| **Woodford Reserve** | `cmptovwwd00h3s601h44sp6ix` | Woodford Reserve Bourbon | SpO | bottle | 6004 | 9 | 0.05 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.2 | 0.4 |
|  | `cmoqfbu7700nw9ky2fv68pmc9` | WOODFORD RESERVE 700ML BOTTLE | SpO | bottle | 5772 | 12 | 0.2 (StA 2026-10-01) | ✓ StA | 0 | 4 | 0.8 | 0.05 |
| **Lyre's White Cane**<br>_non-alcoholic; one is in Spirits — Other with countUnit can on the other_ | `cmptovwfk00dos601jtbuuixb` | Lyres White Cane | NA | can | 2926 | 10 | 2.7 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.7 | 0 |
|  | `cmoqfbq7w00eu9ky2gcs0n6ja` | LYRES WHITE CANE SPIRIT 700ML BOTTLE | SpO | bottle | 20442 | 10 | 0 (StA 2026-08-31) |  | 0 | 3 | 6 | 4.37 |

**Liqueurs & aperitifs**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Amaro Montenegro** | `cmptovuqm0010s6013efafhbz` | Amaro Montenegro | Liq | bottle | 4885 | 10 | 0.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.2 | 0.9 |
|  | `cmoqfblj800449ky22hjpr3rf` | AMARO MONTENEGRO 700ML BOTTLE | Liq | bottle | 4886 | 17 | 0.5 (StA 2025-12-31) |  | 0 | 3 | 2.7 | 1.4 |
| **Aperol** | `cmptovur30013s601wqypwyev` | Aperol | Liq | bottle | 2996 | 10 | 1.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 3 | 2.9 |
|  | `cmoqfblk200469ky26s956ptr` | APEROL APERITIF 700ML BOTTLE | Liq | bottle | 2996 | 12 | 1.2 (StA 2025-12-31) |  | 0 | 3 | 2.1 | 3.85 |
| **Campari** | `cmsdf10fg001fmiioi3lxasvi` | Campari | Liq | bottle | 3960 | 5 | 0.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.4 | 1.2 |
|  | `cmoqfbmhi006a9ky22fkntbgd` | CAMPARI 700ML BOTTLE | Liq | bottle | 3865 | 12 | 1.6 (StA 2025-12-31) |  | 0 | 5 | 0.95 | 2.8 |
|  | `cmptovurv0019s601c4zx7ncn` | Campari Aperitif | Liq | bottle | 3869 | 5 | 1.36 (AA 2026-06-30) |  | 0 | 0 | 2.16 | 3.66 |
| **Giffard Amaretto** | `cmptovuua001rs601p2i6inwy` | Giffard Amaretto | Liq | bottle | 4136 | 10 | 0.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 2 | 0.6 |
|  | `cmoqfbp0g00c29ky2lijy6zyy` | GIFFARD AMARETTO 700ML BOTTLE | Liq | bottle | 4136 | 11 | 2 (StA 2025-12-31) |  | 0 | 1 | 0.25 | 0.5 |
| **Giffard Mandarin** | `cmptovuum001us601la7hrpie` | Giffard Mandarin Liqueur | Liq | bottle | 4867 | 8 | 0.4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1 | 2 |
|  | `cmoqfbp5n00ce9ky21ppladjd` | GIFFARD MANDARIN LIQUEUR 700ML BOTTLE | Liq | bottle | 4936 | 6 | 1 (AA 2025-12-31) |  | 0 | 2 | 1 | – |
| **Giffard Maraschino** | `cmptovuv1001xs601o36kg770` | Giffard Maraschino Liqueur | Liq | bottle | 4136 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.2 | 0.9 |
|  | `cmoqfbp6j00cg9ky2v46kszuy` | GIFFARD MARASCHINO LIQUEUR 700ML BOTTLE | Liq | bottle | 4136 | 15 | 0.9 (StA 2025-12-31) |  | 0 | 4 | 0.3 | 1 |
| **Giffard Violette** | `cmptovuve0020s601uaajndu4` | Giffard Violette Liqueur | Liq | bottle | 4649 | 9 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.9 | 1.42 |
|  | `cmoqfbpa200co9ky24zyqif44` | GIFFARD VIOLETTE 700ML BOTTLE | Liq | bottle | 4136 | 11 | 1.1 (StA 2026-08-31) |  | 0 | 2 | 0.9 | 1.1 |
| **Licor 43** | `cmptovuvp0023s60148l707ef` | Licor 43 | Liq | bottle | 5227 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.1 | 0.9 |
|  | `cmoqfbq2r00ei9ky2awp7co0k` | LICOR 43 700ML BOTTLE | Liq | bottle | 5161 | 11 | 3 (StA 2025-12-31) |  | 0 | 2 | 2.35 | 2.4 |
| **Massenez Birdseye Chilli** | `cmptovux3002cs601isq3ia6l` | Massenez Birdseye Chili Liqueur | Liq | bottle | 4842 | 8 | 1.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.5 | 1.8 |
|  | `cmoqfbqd200f69ky2bt5gvk4r` | MASSENEZ BIRDSEYE CHILLI 700ML BOTTLE | Liq | bottle | 4909 | 20 | 1 (StA 2025-12-31) |  | 0 | 3 | 0.35 | 1.2 |
| **Patron XO Cafe** | `cmptovwr400fxs601zwx7in1d` | Patron XO Cafe | Liq | bottle | 8767 | 10 | 4.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 2.6 | 4.5 |
|  | `cmoqfbri900hs9ky2ttkbikvw` | PATRON XO CAFE 700ML BOTTLE | Liq | bottle | 8766 | 11 | 6.7 (StA 2025-12-31) |  | 0 | 5 | 3.7 | 7.2 |
| **Rosso Antico** | `cmptovuzb002us601pbzt7wxd` | Rosso Antico Sweet Vermouth | Liq | bottle | 2065 | 9 | 1.5 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.1 | 0.6 |
|  | `cmoqfbs6d00ja9ky21qejd31g` | ROSSO ANTICO 750ML BOTTLE | Liq | bottle | 2069 | 13 | 0.2 (StA 2026-08-31) |  | 0 | 4 | 0.85 | 0.2 |
| **Vok Creme de Cacao White** | `cmptovv070030s601gk57wmlq` | Vok Creme de Cacao Blanco | Liq | bottle | 2326 | 10 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 2.6 | 1 |
|  | `cmoqfbts900my9ky2wvcw356x` | VOK CREME DE CACAO WHITE 500ML - (CASE OF 6) | Liq | bottle | 2323 | 7 | 8.5 (StA 2025-12-31) |  | 0 | 1 | – | 0.5 |
|  | `cmoqfbtt300n09ky2ncr77y2h` | VOK CREME DE CACAO WHITE 500ML BOTTLE | Liq | bottle | 2323 | 7 | 6 (AA 2025-12-31) |  | 0 | 0 | 2 | – |

**Non-alcoholic & mixers**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Capi Grapefruit** | `cmptovv1m0039s601s1ujhx2l` | Capi Sparkling Grapefruit | NA | each | 197 | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 17 | 0 |
|  | `cmoqfbmjb006e9ky2wvkd0v3z` | CAPI GRAPEFRUIT SODA - (CASE OF 12) | NA | each | 375 | 13 | 10 (AA 2026-10-01) | ✓ AA | 0 | 2 | 2 | 0 |
| **Finest Call Mango Puree** | `cmsdf10hg002rmiiojx5lfshq` | Finest Call Mango Puree | NA | L | 1361 | 5 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 1.7 |
|  | `cmoqfboky00b29ky211u9f76e` | FINEST CALL MANGO PUREE 1000ML BOTTLE | NA | bottle | 1512 | 7 | 0 (AA 2026-09-01) |  | 0 | 1 | 0 | 2.5 |
| **Finest Call Passionfruit Puree** | `cmsdf10hp002xmiio9cli3wg4` | Finest Call Passionfruit Puree | NA | bottle | 1361 | 5 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 0 |
|  | `cmoqfbolt00b49ky20er2dldq` | FINEST CALL PASSIONFRUIT PUREE 1L BOTTLE | NA | bottle | 1512 | 7 | 0 (AA 2026-09-01) |  | 0 | 1 | 0 | 2 |
| **First Press Coffee Mixer** | `cmptovv23003cs6013b0couwj` | First Press Black Cold Drip Coffee Mixer | NA | each | 1894 | 8 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 2.5 |
|  | `cmoqfbomo00b69ky2dvddt9pa` | FIRST PRESS COFFEE MIXER 750ML - (CASE OF 6) | NA | bottle | 1722 | 12 | 0 (AA 2026-09-01) |  | 0 | 4 | 0 | 1.9 |
| **Giffard Coconut Syrup** | `cmsdf10hy0033miiojbdlgeog` | Giffard Coconut Syrup | NA | bottle | 2610 | 5 | 2.8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.2 | 3 |
|  | `cmoqfbp2600c69ky24p8ikf3e` | GIFFARD COCONUT SYRUP 1000ML BOTTLE | NA | bottle | 12840 | 18 | 0 (AA 2026-09-01) |  | 0 | 2 | 0.53 | 2.6 |
| **Giffard Falernum** | `cmoqfbp3200c89ky2hb00l6gn` | GIFFARD FALERNUM 1000ML BOTTLE | NA | bottle | 2140 | 12 | 0 (AA 2026-09-01) |  | 0 | 2 | 0.23 | 3.2 |
|  | `cmsdf10i60039miiora0s7x8e` | Giffard Falernum Syrup | NA | bottle | 2316 | 4 | 1.25 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.8 | 0 |
|  | `cmptovv30003is60112onwtn0` | Giffard Falernum Syrup 1000ml | NA | bottle | 2380 | 5 | 0.8 (AA 2026-09-01) |  | 0 | 0 | 0.8 | 3.3 |
| **Giffard Ginger Syrup** | `cmsdf10if003fmiiokrnutenn` | Giffard Ginger Syrup | NA | bottle | 0 | 4 | 3.5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 1.7 | 2.86 |
|  | `cmoqfbp3y00ca9ky2jzs8f0n8` | GIFFARD GINGER SYRUP 1000ML BOTTLE | NA | bottle | 2140 | 13 | 0 (AA 2026-09-01) |  | 0 | 2 | 0.69 | 3.02 |
| **Giffard Rose Syrup** | `cmsdf10ir003lmiiobw2mupn9` | Giffard Rose Syrup | NA | bottle | 2373 | 5 | 3.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.48 | 2.1 |
|  | `cmptovv4e003rs6014szbgz4z` | Giffard Rose Syrup 1000ml | NA | bottle | 2120 | 3 | 0.97 (StA 2026-03-31) |  | 0 | 0 | – | 0.97 |
|  | `cmoqfbp7g00ci9ky2fenupt1l` | GIFFARD ROSE SYRUP 1L BOTTLE | NA | bottle | 14235 | 15 | 0.5 (AA 2026-09-01) |  | 0 | 2 | 0.72 | 4.5 |
| **Giffard Strawberry Syrup**<br>_one is filed under Produce_ | `cmsdf10iz003rmiio5evtegxv` | Giffard Strawberry Syrup | NA | bottle | 2350 | 5 | 2.2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 2.25 |
|  | `cmoqfbp8b00ck9ky299ayujyi` | GIFFARD STRAWBERRY 1000ML BOTTLE | Prod | each | 2136 | 10 | 0.4 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 0 |
| **Herradura Agave Nectar**<br>_one is filed under Oils & Condiments_ | `cmsdf10jh0043miio7l9nm78s` | Herradura Agave Nectar | NA | bottle | 1228 | 5 | 0 (AA 2026-09-01) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbpi700d69ky2f8gje5og` | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) | O&C | each | 13488 | 15 | 0 (StA 2026-08-31) |  | 0 | 10 | 15 | 0 |
| **Lime Juice 5 L** | `cmsdf10jz004fmiioy6e21lmz` | Lime Juice | NA | each | 1520 | 4 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | – | 8 |
|  | `cmoqfbq3n00ek9ky2f7n9793j` | Lime Juice (1 x 5L) | NA | L | 7000 | 21 | 3.8 (StA 2026-10-01) | ✓ StA | 1 | 53 | 3.5 | 0 |
| **Lyre's Agave Blanco** | `cmsdf9r8d000vmimfd8vkggye` | Lyres Agave Blanco | NA | bottle | 2925 | 5 | 5.8 (AA 2026-10-01) | ✓ AA | 0 | 0 | 5.7 | 0 |
|  | `cmoqfbq6600eq9ky2qgnr8ejx` | LYRES AGAVE BLANCO 700ML BOTTLE | NA | bottle | 21114 | 13 | 0 (AA 2026-09-01) |  | 0 | 3 | 0.99 | 6 |
| **Sammy Piquant Jetsetter** | `cmptovuzr002xs601p38qiam2` | Sammy Piquant The Jetsetter | NA | each | 3406 | 9 | 6.05 (AA 2026-10-01) | ✓ AA | 0 | 0 | 6.2 | 0 |
|  | `cmoqfbsdo00jq9ky2k3aq5jkd` | SAMMY PIQUANT JETSETTER 700ML BOTTLE | NA | bottle | 17970 | 11 | 0.4 (StA 2025-12-31) |  | 0 | 2 | 10.7 | 1.95 |
| **Supasawa** | `cmsdf10kj004rmiiotqllpqd9` | Supasawa | NA | bottle | 2760 | 5 | 2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 6.1 | 0 |
|  | `cmoqfbswy00ky9ky2n2nczql9` | SUPASAWA 700ML - (CASE OF 6) | NA | bottle | 14826 | 14 | 12.09 (AA 2026-06-02) |  | 0 | 5 | 1.4 | 3.3 |
| **Watermelon Juice 5 L** | `cmsdf10l00053miioyzpx19ey` | Watermelon Juice | NA | each | 3480 | 3 | 16.6 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 0.9 |
|  | `cmoqfbtwm00n89ky2nzqu27ne` | Watermelon Juice (1 x 5L) | NA | L | 3000 | 17 | 2.2 (StA 2026-10-01) | ✓ StA | 0 | 6 | 11.3 | 0 |

**Beer**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Modus Operandi Cerveza** | `cmptovunp000js601dnfuov48` | Modus Operandi Cerveza | Beer | bottle | – | 8 | 0 (StA 2026-08-03) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbqlt00fq9ky2ft2fnprc` | MODUS CERVEZA CAN - (CASE OF 12) | Beer | can | 248 | 7 | 6 (AA 2025-11-30) |  | 0 | 2 | 18 | 19 |
| **Wedge Cerveza Keg** | `cmptovuq5000xs601q1f9kaxv` | Freshwater Brewing Wedge Cerveza Keg | Beer | keg | 27000 | 8 | 0 (StA 2026-08-03) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbtxh00na9ky2u9rt3d49` | Wedge Cerveza Keg | Beer | keg | 27000 | 16 | 1.9 (StA 2025-12-31) |  | 0 | 8 | 0.3 | 1.8 |

**Wine (floor bottle vs invoice case item of the same wine)**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Ca' di Bruno Barbaresco** | `cmoqfbjxd000g9ky2p4zxe3jt` | 2019 Cà di Bruno Barbaresco DOCG (Case of 6) | Red | bottle | 4257 | 9 | 12 (StA 2026-10-01) | ✓ AA/StA | 0 | 1 | – | 12 |
|  | `cmsdf10lv005lmiiovabrchcu` | Ca di Bruno Barbaresco | Red | bottle | 4257 | 4 | 0 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 8 |
| **Villa Albergotti Chianti Superiore** | `cmoqfbk3g000u9ky20m4xbzfn` | 2021 Villa Albergotti Chianti Superiore DOCG (Case of 6) | Red | bottle | 1775 | 18 | 5 (StA 2026-10-01) | ✓ StA | 0 | 15 | 2 | 10.9 |
|  | `cmptovvhc0069s6014qf2qyy3` | Villa Albergotti Chianti Superiore | Red | bottle | 2175 | 9 | 9.7 (AA 2026-10-01) | ✓ AA | 0 | 0 | 13.6 | 14.3 |
| **Capa Tempranillo** | `cmoqfbk6u00129ky27whltdip` | 2022 Capa Single Vineyard Tempranillo (Case of 6) | Red | bottle | 1275 | 12 | 10.2 (StA 2026-08-31) |  | 0 | 6 | 2.6 | 10.2 |
|  | `cmptovvc20056s601ll6tfzz1` | Capa Tempranillo | Red | bottle | 1509 | 10 | 5 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 3.9 | 17.3 |
| **Stephane Brocard Gevrey-Chambertin** | `cmoqfbkd1001g9ky2nksoxut4` | 2022 Stephane Brocard Gevrey-Chambertin Vielles Vignes (Case of 6) | Red | bottle | 9654 | 14 | 9 (StA 2026-10-01) | ✓ AA/StA | 0 | 2 | – | 9 |
|  | `cmsdf10oe007fmiioqo8nqs8h` | Stephane Brocard Gevrey-Chambertin | Red | bottle | 12454 | 4 | 0 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 6 |
| **Bonnet & Cotton Beaujolais**<br>_invoice name has the typo "Rogue"_ | `cmoqfbkha001q9ky2i2jsan2s` | 2023 Bonnet & Cotton Beaujolais Rogue (Case of 12) | Red | bottle | 3500 | 12 | 0 (AA 2026-10-01) | ✓ AA | 0 | 12 | 17.5 | 28 |
|  | `cmptovvbe0050s601gthnv0ek` | Bonnet & Cotton Beaujolais Rouge | Red | bottle | 3500 | 10 | 28 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 28 |
| **Domaine Thomson Explorer Pinot Noir**<br>_invoice item avgCost 24100c looks like a case cost_ | `cmoqfbkyz002u9ky20vuy0jlx` | 2024 Domaine Thompson Explorer Pinot Noir (Case of 12) | Red | bottle | 24100 | 16 | 6 (StA 2026-10-01) | ✓ AA/StA | 0 | 2 | 22 | 3.6 |
|  | `cmptovvci0059s6012vdipwzj` | Domaine Thomson Explorer Pinot Noir | Red | bottle | 2331 | 9 | 7 (AA 2026-10-01) | ✓ AA | 0 | 0 | 6 | 11 |
| **Yangarra Circle Shiraz** | `cmoqfbl9m003i9ky24goxtsgy` | 2024 Yangarra Estate 'Circle' Shiraz (Case of 6) | Red | bottle | 1317 | 11 | 6 (StA 2026-10-01) | ✓ AA/StA | 0 | 4 | – | 0 |
|  | `cmsdf10p0007xmiio082rrk7e` | Yangarra Circle Shiraz | Red | bottle | – | 4 | 0 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 0 |
| **Chateau La Grave Figeac**<br>_both undated; same wine, one misspelt "Cheateau"_ | `cmoqfbmti00729ky2g0t02x73` | Chateau La Grave Figeac | Red | bottle | 6980 | 9 | 3 (StA 2026-10-01) | ✓ AA/StA | 0 | 1 | – | 3 |
|  | `cmsdf10mb005xmiiod0q42oc0` | Cheateau La Grave Figeac St Emilion Grand Cru | Red | bottle | 6980 | 3 | 0 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 3 |
| **Loic Mahe Sables & Schistes** | `cmoqfbkba001c9ky2mg4aq8di` | 2022 Loïc Mahe 'Sables & Schists' Chenin Blanc Savennieres (Case of 12) | White | bottle | 3798 | 7 | 0 (AA 2026-10-01) | ✓ AA | 0 | 3 | – | 12 |
|  | `cmsdf111n00g3miiofewysakf` | Loic Mahe Sables & Schists Chenin Blanc | White | bottle | 4900 | 5 | 3 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | – | 9 |
| **Inama Soave Classico** | `cmoqfbkng00249ky2os51r52g` | 2023 Inama Vin Soave Classico Screwcap (Case of 6) | White | bottle | 1808 | 7 | 0 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 13 |
|  | `cmptovx0r00i0s601dji1gbqe` | Inama Soave Classico | White | bottle | 2333 | 8 | 4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 5 |
| **Mon Tout Heydays Chardonnay** | `cmoqfbkr1002c9ky2j322b3z5` | 2023 Mon Tout 'Heydays' Chardonnay -skin contact- (Case of 12) | White | bottle | 1467 | 7 | 0 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 22 |
|  | `cmsdf112500gfmiio8j1sqcqq` | Mon Tout Chardonnay | White | bottle | 1703 | 5 | 9 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | – | 12 |
| **Nick Spencer Gruner Veltliner** | `cmoqfbkry002e9ky28n1zmqnu` | 2023 Nick Spencer Gruner Veltliner (Case of 12) | White | bottle | 2029 | 7 | 0 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 10 |
|  | `cmsdf112e00glmiioauqf5uyk` | Nick Spencer Tumbarumba Gruner Veltliner | White | bottle | 2027 | 5 | 6 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | – | 8 |
| **Shut The Gate Gewurztraminer** | `cmoqfbktt002i9ky2eer32l96` | 2023 Shut The Gate For Freedom Gewurtztraminer (Case of 12) | White | bottle | 1467 | 12 | 18 (AA 2026-10-01) | ✓ AA | 0 | 8 | 15 | 10.1 |
|  | `cmptovx2n00ifs601oytnde3s` | Shut The Gate For Freedom Gewurztraminer | White | bottle | 1703 | 7 | 25 (StA 2026-10-01) | ✓ StA | 0 | 0 | 20 | 25.8 |
| **i Lauri Pecorino** | `cmoqfbl3c00349ky20k5ndzbl` | 2024 i Lauri Pecorino D'Abruzzo (Case of 6) | White | bottle | 2349 | 11 | 10 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 9 |
|  | `cmptovx0b00hxs601t8z53137` | i Lauri AVALOS Pecorino | White | bottle | 2349 | 10 | 4 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 9.98 | 4 |
| **Maison Saint Aix Rose** | `cmoqfbkq6002a9ky251mk5od4` | 2023 Maison Saint Aix Dry Rose 750ml (Case of 12) | Rosé | bottle | 1933 | 7 | 0 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 9 |
|  | `cmsdf10np006xmiio5qobl72f` | Maison Saint AIX Rose | Rosé | bottle | 2369 | 5 | 19 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | – | 2 |
| **Laurent-Perrier La Cuvee** | `cmoqfbqvi00gc9ky27iq1rn3l` | NV Laurent Perrier La Cuvee (Case of 6) | Spk | bottle | 6434 | 17 | 0 (AA 2026-10-01) | ✓ AA | 0 | 2 | 12 | 1 |
|  | `cmptovuoq000os601tw9t7842` | Laurent Perrier La Cuvee Champagne | Spk | bottle | 6740 | 10 | 3 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 14 | 5 |
| **Serenello Prosecco**<br>_invoice item avgCost 8500c looks like a case cost_ | `cmoqfbqwe00ge9ky2i603eznp` | NV Serenello Prosecco (Case of 6) | Spk | bottle | 8500 | 14 | 11 (StA 2026-10-01) | ✓ AA/StA | 0 | 10 | 0 | 0 |
|  | `cmptovup7000rs6014lse9qot` | Serenello Prosecco | Spk | bottle | 1468 | 9 | 6.55 (AA 2026-10-01) | ✓ AA | 0 | 0 | 21.2 | 0 |

**Kitchen: dry, pantry, herbs and spices**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Panko breadcrumbs** | `cmptowaqp00qds6019uh8qktj` | Breadcrumbs Panko | Bak | each | 624 | 6 | 561 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.21 | 0 |
|  | `cmoqfbm65005k9ky253vhxlsp` | BREADCRUMBS JAPANESE PANKO YELLOW 1KG (Natures Secret) EA (6) | Bak | each | 625 | 5 | 1 (StA 2026-08-31) |  | 2 | 1 | 0 | 1 |
| **Flour tortillas 12in** | `cmptowak400p4s601hqhv1mtt` | Tortilla Flour 12inch | Bak | each | 48 | 6 | 6 (AA 2026-10-01) | ✓ AA | 0 | 0 | 12 | 0 |
|  | `cmoqfboq500be9ky25wyc1a1x` | FLOUR TORTILLAS 12X91GM 12INCH (True Foods) EA (6) | Bak | each | 570 | 8 | 0.83 (StA 2026-08-31) |  | 12 | 9 | 4 | 0.83 |
| **Wonton egg wrapper**<br>_Bakery vs Dry / Pantry_ | `cmsdf12qh0006mij918l5a1ff` | Wonton Egg Wrapper | Bak | each | 300 | 3 | 2 (AA 2026-10-01) | ✓ AA | 0 | 0 | 2 | 3.64 |
|  | `cmoqfbu6c00nu9ky26w5euhqz` | WONTON EGG WRAPPER 300GM (Mc Yee Noodles) EA | Dry | each | 300 | 7 | 0 (StA 2026-08-31) |  | 27 | 2 | 2 | 0 |
| **Ascorbic acid** | `cmptowapi00q4s601wkfg9fp5` | Ascorbic Acid | Dry | each | 5354 | 7 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfblr3004m9ky2sqjpkwct` | Ascorbic Acid 600g - Red Spoon | Dry | each | 5350 | 11 | 2.54 (StA 2026-08-31) |  | 0 | 5 | 0.88 | 2.54 |
| **Black beans dry** | `cmsdf12sc000omij9uj88ejbf` | Beans Black Dry | Dry | kg | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfblyy00549ky2levrzq9s` | BEANS BLACK DRY 1KG (Galaxy) EA (12) | Dry | each | 500 | 13 | 0 (StA 2026-08-31) |  | 4 | 1 | 0.87 | 0 |
| **Coconut milk** | `cmsdf12sm000umij9mzl6ks4x` | Coconut Milk | Dry | each | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbneg008e9ky28x1bmxfo` | COCONUT MILK 400ML (Royal Line) EA (24) | Dry | each | 170 | 15 | 0 (StA 2026-08-31) |  | 0 | 1 | 6.85 | 0 |
| **Plain flour 1 kg**<br>_12.5 kg sack (oqfbooe00ba) is a separate pack size_ | `cmptowats00qys601jz6ayyqv` | Flour Plain | Dry | each | 112 | 8 | 0 (StA 2026-08-31) |  | 0 | 0 | 5.82 | 0 |
|  | `cmoqfbopa00bc9ky27h97zxb8` | FLOUR PLAIN 1KG (Manildra) EA | Dry | each | 250 | 5 | 1 (StA 2026-08-31) |  | 5 | 1 | – | 1 |
| **Garlic powder**<br>_Dry / Pantry vs Herbs & Spices_ | `cmsdf12sy0010mij9lyo56458` | Garlic Powder | Dry | each | 905 | 3 | 540 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.2 | 0 |
|  | `cmoqfboyr00by9ky2jfukvth7` | GARLIC POWDER 540GM (Windsor Farm) EA | H&S | each | 900 | 8 | 1 (AA 2026-10-01) | ✓ AA | 3 | 2 | 1 | 0 |
| **Onion powder**<br>_Dry / Pantry vs Herbs & Spices_ | `cmsdf12th001cmij97z2i2rgw` | Onion Powder | Dry | each | 900 | 3 | 500 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.6 | 0 |
|  | `cmoqfbr7100h29ky2r48yn0lt` | ONION POWDER 500GM (Galaxy) EA | H&S | each | 900 | 7 | 0.5 (AA 2026-10-01) | ✓ AA | 1 | 1 | 1 | 0 |
| **Smoked paprika**<br>_Dry / Pantry vs Herbs & Spices_ | `cmsdf12tr001imij9wegfg9q4` | Paprika Smoked | Dry | each | 1202 | 3 | 1.2 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.8 | 1 |
|  | `cmoqfbrc500he9ky2hslnha7v` | PAPRIKA SMOKED 500GM (Galaxy) EA | H&S | each | 1200 | 12 | 1.2 (AA 2026-10-01) | ✓ AA | 4 | 4 | 1.5 | 0 |
| **Hazelnuts roasted** | `cmptowaw300rds6016lskiiir` | Nut Hazelnut Roasted | Dry | each | 2846 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0.85 | 0 |
|  | `cmoqfbpge00d29ky2sm7h6vof` | HAZELNUT ROASTED 1KG (Natures Secret) EA (12) | Dry | each | 2600 | 3 | 0.61 (StA 2026-08-31) |  | 1 | 2 | 0.5 | 0.61 |
| **Pistachio kernels** | `cmptowawj00rgs601q0qie3ec` | Nut Pistachio Kernel | Dry | each | 4468 | 6 | 970 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.9 | 0 |
|  | `cmoqfbrr000ic9ky2v57s0l12` | PISTACHIO NUT KERNAL 1KG (Natures Secret) EA (12) | Dry | each | 4450 | 5 | 0.27 (StA 2026-08-31) |  | 2 | 4 | – | 0.27 |
| **Peanuts roasted** | `cmptowb1200sas601rc2omwjk` | Peanuts Roasted | Dry | each | – | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbrjy00hw9ky2or0xpza8` | PEANUTS ROASTED SALTED 1KG (Galaxy) EA (12) | Dry | each | 800 | 2 | 0 (StA 2026-08-31) |  | 0 | 2 | – | 0.15 |
| **Pepitas**<br>_one is filed under Other_ | `cmptowb1f00sds60107gsotjy` | Pepita Seeds | Dry | each | 1207 | 8 | 757 (AA 2026-10-01) | ✓ AA | 0 | 0 | 2 | 0 |
|  | `cmoqfbrmm00i29ky2e6zhjbll` | PEPITAS, PUMPKIN SEED 1KG (Galaxy) EA (12) | Oth | each | 1200 | 6 | 0 (StA 2026-03-15) |  | 6 | 5 | 0.5 | 0.19 |
| **Basmati rice** | `cmsdf12u0001omij9a4rffdxk` | Rice Basmati | Dry | kg | 300 | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 1 | 0 |
|  | `cmoqfbs0300iw9ky2r864y9f8` | RICE BASMATI 1KG (Natures Secret) EA (12) | Dry | each | 300 | 7 | 0 (StA 2026-08-31) |  | 6 | 4 | 4 | 0 |
| **Table salt** | `cmsdf12ua001umij9kpyy0cmt` | Salt Table | Dry | kg | 100 | 3 | 2 (AA 2026-10-01) | ✓ AA | 0 | 0 | 5.72 | 0 |
|  | `cmoqfbscr00jo9ky2pmb89fp0` | SALT TABLE 14KG (Olssons) CTN | Dry | each | 1400 | 8 | 1.09 (StA 2026-08-31) |  | 3 | 11 | 5.77 | 1.09 |
| **Sea salt flakes** | `cmsdf12uj0020mij9cpu2un4t` | Sea Salt Flakes | Dry | each | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbsiy00k29ky26w7hlejy` | SEA SALT FLAKES 6KG (Olssons) CTN | Dry | each | 6550 | 7 | 0 (StA 2026-08-31) |  | 1 | 13 | 1 | 0 |
| **Sesame seed white** | `cmsdf12us0026mij9kalklh8m` | Sesame Seed White | Dry | each | 900 | 3 | 969 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.3 | 0.23 |
|  | `cmoqfbskr00k69ky2ie8qaiuw` | SESAME SEED WHITE 1KG (Galaxy) EA (12) | Dry | each | 900 | 8 | 0 (StA 2026-08-31) |  | 2 | 7 | 1 | 0.31 |
| **Caster sugar** | `cmsdf12v2002cmij9o7qh0nd0` | Sugar Caster | Dry | kg | 275 | 3 | 1 (AA 2026-10-01) | ✓ AA | 0 | 0 | 2.13 | 0 |
|  | `cmoqfbsv900ku9ky23m3omsgz` | SUGAR CASTER 1KG (CSR) EA (12) | Dry | each | 275 | 6 | 0 (StA 2026-08-31) |  | 10 | 7 | 2 | 0 |
| **White wine vinegar**<br>_Dry / Pantry vs Oils & Condiments_ | `cmsdf12vb002imij9keor7liy` | Vinegar White Wine | Dry | each | 120 | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0.5 | 0 |
|  | `cmoqfbtqg00mu9ky23ctmc7au` | VINEGAR WHITE WINE 500ML (PGF) EA | O&C | each | 500 | 7 | 0 (StA 2026-08-31) |  | 0 | 1 | 1 | 0.14 |
| **Olive oil pomace**<br>_Dry / Pantry vs Oils & Condiments_ | `cmsdf12t70016mij91xsikjsq` | Oil Olive Pomace | Dry | L | 650 | 3 | 7 (AA 2026-10-01) | ✓ AA | 0 | 0 | 6.51 | 0 |
|  | `cmoqfbr2k00gs9ky2ncbfja0w` | OIL OLIVE POMACE 4L (Trading) | O&C | each | 2600 | 10 | 0.3 (StA 2026-08-31) |  | 15 | 14 | 2.5 | 0.42 |
| **Guajillo chilli dried** | `cmptowaro00qjs60131vn5wcu` | Chilli Guajillo Dried | Dry | each | 482 | 6 | 1.13 (StA 2026-08-31) |  | 0 | 0 | 5.4 | 1.13 |
|  | `cmoqfbu4l00nq9ky2hmc9vwwh` | Whole dried Guajillo (Mirasol) Chilli 1kg | Dry | each | 4815 | 5 | 157 (AA 2026-10-01) | ✓ AA | 0 | 11 | 1 | 0.18 |
| **Allspice** | `cmptowbf000uss6015b29ykiv` | Allspice | H&S | each | 1400 | 7 | 350 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.2 | 0 |
|  | `cmoqfblfq003w9ky26t8runbo` | ALLSPICE WHOLE 350GM (Galaxy) EA | H&S | each | 1400 | 12 | 0.17 (StA 2026-08-31) |  | 1 | 9 | 7.05 | 0.37 |
| **Cinnamon ground** | `cmsdf12w90036mij9al2tktjx` | Cinnamon Ground | H&S | each | 1123 | 3 | 300 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.8 | 0 |
|  | `cmoqfbn9d00829ky23aqa9af7` | CINNAMON GROUND 400GM (Chefs Choice) EA | H&S | each | 1100 | 7 | 0 (StA 2026-08-31) |  | 1 | 2 | 0.3 | 0 |
| **Cinnamon quill** | `cmsdf12wi003cmij97rny82q8` | Cinnamon Quill | H&S | each | 1000 | 3 | 400 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.8 | 0 |
|  | `cmoqfbna800849ky2g24y9ts5` | CINNAMON QUILL 200GM (Chefs Choice) EA | H&S | each | 1000 | 9 | 0.44 (StA 2026-08-31) |  | 1 | 2 | 2 | 0.44 |
| **Cumin ground**<br>_floor item cost (1100) matches CUMIN SEEDS — check which it really is_ | `cmsdf12wr003imij9gljfn2p8` | Cumin Ground | H&S | each | 1100 | 3 | 100 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.5 | 0 |
|  | `cmoqfbnsq009a9ky2x84gk1ve` | CUMIN GROUND 450GM (Chefs Choice) EA | H&S | each | 800 | 7 | 0.13 (StA 2026-08-31) |  | 0 | 4 | 1 | 0.15 |
| **Mexican oregano** | `cmsdf12x0003omij9wjaa0mul` | Oregano Mexican | H&S | each | 1770 | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 2 | 0 |
|  | `cmptowbil00ves601b1z7ehnh` | Oregano Mexican 250gm | H&S | each | 1763 | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | – | 0 |
|  | `cmoqfbqgk00fe9ky2ziiwf2bf` | Mexican Oregano - 250g | H&S | each | 1770 | 8 | 1 (AA 2026-10-01) | ✓ AA | 0 | 7 | 2 | 1.06 |
| **Black pepper cracked** | `cmptowb1x00sgs601dff7shwr` | Pepper Black Cracked | H&S | each | 1369 | 5 | 0.3 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.13 | 0 |
|  | `cmoqfbrnh00i49ky2pyl3ug0h` | PEPPER BLACK CRACKED RESTAURANT 400GM (Windsor Farm) EA | H&S | each | 1400 | 9 | 0 (StA 2026-08-31) |  | 2 | 7 | 1 | 0 |
| **Black peppercorns whole** | `cmptowb2f00sjs601qlkwclqb` | Peppercorns Black Whole | H&S | each | 0 | 5 | 237 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.8 | 0 |
|  | `cmoqfbrod00i69ky29z7l87g8` | PEPPER CORNS BLACK WHOLE 500GM (Windsor Farm) EA | H&S | each | 1550 | 8 | 1 (AA 2026-10-01) | ✓ AA | 1 | 13 | 0.8 | 0.2 |
| **Vanilla bean paste** | `cmptowb7d00tgs60196v00cbx` | Vanilla Bean Paste | H&S | each | 3013 | 7 | 0 (StA 2026-08-31) |  | 5 | 0 | 0.2 | 0 |
|  | `cmoqfbtl600mi9ky22v3m1s40` | VANILLA BEAN PASTE ORGANIC TUBE 320GM (Queen) EA (10) | H&S | each | 3000 | 9 | 1 (AA 2026-10-01) | ✓ AA | 1 | 4 | 0.5 | 0.16 |
| **Agave syrup 4 L** | `cmptowap000q1s6018squehvr` | Agave Syrup | O&C | each | 5673 | 8 | 3.65 (AA 2026-10-01) | ✓ AA | 0 | 0 | 5.59 | 0 |
|  | `cmoqfbld6003q9ky2v4i89e7q` | Agave Syrup Clear (4L) | O&C | each | 5670 | 5 | 0 (StA 2026-08-31) |  | 0 | 4 | 1 | 0 |
| **Honey** | `cmptowaup00r4s601d1kbapd3` | Honey | O&C | each | 678 | 7 | 0 (StA 2026-08-31) |  | 0 | 0 | 4.01 | 0 |
|  | `cmoqfbpp700dm9ky21lc7zl33` | HONEY PURE 3KG (Wild Flower) EA (4) | O&C | each | 2030 | 9 | 1 (AA 2026-10-01) | ✓ AA | 0 | 0 | – | 0.11 |
| **Olive oil extra virgin** | `cmptowayc00rss601jvo6xbsn` | Oil Olive Extra Virgin | O&C | each | 1227 | 8 | 0 (StA 2026-08-31) |  | 0 | 0 | 4.24 | 0 |
|  | `cmoqfbr1o00gq9ky2w9f9olq3` | OIL OLIVE EXTRA VIRGIN 4LT (Natures Secret) | O&C | L | 1225 | 6 | 1 (AA 2026-10-01) | ✓ AA | 5 | 9 | – | 0.82 |
| **Chips shoestring** | `cmptowb9o00tvs601jv2xy0xl` | Chips Shoestring Fries | Frz | each | 447 | 6 | 17 (AA 2026-10-01) | ✓ AA | 0 | 0 | 9 | 0 |
|  | `cmoqfbn6q007w9ky2jk6bmuda` | CHIPS 7MM SHOESTRING FRIES 5X3KG G/FREE (McCain) CTN | Frz | each | 1340 | 8 | 0 (StA 2026-08-31) |  | 8 | 1 | 1 | 0 |
| **Mixed berries frozen** | `cmptowbap00u1s601mys0u56v` | Mixed Berries Frozen | Frz | each | 951 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbqk000fm9ky28v51vdfu` | MIXED BERRIES WHOLE FROZEN 1KG (Harvestime) EA (10) | Frz | each | 950 | 2 | 0 (StA 2026-08-31) |  | 2 | 1 | – | 0 |
| **White chocolate Callebaut 2.5 kg** | `cmoqfbmgm00689ky2l6j9dwty` | Callebaut Chocolate White Callet 28% 2.5kg | Des | each | 10934 | 7 | 0 (StA 2026-08-31) |  | 0 | 2 | – | 0.05 |
|  | `cmoqfbn7k007y9ky2wi6xz75s` | CHOCOLATE WHITE 2.5KG (Callebaut) EA (8) | Des | each | 12000 | 3 | 0.32 (StA 2026-08-31) |  | 1 | 1 | – | 0.32 |

**Dairy**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Butter unsalted 1 kg**<br>_500 g pack (oqfbmcb005y) is a separate pack size_ | `cmsdf12qt000cmij95wm1f90w` | Butter Unsalted | Dairy | kg | 1637 | 3 | 0 (StA 2026-08-31) |  | 14 | 0 | 0.54 | 0 |
|  | `cmoqfbmbf005w9ky2s56nzqsn` | BUTTER UNSALTED 1KG (Devondale) | Dairy | kg | 1650 | 6 | 1.17 (StA 2026-08-31) |  | 9 | 5 | 1 | 1.17 |
| **Goat cheese** | `cmptowali00pds601pr4jz6a4` | Cheese Goat | Dairy | each | 2757 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0.27 | 0 |
|  | `cmoqfbmv800769ky25b6yzxwy` | CHEESE GOAT LOG 1KG (Meredith) EA (12) | Dairy | each | 2750 | 5 | 0 (StA 2026-08-31) |  | 8 | 2 | – | 0 |
| **Halloumi** | `cmptowaly00pgs6019u3x1oam` | Cheese Halloumi | Dairy | each | 1700 | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 5 | 0 |
|  | `cmoqfbmw200789ky27ikcdibq` | CHEESE HALOUMI 750GM (Cypriana) EA (5) | Dairy | each | 1700 | 7 | 0 (StA 2026-08-31) |  | 15 | 2 | 1 | 0 |
| **Mozzarella shredded** | `cmsdf12rw000imij91dwkil8m` | Cheese Mozzarella Shredded | Dairy | kg | 1150 | 3 | 2.01 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1 | 0 |
|  | `cmoqfbmwx007a9ky2w7ppq6vh` | CHEESE MOZZARELLA SHREDDED 2KG (Cheese King) EA (6) | Dairy | each | 1150 | 7 | 0 (StA 2026-08-31) |  | 7 | 5 | 1 | 0 |
| **Cream thickened** | `cmptowand00pps601bmioxrei` | Cream Thickened | Dairy | each | 744 | 8 | 800 (AA 2026-10-01) | ✓ AA | 0 | 0 | 2.71 | 0 |
|  | `cmoqfbnpa00929ky2436p4gg7` | CREAM THICK FRESH 5LT (Dairy Farmers) EA (3) | Dairy | each | 3720 | 8 | 0.24 (StA 2026-08-31) |  | 8 | 12 | 0.3 | 0.45 |
| **Condensed milk** | `cmptowao600pvs601zrhsle1i` | Milk Condensed | Dairy | each | 366 | 7 | 0 (StA 2026-08-31) |  | 0 | 0 | 5.42 | 0 |
|  | `cmoqfbng7008i9ky2de5tltvx` | CONDENSED MILK 395GM (Nestle) EA (12) | Dairy | each | 400 | 7 | 0 (StA 2026-08-31) |  | 10 | 3 | 7 | 0 |

**Meat & seafood**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Beef chuck roll**<br>_YG item avgCost 12400c/kg looks like a per-piece cost_ | `cmptowbmp00w4s60158syh5ra` | Beef Chuck Roll | Meat | kg | 2050 | 8 | 0 (StA 2026-08-31) |  | 3 | 0 | 0 | 0 |
|  | `cmoqfbu8y00o09ky2md6lkxv9` | YG BEEF CHUCK ROLL | Meat | kg | 12400 | 2 | 0 (StA 2026-08-31) |  | 0 | 1 | – | 2.76 |
| **Beef short ribs 3-rib** | `cmptowbnz00was601c2hr91o3` | Beef Short Ribs Grainfed 3rib | Meat | kg | 2589 | 8 | 0 (StA 2026-08-31) |  | 0 | 0 | 8.97 | 0 |
|  | `cmoqfbm1m005a9ky2bo078h4b` | BEEF SHORT RIBS GRAINFED 3 RIB | Meat | kg | 5180 | 11 | 0 (StA 2026-08-31) |  | 12 | 2 | 0 | 24.59 |
| **Chicken thigh fillet skin off**<br>_the "(Pack of 5kg)" item has avgCost 6750c/kg, i.e. a per-pack cost_ | `cmptowboz00wds601urh3ubcf` | Chicken Thigh Fillet Skin Off | Meat | kg | 1820 | 8 | 3.97 (StA 2026-08-31) |  | 0 | 1 | 0 | 3.97 |
|  | `cmoqfbmzg007g9ky2i997b2mv` | CHICKEN THIGH FILLETS SKIN OFF | Meat | kg | 1850 | 13 | 0 (StA 2026-08-31) |  | 4 | 6 | 6.07 | 2.88 |
|  | `cmoqfbt2200la9ky2nxnixo13` | THIGH FILLET SKIN OFF (Pack of 5kg) | Meat | kg | 6750 | 2 | 0 (StA 2026-08-31) |  | 3 | 0 | – | 0 |
| **Barramundi fillets** | `cmptowbr900wos6017aiqhusr` | Barramundi Fillets | Sea | kg | 1740 | 8 | 4.22 (AA 2026-10-01) | ✓ AA | 2 | 0 | 5 | 3.5 |
|  | `cmoqfblvg004w9ky2n36m6wkg` | BARRAMUNDI FILLETS IMP 200/300 S/OFF 5KG (Trading) CTN | Sea | kg | 1740 | 5 | 0 (StA 2026-08-31) |  | 29 | 3 | 1.07 | 0 |
| **Prawn meat raw** | `cmptowbsd00wus601fjwi5dv2` | Prawn Meat Raw | Sea | kg | 1800 | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 2 | 0 |
|  | `cmoqfbrxd00iq9ky2o4v4ecmh` | PRAWN MEAT RAW VANNAMEI 31/40 700GM (Trading) EA (10) | Sea | kg | 1800 | 5 | 0 (StA 2026-08-31) |  | 7 | 2 | 4 | 0 |
| **Salmon fillet sashimi skin on** | `cmptowbsy00wxs601gf9775f0` | Salmon Fillet Sashimi Skin On | Sea | kg | 3749 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 2.3 | 0 |
|  | `cmoqfbs8z00jg9ky29fx7kh7f` | SALMON FILLET S/ON TASI SASHIMI 1.5-2KG  (Huon) | Sea | kg | 3450 | 4 | 0 (StA 2026-08-31) |  | 14 | 4 | 0 | 0 |

**Produce**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Jerusalem artichoke box** | `cmoqfblq9004k9ky2vnlgxlge` | ARTICHOKE JERUSALEM box (5kg) | Prod | each | 9240 | 5 | 0 (StA 2026-08-31) |  | 0 | 3 | 0 | 0 |
|  | `cmptowbti00x0s6014liq439s` | Artichokes Jerusalem Box | Prod | each | – | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
| **Cabbage** | `cmsdf12xa003umij9s7ng4m59` | Cabbage | Prod | each | 380 | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 1.47 | 0 |
|  | `cmoqfbmd600609ky2c4s5av0d` | Cabbage Each | Prod | each | 580 | 11 | 0 (StA 2026-08-31) |  | 9 | 1 | 1 | 0 |
| **Red cabbage** | `cmsdf12xg0040mij9918ebd7f` | Cabbage Red | Prod | each | 380 | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 1.47 | 0 |
|  | `cmoqfbme100629ky2jjom0w39` | Cabbage Red Each | Prod | each | 660 | 9 | 0 (StA 2026-08-31) |  | 5 | 3 | 1 | 0 |
| **Dill** | `cmoqfbnx3009k9ky2oav6wpwa` | Dill | Prod | each | 200 | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 2 | 0 |
|  | `cmptowbho00v8s6015b4wn135` | Dill Bunch | Prod | bunch | 285 | 6 | 1 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1 | 0 |
| **Forage mix 100 g** | `cmoqfbor200bg9ky28wllsmib` | Forage Fresh Mix (100 gram) | Prod | each | 950 | 5 | 0 (StA 2026-08-31) |  | 0 | 7 | 0 | 0 |
|  | `cmsdf12xr004cmij9mhw0pbqj` | Fresh Mix Forage | Prod | each | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmptowc2500yjs601gm9rr4jb` | Fresh Mix Forage 100g | Prod | each | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | – | 0 |
| **Lemons** | `cmoqfbpyi00e89ky2urre7k75` | Lemon | Prod | each | 0 | 5 | 0 (StA 2026-08-31) |  | 0 | 3 | – | 0 |
|  | `cmptowbc600uas60153yp9m4d` | Lemons Large | Prod | each | – | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
| **Baby gem lettuce box** | `cmoqfbq1200ee9ky2042yw00x` | Lettuce Baby Gem 20s Box | Prod | each | 3800 | 9 | 6 (AA 2026-10-01) | ✓ AA | 10 | 2 | 0.25 | 0.3 |
|  | `cmptowc3f00yss601gseoxsmb` | Lettuce Baby Gem Box | Prod | each | 169 | 8 | 0 (StA 2026-08-31) |  | 1 | 0 | 8 | 0 |
| **Pineapple each**<br>_Topless pineapple (oqfbrq500ia) is separate_ | `cmsdf12w10030mij9a0dwbce3` | Pineapples | Prod | each | 712 | 3 | 1 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.53 | 0 |
|  | `cmoqfbrp900i89ky2kbhso2bu` | Pineapples Each | Prod | each | 580 | 10 | 0 (StA 2026-08-31) |  | 13 | 2 | 2 | 0 |
| **Tomatillos canned** | `cmoqfbt6e00lk9ky2s49xhsub` | TOMATILLOS A10 GREEN TOMATO (Faro) EA (6) | Prod | each | 1350 | 10 | 36 (StA 2026-08-31) |  | 11 | 8 | 0.8 | 36.28 |
|  | `cmptowb6i00tas601fb42rtbn` | Tomatillos Green Can | Prod | each | 1350 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 1 | 0 |
| **Cherry tomatoes** | `cmptowc7t00zls601u3qyp57t` | Tomatoes Cherry | Prod | each | 300 | 6 | 0 (StA 2026-08-31) |  | 3 | 0 | 3 | 0 |
|  | `cmoqfbt8500lo9ky2qysewf8z` | TOMATO CHERRY 400GM (Chefs Choice) EA (12) | Prod | each | 220 | 5 | 0 (StA 2026-08-31) |  | 0 | 2 | – | 0 |
| **Medley tomatoes** | `cmptowc4700yys601clclnxhr` | Medley Tomatoes | Prod | each | – | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbtdc00m09ky2ttwijl3l` | Tomatoes Medley 200 Punnets | Prod | punnet | 350 | 3 | 0 (StA 2026-08-31) |  | 0 | 1 | – | 0 |

### 4b. Possible duplicates (44 clusters)

**Tequila & mezcal**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **El Jolgorio Pechuga (Black Yellow)**<br>_"Black Yellow" may be a separate label/edition — confirm on the shelf_ | `cmptovvxz009us601wl8ua8zq` | El Jolgorio Pechuga (Black Yellow) | T&M | bottle | 20277 | 5 | 0.7 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.7 | 0.7 |
|  | `cmptovvyb009xs6016axnnhxj` | El Jolgorio Pechuga (Yellow) | T&M | bottle | 29551 | 10 | 0.1 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0.7 | 0.2 |
| **Cascahuin Reposado**<br>_700 mL bottle vs a 4x375 mL pack; same liquid, different pack_ | `cmsdf10qy0093miiou0t2xgs8` | Cascahuin Resposado | SpO | bottle | 9318 | 5 | 0.7 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.7 |
|  | `cmsdf10qp008xmiiossa0j9qq` | Cascahuin Reposado (4x375mL) | SpO | bottle | 29177 | 5 | 0.75 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.75 |

**Other spirits**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Lyre's Orange Sec / Triple Sec**<br>_Lyre's sells its triple-sec analogue as "Orange Sec"_ | `cmptovwf500dls601h14lq2ra` | Lyres Orange Sec | NA | each | 2976 | 10 | 1 (AA 2026-10-01) | ✓ AA | 0 | 0 | 7.35 | 0 |
|  | `cmoqfbq7100es9ky295pz087i` | LYRES TRIPLE SEC 700ML BOTTLE | Liq | bottle | 3519 | 10 | 0.01 (AA 2026-09-01) |  | 0 | 3 | 1 | 2.19 |
| **Manly Coastal Stone**<br>_Single Malt vs Xplore Blend are different; "Coastal Stone Whiskey" (500 mL) matches one of them_ | `cmsdf10r60099miio00mu5vvb` | Coastal Stone Whiskey | SpO | bottle | 6265 | 5 | 0.1 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 0.2 |
|  | `cmsdf10vn00cfmiiozgitzp16` | MANLY SPIRITS COASTAL STONE SINGLE MALT | SpO | bottle | – | 3 | 0 (StA 2026-08-03) |  | 0 | 0 | – | 0 |
|  | `cmsdf10vv00clmiio0xnm8t8i` | MANLY SPIRITS COASTAL STONE XPLORE BLEND | SpO | bottle | 5323 | 5 | 0.8 (StA 2026-10-01) | ✓ StA | 0 | 0 | – | 1.26 |
| **Manly Australian Dry Gin bulk**<br>_both 20 L of ADG; one filed under Beer & Cider_ | `cmsdf10ac0009miiooz0labvx` | ADG 20L Cube - 20L - 40% ABV (ADG-20L) | Beer | each | – | 3 | 0 (StA 2026-08-03) |  | 0 | 0 | – | 0 |
|  | `cmoqfbqah00f09ky2lwzzszmq` | Manly Spirits Bulk 20Ltr Australian Dry Gin 1 x 20ltr Drum | SpO | gram | 7 | 28 | 18.1 (AA 2026-10-01) | ✓ AA | 0 | 15 | 0.5 | 0.78 |
| **Triple sec 20 L bulk**<br>_TSEC "NoSugar" may be the Manly No Sugar line — different product if so_ | `cmoqfbtik00mc9ky2871h92mv` | TSEC 20L (NoSugar) - 20L - 20% ABV | Liq | L | 68000 | 12 | 1.7 (StA 2025-12-31) |  | 0 | 0 | 1.05 | 0.01 |
|  | `cmoqfbtf400m49ky2a0orrz04` | Triple SEC 20L - 20% ABV | Spirits | L | 3000 | 30 | 8.9 (StA 2025-12-31) |  | 0 | 11 | 4.4 | 7.6 |

**Non-alcoholic & mixers**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Giffard Strawberry (Fraise) 6pk**<br>_"FRASIS SYRUP 6PK" looks like a truncated supplier line for the same syrup_ | `cmsdf10g1001rmiiowqgdccbj` | GIFFARD STRAWBERRY FRASIS SYRUP 6PK : 100 | Liq | bottle | – | 3 | 0 (StA 2026-08-03) |  | 0 | 0 | – | 0 |
|  | `cmsdf10iz003rmiio5evtegxv` | Giffard Strawberry Syrup | NA | bottle | 2350 | 5 | 2.2 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 0 | 2.25 |
| **Apple Juice**<br>_1 L vs 2 L bottle — may be a pack change_ | `cmptovv0p0033s6019qlmle2x` | Apple Juice | NA | each | 665 | 7 | 3 (StA 2026-10-01) | ✓ AA/StA | 2 | 1 | 2 | 1.7 |
|  | `cmsdf10h0002fmiio0ebywz1g` | Apple Juice Bottle | NA | each | 700 | 3 | 1.4 (StA 2026-08-03) |  | 0 | 0 | – | 1.4 |
| **Grapefruit Juice**<br>_1 L vs 2 L bottle_ | `cmptovv5b003xs601fqpmghzr` | Grapefruit Juice | NA | each | 750 | 13 | 1 (StA 2026-10-01) | ✓ AA/StA | 0 | 2 | 0 | 0 |
|  | `cmsdf10j8003xmiiof5na37su` | Grapefruit Juice Bottle | NA | each | – | 3 | 0 (AA 2026-09-01) |  | 0 | 0 | 0 | 0 |

**Beer**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Freshwater Brewing kegs**<br>_generic "Freshwater Brewing Keg" plus two Hazy Pale kegs_ | `cmoqfbouh00bo9ky2cw59grj4` | Freshwater Brewing Keg | Beer | keg | 30250 | 2 | – |  | 0 | 3 | – | – |
|  | `cmptovupo000us601bx6i2hjl` | Freshwater Brewing Hazy Pale Keg | Beer | keg | 27000 | 8 | 0 (StA 2026-08-03) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbsjv00k49ky2xjcdyti7` | Secrets Hazy Pale Keg | Beer | keg | 27000 | 12 | 2.2 (StA 2025-12-31) |  | 0 | 7 | 0.9 | 1.8 |
| **Heaps Normal**<br>_invoice case item doesn't say which beer_ | `cmoqfbph800d49ky2azdg1s27` | HEAPS NORMAL CAN - (CASE OF 24) | Beer | can | 229 | 14 | 27 (StA 2025-12-31) |  | 1 | 2 | 21 | 47 |
|  | `cmptovum3000as601zbxhbfyt` | Heaps Normal Another Lager | Beer | bottle | 222 | 8 | 20 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 57 | 33 |
|  | `cmptovumn000ds601vvr3abs2` | Heaps Normal Quiet XPA | Beer | bottle | 222 | 10 | 15 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 15 | 9 |

**Wine (floor bottle vs invoice case item of the same wine)**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Teusner Wark Family Shiraz**<br>_2022 and 2023 are legitimately separate; the undated floor item duplicates whichever is current (avgCost 1383 is closest to the 2023)_ | `cmoqfbkdv001i9ky2leqkwvfo` | 2022 Teusner 'Wark Family' Shiraz (Case of 12) | Red | bottle | 1695 | 8 | 0 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 15 |
|  | `cmoqfbkvm002m9ky2rzyybxgs` | 2023 Teusner 'Wark Family' Shiraz (Case of 12) | Red | bottle | 1400 | 8 | 0 (AA 2026-10-01) | ✓ AA | 0 | 3 | 5.5 | – |
|  | `cmptovvgk0063s601zzglvf6w` | Teusner Wark Family Shiraz | Red | bottle | 1383 | 5 | 14.9 (AA 2026-10-01) | ✓ AA | 0 | 0 | 8.9 | 15.2 |
| **BenMarco Malbec**<br>_floor item "Valle de Uco Malbec" most likely = the 2022 Valle de Uco, not the standard Malbec_ | `cmoqfbk55000y9ky20svo5cq9` | 2022 BenMarco Malbec (Case of 6) | Red | bottle | 1975 | 7 | 2.4 (StA 2026-08-31) |  | 0 | 6 | 13.8 | 2.4 |
|  | `cmoqfbk6000109ky29ce36o1h` | 2022 BenMarco Valle de Uco (Case of 6) | Red | bottle | 2293 | 9 | 22.4 (StA 2025-12-31) |  | 0 | 3 | – | 10 |
|  | `cmptovvay004xs6011coyxzcw` | BenMarco Valle de Uco Malbec | Red | bottle | 2385 | 10 | 12 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | 7 | 12.9 |
| **Schlumberger Grand Cru Riesling**<br>_Saering is a Grand Cru Riesling; likely the same wine_ | `cmoqfbk1q000q9ky2z6a2gq4s` | 2021 Domaine Schlumberger Saering Grand Cru Alsace (Case of 6) | White | bottle | 4752 | 19 | 0 (AA 2026-10-01) | ✓ AA | 0 | 7 | – | 2 |
|  | `cmsdf10zt00f9miioamtvce1q` | Domaines Schlumberger Grand Cru Riesling | White | bottle | 4341 | 5 | 8 (StA 2026-10-01) | ✓ AA/StA | 0 | 0 | – | 8 |
| **Colette Rose**<br>_"Cuvee Colette" vs "La Belle Colette"; invoice cost 10200c looks like a case cost_ | `cmoqfbnug009e9ky2xcl291f9` | Cuvée Colette Rosé 2024 (Case of 6) | Rosé | bottle | 10200 | 22 | 0 (AA 2026-10-01) | ✓ AA | 0 | 6 | 3.7 | 18.4 |
|  | `cmptovvej005os601929ne9g2` | La Belle Colette Rose | Rosé | bottle | 1964 | 8 | 7.25 (AA 2026-10-01) | ✓ AA | 0 | 0 | 0.4 | 0 |

**Kitchen: dry, pantry, herbs and spices**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Salt flakes**<br>_probably the same sea salt flakes_ | `cmptowb3800sps601994a7sjm` | Salt Flakes | Dry | each | – | 6 | 500 (AA 2026-10-01) | ✓ AA | 2 | 0 | 0 | 0 |
|  | `cmsdf12uj0020mij9cpu2un4t` | Sea Salt Flakes | Dry | each | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
| **Dried thyme** | `cmptowbm700w1s601v69vps2z` | Thyme Dried | Dry | each | 4000 | 5 | 0 (StA 2026-08-31) |  | 0 | 0 | 0.1 | 0 |
|  | `cmoqfbt4p00lg9ky2n6pigdc8` | THYME LEAVES 200GM (Natures Secret) EA | H&S | each | 800 | 4 | 0 (StA 2026-08-31) |  | 1 | 4 | 1 | 0.3 |
| **Agave nectar organic**<br>_different supplier brand, same use_ | `cmoqfbqof00fw9ky2w901tx6l` | NECTAR AGAVE ORGANIC 4LT (Chefs Choice) EA (2) | O&C | each | 4800 | 4 | 1 (AA 2026-10-01) | ✓ AA | 0 | 1 | – | 0 |
|  | `cmoqfbld6003q9ky2v4i89e7q` | Agave Syrup Clear (4L) | O&C | each | 5670 | 5 | 0 (StA 2026-08-31) |  | 0 | 4 | 1 | 0 |
| **Chipotle in adobo**<br>_two brands (San Marcos, Faro); floor item matches one of them_ | `cmptowar500qgs6017lhxa9vq` | Chilli Choptle in Adobo | O&C | each | 1846 | 5 | 2 (StA 2026-08-31) |  | 0 | 0 | 1.3 | 2 |
|  | `cmoqfbn5w007u9ky2aburyk6t` | Chipotle Chillis in adobo sauce  2.8KG-SAN MARCOS | O&C | each | 2030 | 13 | 0 (StA 2026-08-31) |  | 0 | 0 | 0.95 | 0 |
|  | `cmoqfbn51007s9ky24h5tiwej` | CHIPOTLE CHILLIS A10 IN ADOBE SCE 3KG (Faro) EA (6) | Prod | each | 1850 | 7 | 0 (StA 2026-08-31) |  | 6 | 6 | 1 | 0.24 |
| **Mayonnaise whole egg**<br>_10 kg vs 15 kg pails_ | `cmptowav600r7s601h67jhrcs` | Mayonnaise Whole Egg | O&C | each | 842 | 8 | 1 (AA 2026-10-01) | ✓ AA | 0 | 0 | 6.11 | 0 |
|  | `cmoqfbqdy00f89ky256isxr5a` | MAYONNAISE WHOLE EGG 10KG (Birch & Waite) EA | O&C | each | 9200 | 3 | 0 (StA 2026-08-31) |  | 9 | 2 | 1 | 0 |
|  | `cmoqfbqet00fa9ky29uv7olue` | MAYONNAISE WHOLE EGG 15KG (Birch & Waite) EA | O&C | each | 11700 | 5 | 0.2 (StA 2026-08-31) |  | 0 | 2 | – | 0.92 |
| **White vinegar**<br>_two brands/sizes_ | `cmptowb8d00tms601mt1fnshi` | Vinegar White | O&C | each | 108 | 8 | 0 (StA 2026-08-31) |  | 0 | 0 | 2.15 | 0 |
|  | `cmoqfbtor00mq9ky2jb7tdpcq` | VINEGAR WHITE 4LT (Edlyn) EA (3) | O&C | each | 430 | 5 | 6 (StA 2026-08-31) |  | 30 | 2 | 3 | 6 |
|  | `cmoqfbtpm00ms9ky2ozn764ck` | VINEGAR WHITE 5LT (Menu Master) EA (3) | O&C | each | 750 | 4 | 0 (StA 2026-08-31) |  | 0 | 1 | – | 0 |
| **Corn tortilla** | `cmptowajj00p1s601zwo9pc7k` | Tortilla Corn | Bak | each | 17 | 6 | 1700 (AA 2026-10-01) | ✓ AA | 0 | 2 | 2.15 | 0 |
|  | `cmoqfbjtt000a9ky24c2sd33w` | 12cm Yellow Corn Tortilla 4.5 | Bak | each | 18 | 11 | 928 (StA 2026-08-31) |  | 0 | 8 | 0.9 | 928 |

**Dairy**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Eggs dozen**<br>_free-range vs caged may matter_ | `cmptowbqp00wls601bcwq8o9w` | Eggs Dozen | Dairy | each | 676 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 1.62 | 0 |
|  | `cmoqfbo5100a29ky24at71nph` | Eggs 700g Free Range Dozen | Dairy | each | 63 | 5 | 0.5 (AA 2026-10-01) | ✓ AA | 8 | 2 | – | 7 |
|  | `cmoqfbo5x00a49ky2ntwtoqo6` | Eggs 700g Packet Dozen | Dairy | each | 500 | 5 | 0 (StA 2026-08-31) |  | 0 | 2 | 2 | 0 |
| **Milk**<br>_"Milk" may be fresh milk, not UHT_ | `cmptowanu00pss601m30z8h5i` | Milk | Dairy | each | – | 4 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbqj600fk9ky2fccjfmi6` | MILK LONG LIFE UHT 1LT (Devondale) EA (10) | Dairy | each | 265 | 7 | 2 (StA 2026-08-31) |  | 18 | 4 | – | 8.17 |

**Meat & seafood**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Chorizo**<br>_two brands (Don's vs Rodriguez)_ | `cmoqfbn8g00809ky2hws596tc` | CHORIZO DON'S | Meat | kg | 3950 | 5 | 0 (StA 2026-08-31) |  | 0 | 2 | – | 0 |
|  | `cmptowbps00wgs601jibnyb8m` | DELI CHORIZO RODRIGUEZ | Meat | kg | 1980 | 7 | 3 (StA 2026-08-31) |  | 11 | 0 | 0 | 3 |
| **Scallops 10/20**<br>_two suppliers_ | `cmoqfbsh800jy9ky23564k75d` | SCALLOPS 10/20 CHINA R/OFF 1KG (Trading) EA (10) | Sea | kg | 4400 | 3 | 0 (StA 2026-08-31) |  | 1 | 1 | 4 | 0 |
|  | `cmoqfbsi300k09ky2la980j49` | SCALLOPS IQF 10/20 R/OFF 1KG (Shark Bay) | Sea | kg | 8200 | 2 | 0 (StA 2026-08-31) |  | 0 | 1 | – | 0 |

**Produce**

| Cluster | id | name | cat | count unit | avg ¢ | ST lines | last non-null count | on 1 Oct sheet | inv lines | recipe lines | AA onHand | StA onHand |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Avocado** | `cmsdf12vj002omij9vsz913bw` | Avocadoes Hass | Prod | each | 3197 | 3 | 1.47 (AA 2026-10-01) | ✓ AA | 0 | 0 | 4.28 | 0 |
|  | `cmoqfblrz004o9ky2ykw85p9k` | Avocadoes Hass Tray | Prod | each | 3373 | 14 | 1 (StA 2026-08-31) |  | 30 | 10 | 1.34 | 1 |
| **Carrots**<br>_each vs kg_ | `cmoqfbmnj006o9ky2pgijhsw1` | Carrots Medium | Prod | each | 264 | 10 | 0 (StA 2026-08-31) |  | 0 | 2 | 1.41 | 0.01 |
|  | `cmoqfbmoe006q9ky21usudrpz` | Carrots Medium Kg | Prod | kg | 225 | 5 | 0 (StA 2026-08-31) |  | 13 | 3 | – | 0 |
| **Cauliflower** | `cmptowbw500xfs601ppoxp9ec` | Cauliflower | Prod | each | 641 | 4 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmsdf12xm0046mij9izcl4nec` | Cauliflower Box | Prod | box | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbmq3006u9ky2moifslkb` | Cauliflower Each | Prod | each | 480 | 7 | 7 (AA 2026-10-01) | ✓ AA | 10 | 3 | 1 | 3.67 |
| **Habanero** | `cmptowbxs00xns601unt5kb3h` | Chilli Habenero | Prod | each | – | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmptowby500xqs6019ah8bfp2` | Chilli Habenero Kg | Prod | kg | – | 5 | 0 (StA 2026-08-31) |  | 1 | 0 | 0 | 0 |
| **Jalapeno** | `cmptowbyi00xts6015io2wrtg` | Chilli Jalapeno | Prod | each | 905 | 8 | 0.25 (StA 2026-08-31) |  | 0 | 0 | 1.15 | 0.25 |
|  | `cmoqfbn0r007i9ky28na6sixk` | Chilli Jalapeno Kg | Prod | kg | 1400 | 8 | 0 (StA 2026-08-31) |  | 13 | 17 | 2.39 | 0.01 |
| **Poblano** | `cmptowbyz00xws60151owtgis` | Chilli Poblano | Prod | each | – | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbn3c007o9ky2xlb42tz4` | Chilli Poblano Kilo | Prod | kg | 1750 | 3 | 0 (StA 2026-08-31) |  | 0 | 2 | – | 0 |
| **Coriander**<br>_bunch vs dozen_ | `cmpvekw8t0003s601oasm0oy8` | Coriander Bunch | Prod | bunch | 238 | 4 | 0.25 (AA 2026-10-01) | ✓ AA | 21 | 0 | – | 0 |
|  | `cmoqfbnit008o9ky2rf1uo52e` | Coriander Dozen | Prod | dozen | 20 | 14 | 0 (StA 2026-08-31) |  | 4 | 18 | 16.63 | 3.73 |
| **Cucumber Qukes** | `cmptowbzp00y1s601sgs2p9p8` | Cucumber Quks | Prod | each | 350 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 2 | 0 |
|  | `cmoqfbnq600949ky2ivt75r59` | Cucumber Quks Punnet | Prod | punnet | 380 | 8 | 0 (StA 2026-08-31) |  | 1 | 9 | 1 | 0 |
| **Eggplant** | `cmoqfbo3a009y9ky2x2kxp7xc` | Eggplant Box | Prod | each | 2280 | 2 | 0 (StA 2026-08-31) |  | 0 | 1 | – | 0 |
|  | `cmoqfbo4600a09ky2odh8g249` | Eggplant Kg | Prod | kg | 580 | 4 | 0 (StA 2026-08-31) |  | 0 | 2 | – | 0 |
| **Grapefruit ruby** | `cmptowbbr00u7s60121eayt8c` | Grapefruit Ruby | Prod | each | – | 8 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmoqfbpem00cy9ky28ktxl8py` | Grapefruit Ruby Kg | Prod | kg | 361 | 7 | 3 (StA 2026-08-31) |  | 15 | 1 | – | 3 |
| **Red capsicum** | `cmoqfbmkz006i9ky21eucn5r4` | Capsicum Red Large Kg | Prod | kg | 580 | 2 | 0 (StA 2026-08-31) |  | 1 | 2 | – | 0.24 |
|  | `cmptowc2z00yps601jhtt7c7q` | Large Red Capsicum | Prod | each | 715 | 6 | 0 (StA 2026-08-31) |  | 0 | 0 | 1 | 0 |
| **Limes**<br>_5 kg vs 10 kg boxes_ | `cmsdf12vr002umij9z3kq63op` | Limes | Prod | kg | 4557 | 3 | 5.8 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.13 | 0 |
|  | `cmptowbck00uds601sic2zeo5` | Limes 5kg Box | Prod | kg | 675 | 7 | 1.49 (StA 2026-08-31) |  | 5 | 0 | 2.13 | 1.49 |
|  | `cmoqfbq4h00em9ky277nydo2i` | Limes Volume Box 10kg | Prod | kg | 770 | 10 | 0 (StA 2026-08-31) |  | 4 | 18 | 0.38 | 0 |
| **Mesclun** | `cmoqfbqfo00fc9ky2vrdi81pw` | Mesculin Gold Mix 1.5kg Box | Prod | each | 2800 | 6 | 0.4 (StA 2026-08-31) |  | 5 | 1 | 0 | 0.4 |
|  | `cmsdf12xv004imij9i61y7yr9` | Mesculin Gold Mix Box | Prod | kg | – | 3 | 0 (StA 2026-08-31) |  | 0 | 0 | 0 | 0 |
|  | `cmptowc4w00z4s601oluv35mi` | Mesculin Greens Mix | Prod | each | 1167 | 8 | 800 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1.2 | 0 |
| **Brown onions** | `cmptowc5p00z7s6012errl49s` | Onions Brown | Prod | each | 142 | 8 | 11 (AA 2026-10-01) | ✓ AA | 0 | 0 | 15.39 | 0 |
|  | `cmoqfbr8s00h69ky2mqpn80eh` | Onions Brown Med-Lge 10kg Bag | Prod | kg | 195 | 7 | 0 (StA 2026-08-31) |  | 13 | 32 | 1 | 5.04 |
| **Spanish onions** | `cmoqfbr7x00h49ky2190jl5mi` | ONION SPANISH kg | Prod | kg | 560 | 6 | 0.97 (AA 2026-10-01) | ✓ AA | 0 | 4 | 15.67 | 0 |
|  | `cmptowc6600zas601i90aolcq` | Onions Spanish | Prod | each | 2802 | 8 | 0 (StA 2026-08-31) |  | 0 | 0 | 3.8 | 0 |
|  | `cmoqfbr9m00h89ky2axze22b1` | Onions Spanish Large Bag | Prod | each | 3200 | 6 | 0 (StA 2026-08-31) |  | 7 | 14 | – | 2.56 |
| **Oranges** | `cmptowbd200ugs601jay6ugcn` | Oranges Large | Prod | each | 474 | 6 | 5 (AA 2026-10-01) | ✓ AA | 0 | 0 | 1 | 0.58 |
|  | `cmoqfbrah00ha9ky2fddes2jr` | Oranges Large Kg | Prod | kg | 428 | 5 | 0 (StA 2026-08-31) |  | 8 | 3 | – | 0 |
| **Strawberries punnet** | `cmoqfbsuf00ks9ky2t84r95io` | Strawberries Extra Lge Punnet | Prod | punnet | 450 | 4 | 0 (StA 2026-08-31) |  | 0 | 1 | 1 | 0 |
|  | `cmptowbej00ups60149firyd2` | Strawberries Large Punnet | Prod | punnet | 450 | 8 | 0 (StA 2026-08-31) |  | 16 | 0 | 2 | 0 |
| **Tomatoes large** | `cmptowc7c00zis601hpou3t4s` | Tomatoes | Prod | each | 3982 | 6 | 2.21 (AA 2026-10-01) | ✓ AA | 0 | 0 | 10.55 | 0 |
|  | `cmoqfbtch00ly9ky24k97oeb6` | Tomatoes Large Box | Prod | each | 3550 | 6 | 0.47 (StA 2026-08-31) |  | 10 | 12 | – | 0.76 |
|  | `cmoqfbt7900lm9ky2nx5k7g6p` | TOMATO box LRG (10kg) | Prod | each | 6480 | 5 | 0 (StA 2026-08-31) |  | 0 | 7 | 1 | 0.43 |

---

## 5. Naming inconsistencies

### Observed patterns (active items)

| Pattern | Count | Example |
|---|---|---|
| ALL-CAPS supplier-invoice names | 233 (179 are duplicate twins) | `PATRON SILVER 700 ML BOTTLE` |
| "(Case of N)" / "- (CASE OF N)" suffix | 64 | `2022 Teusner 'Wark Family' Shiraz (Case of 12)`, `SUPASAWA 700ML - (CASE OF 6)` |
| Leading vintage | 42 | `2023 Red Claw Pinot Noir (Case of 6)` |
| Trailing vintage | 7 wines | `Rockford Basket Press Shiraz 2017`, `A Rodda Tempranillo 2023 (Case of 12)` |
| Size or pack in the name | 251 | `… 700ML BOTTLE`, `HENDRICKS GIN : 700 ml`, `… EA (12)`, `… CTN`, `Lime Juice (1 x 5L)` |
| Supplier pack counts and brands in parentheses | ~130 | `(Natures Secret) EA (12)` |
| PDF ligature breaks ("fi " / "fl ") | 3 | `Glen fi ddich`, `Monte fi li`, `Elder fl ower` |
| Invoice text pasted into the name | 1 | `KINGFISH WHOLE … Ordered: 3 KG, Supplied Qty: 5.4 KG, Reason for adjustment: Random Weight` |

### Proposed standard

1. **Title Case**, no ALL-CAPS.
2. **Bar products:** `Brand Expression` (for example "Patron Silver" or "El Jolgorio Espadin"). Put no size in the name when it matches the house standard (spirits 700 mL, wine 750 mL). Add a size only when a non-standard size exists alongside it or is the norm for that product: `Jameson Irish Whiskey 1L`, `Greywacke Sauvignon Blanc 375ml`, `Cointreau 1L`. The size itself belongs in `measurePerCountUnit`.
3. **Wine:** `Producer 'Cuvée' Variety/Region YYYY`, with the vintage **trailing** ("NV" for non-vintage).
   - Trailing keeps a producer's wines together when sorted and matches the 7 existing trailing-vintage items.
   - It also lets an undated floor name become the vintage name just by appending the year.
   - Drop "(Case of N)". Case size is a supplier pack attribute and belongs in the invoice alias / pack conversion, not the item.
4. **Kitchen:** generic noun first, then descriptor, then pack and brand: `Sugar White 1kg (CSR)`, `Cheese Ricotta 500g (Perfect)`. This matches the existing floor style ("Oil Olive Extra Virgin", "Sugar Caster").
   - Drop the supplier carton notation (`EA (12)`, `CTN`, `14 X`).
   - Keep the pack weight only when it changes the count unit, as with 1 kg vs 12.5 kg flour.
5. **Spelling:** Australian, with accents normalised to ASCII ("Anejo", "Cuvee"), applied the same way everywhere.
6. **Duplicate twins:** don't rename the twin you'll retire. Rename only the survivor if its floor name breaks the standard (see the duplicate-survivor rows below).

### Proposed renames (do not apply; for review)

**Typos and ligature breaks**

| id | current | proposed |
|---|---|---|
| `cmptovw6u00bus6018sk0oul2` | Glen fi ddich 12yo Whiskey | Glenfiddich 12YO *(duplicate; the survivor takes this name)* |
| `cmptovvfb005us601ey8hngj9` | Monte fi li Chianti Classico | Montefili Chianti Classico *(check the producer spelling against the invoice)* |
| `cmptovuxu002is601p28s76xg` | Massenez Elder fl ower Liqueur | Massenez Elderflower Liqueur |
| `cmsdf10mb005xmiiod0q42oc0` | Cheateau La Grave Figeac St Emilion Grand Cru | Chateau La Grave Figeac St Emilion Grand Cru |
| `cmsdf112m00grmiio74dfoegu` | Papa Pandas Rising Reisling | Papa Pandas Rising Riesling |
| `cmoqfbktt002i9ky2eer32l96` | 2023 Shut The Gate For Freedom Gewurtztraminer (Case of 12) | Shut The Gate For Freedom Gewurztraminer 2023 |
| `cmoqfbkyz002u9ky20vuy0jlx` | 2024 Domaine Thompson Explorer Pinot Noir (Case of 12) | Domaine Thomson Explorer Pinot Noir 2024 |
| `cmoqfbkha001q9ky2i2jsan2s` | 2023 Bonnet & Cotton Beaujolais Rogue (Case of 12) | Bonnet & Cotton Beaujolais Rouge 2023 |
| `cmoqfbkd1001g9ky2nksoxut4` | 2022 Stephane Brocard Gevrey-Chambertin Vielles Vignes (Case of 6) | Stephane Brocard Gevrey-Chambertin Vieilles Vignes 2022 |
| `cmoqfbt2x00lc9ky2bdi99n44` | THOQUINO CACACHA 700ML BOTTLE | Thoquino Cachaca *(duplicate)* |
| `cmptovwdt00dcs601w04plil2` | Lagrimas de Delores | Lagrimas de Dolores Joven |
| `cmsdf10qy0093miiou0t2xgs8` | Cascahuin Resposado | Cascahuin Reposado |
| `cmptovwc800d0s6012k2dx620` | Koch Artesenal Espadin | Koch Artesanal Espadin |
| `cmptowar500qgs6017lhxa9vq` | Chilli Choptle in Adobo | Chilli Chipotle in Adobo |
| `cmptowbxs00xns601unt5kb3h` | Chilli Habenero | Chilli Habanero |
| `cmptowby500xqs6019ah8bfp2` | Chilli Habenero Kg | Chilli Habanero Kg |
| `cmoqfbn46007q9ky2v1ff60iw` | Chilli,Shishito Pepper Kg | Chilli Shishito Pepper Kg |
| `cmoqfbqfo00fc9ky2vrdi81pw` | Mesculin Gold Mix 1.5kg Box | Mesclun Gold Mix 1.5kg Box |
| `cmsdf12xv004imij9i61y7yr9` | Mesculin Gold Mix Box | Mesclun Gold Mix Box |
| `cmptowc4w00z4s601oluv35mi` | Mesculin Greens Mix | Mesclun Greens Mix |
| `cmptowbzp00y1s601sgs2p9p8` | Cucumber Quks | Cucumber Qukes |
| `cmoqfbnq600949ky2ivt75r59` | Cucumber Quks Punnet | Cucumber Qukes Punnet |
| `cmoqfbm9p005s9ky2vffqhsxk` | Broccolinni Box | Broccolini Box |
| `cmsdf12vj002omij9vsz913bw` | Avocadoes Hass | Avocados Hass |
| `cmoqfblrz004o9ky2ykw85p9k` | Avocadoes Hass Tray | Avocados Hass Tray |
| `cmptowc1t00ygs601cman1hzw` | Flowers Edible Phlox | Flower Edible Phlox |
| `cmoqfbmw200789ky27ikcdibq` | CHEESE HALOUMI 750GM (Cypriana) EA (5) | Cheese Halloumi 750g (Cypriana) |
| `cmoqfbpfj00d09ky2awzvldcv` | HAZELNUT KERNALS S/ON 1KG (Natures Secret) EA (12) | Hazelnut Kernels Skin On 1kg (Natures Secret) |
| `cmoqfbrr000ic9ky2v57s0l12` | PISTACHIO NUT KERNAL 1KG (Natures Secret) EA (12) | Pistachio Kernels 1kg (Natures Secret) *(duplicate)* |
| `cmoqfbn51007s9ky24h5tiwej` | CHIPOTLE CHILLIS A10 IN ADOBE SCE 3KG (Faro) EA (6) | Chipotle Chillies in Adobo 3kg (Faro) |
| `cmq42uub90001s601a2ugeabx` | KINGFISH WHOLE FARMED 3-4KG … Reason for adjustment: Random Weight | Kingfish Whole Farmed 3-4kg Sashimi Grade (Hiramasa) |

**Wine: "(Case of N)" removed, vintage moved to the end (items with no floor twin; for twins, see the 4a survivors)**

| id | current | proposed |
|---|---|---|
| `cmoqfbjy9000i9ky2enxt4hdx` | 2019 Edmeades Zinfandel (Case of 12) | Edmeades Zinfandel 2019 |
| `cmoqfbjz3000k9ky251c48egb` | 2020 Giant Steps Syrah/Carignan/Grenache (Case of 6) | Giant Steps Syrah Carignan Grenache 2020 |
| `cmoqfbjzz000m9ky2dqgaq9mx` | 2020 Nielson Pinot Noir (Case of 12) | Nielson Pinot Noir 2020 |
| `cmoqfbk2l000s9ky2hlwfh1xg` | 2021 Louis Jadot Bourgogne (Case of 12) | Louis Jadot Bourgogne 2021 |
| `cmoqfbkc4001e9ky2qefrlkpx` | 2022 Ramos Pinto Duas Quintas Tinto (Case of 6) | Ramos Pinto Duas Quintas Tinto 2022 |
| `cmoqfbker001k9ky2dbog0agf` | 2022 Utopos Cabernet Sauvignon (Case of 6) | Utopos Cabernet Sauvignon 2022 |
| `cmoqfbkfm001m9ky2yi54b6fl` | 2022 Utopos Shiraz (Case of 6) | Utopos Shiraz 2022 |
| `cmoqfbkml00229ky2sr050afw` | 2023 Haddow & Dineen 'Private Universe' Pinot Noir (Case of 6) | Haddow & Dineen 'Private Universe' Pinot Noir 2023 |
| `cmoqfbkst002g9ky2e5c2i42l` | 2023 Red Claw Pinot Noir (Case of 6) | Red Claw Pinot Noir 2023 |
| `cmoqfbkwg002o9ky2c0dhxosf` | 2023 Teusner The G Grenache (Case of 6) | Teusner 'The G' Grenache 2023 |
| `cmoqfbkdv001i9ky2leqkwvfo` | 2022 Teusner 'Wark Family' Shiraz (Case of 12) | Teusner 'Wark Family' Shiraz 2022 |
| `cmoqfbkvm002m9ky2rzyybxgs` | 2023 Teusner 'Wark Family' Shiraz (Case of 12) | Teusner 'Wark Family' Shiraz 2023 |
| `cmoqfblaj003k9ky243gup4t4` | A Rodda Tempranillo 2023 (Case of 12) | A Rodda Tempranillo 2023 |
| `cmoqfbk0w000o9ky2haaw48oz` | 2021 Cannonball Chardonnay (Case of 12) | Cannonball Chardonnay 2021 |
| `cmoqfbk7v00149ky2opeklub2` | 2022 Domaine Oudin Chablis (Case of 12) | Domaine Oudin Chablis 2022 |
| `cmoqfbkj1001u9ky2kg60r2ya` | 2023 Giant Steps Sexton Vineyard Chardonnay (Case of 6) | Giant Steps Sexton Vineyard Chardonnay 2023 |
| `cmoqfbkjw001w9ky255jdvgpp` | 2023 Gilbert Sauvignon Blanc (Case of 12) | Gilbert Sauvignon Blanc 2023 |
| `cmoqfbkp800289ky2at7p1v8u` | 2023 Louis Jadot Pouilly-Fuisse (Case of 12) | Louis Jadot Pouilly-Fuisse 2023 |
| `cmoqfbkuq002k9ky20vjx379p` | 2023 Te Mata 'Elston' Chardonnay (Case of 6) | Te Mata 'Elston' Chardonnay 2023 |
| `cmoqfbky5002s9ky205w05aem` | 2024 Domaine Christian Salmon Sancerre AC (Case of 12) | Domaine Christian Salmon Sancerre 2024 |
| `cmoqfbl2f00329ky2lfioohlq` | 2024 Grosset Polish Hill Riesling (Case of 12) | Grosset Polish Hill Riesling 2024 |
| `cmoqfbl4600369ky2qsi8msgc` | 2024 Poggio Anima 'Uriel' Grillo (Case of 12) | Poggio Anima 'Uriel' Grillo 2024 |
| `cmoqfbl62003a9ky2m7wmzd3x` | 2024 Shaw & Smith 'M3' Chardonnay (Case of 6) | Shaw & Smith 'M3' Chardonnay 2024 |
| `cmoqfbl6y003c9ky2a562edyt` | 2024 Thorin 'Terres de Craie' Macon Villages (Case of 12) | Thorin 'Terres de Craie' Macon Villages 2024 |
| `cmoqfbl8q003g9ky2aqd1vem3` | 2024 Vinden 'Headcase' Semillon (Case of 12) | Vinden 'Headcase' Semillon 2024 |
| `cmoqfbm7w005o9ky2xzi494xl` | Briar Ridge The Squire Chardonnay 2024 (Case of 12) | Briar Ridge 'The Squire' Chardonnay 2024 |
| `cmoqfbl1l00309ky2ml0nwijt` | 2024 Giant Steps Rose (Case of 6) | Giant Steps Rose 2024 |
| `cmoqfbnug009e9ky2xcl291f9` | Cuvée Colette Rosé 2024 (Case of 6) | Cuvee Colette Rose 2024 *(resolve section 2 first)* |
| `cmoqfbquk00ga9ky21ez4h64e` | NV Laurent Perrier Brut Rose (Case of 6) | Laurent-Perrier Brut Rose NV |
| `cmoqfbs1x00j09ky29vp7738p` | Rockford 'Basket Press' Shiraz 2004 | Rockford 'Basket Press' Shiraz 2004 *(no change; the other two vintages need quotes added)* |
| `cmoqfbs2s00j29ky24cztf4cu` | Rockford Basket Press Shiraz 2017 | Rockford 'Basket Press' Shiraz 2017 |
| `cmoqfbs3o00j49ky2oq8g2ict` | Rockford Basket Press Shiraz 2018 | Rockford 'Basket Press' Shiraz 2018 |
| `cmptovwzf00hrs601l2x2h29w` | Greystone Pinot Gris 2024 | (already conforms) |
| `cmoqfbtka00mg9ky2mnicv43i` | Vandal Gonzo Militia White Blend 750mL | Vandal 'Gonzo Militia' White Blend |
| `cmsdf9r8k0012mimfspyo7iu4` | Greywacke Sauvignon Blanc (375mL) | Greywacke Sauvignon Blanc 375ml |

**ALL-CAPS supplier names with no duplicate twin (fold case, strip carton notation)**

| id | current | proposed |
|---|---|---|
| `cmsdf10cs000fmiiolpjaohng` | BALTER XPA 16PACK CANS : 375 ml | Balter XPA Can 375ml |
| `cmoqfbnmp008w9ky2dmlgo49x` | CORONA BOTTLE - (CASE OF 24) | Corona Extra Bottle |
| `cmoqfbqkx00fo9ky2zc8zloa0` | MODELO ESPECIAL - (CASE OF 24) | Modelo Especial Bottle |
| `cmoqfbsr300kk9ky29gynj26g` | STRANGELOVE DOUBLE GINGER BEER - (CASE OF 24) | Strangelove Double Ginger Beer |
| `cmoqfbsry00km9ky2gbztfet8` | STRANGELOVE LEMON SQUASH - (CASE OF 24) | Strangelove Lemon Squash |
| `cmoqfbssr00ko9ky2ekwp1xki` | STRANGELOVE VERY MANDARIN - (CASE OF 24) | Strangelove Very Mandarin |
| `cmoqfbstk00kq9ky2mo6yhudf` | STRANGELOVE YUZU SODA - (CASE OF 24) | Strangelove Yuzu Soda |
| `cmoqfbs5i00j89ky2pdxzmlmt` | ROSE WATER 330ML | Rose Water 330ml |
| `cmoqfbqah00f09ky2lwzzszmq` | Manly Spirits Bulk 20Ltr Australian Dry Gin 1 x 20ltr Drum | Manly Spirits Australian Dry Gin 20L Drum |
| `cmsdf10ac0009miiooz0labvx` | ADG 20L Cube - 20L - 40% ABV (ADG-20L) | Manly Spirits Australian Dry Gin 20L Cube *(see 4b; may be the same item)* |
| `cmoqfbtik00mc9ky2871h92mv` | TSEC 20L (NoSugar) - 20L - 20% ABV | Triple Sec No Sugar 20L |
| `cmoqfbtf400m49ky2a0orrz04` | Triple SEC 20L - 20% ABV | Triple Sec 20L |
| `cmoqfblgl003y9ky23at6x2d5` | ALMOND BLANCHED WHOLE 1KG (Natures Secret) EA (12) | Almonds Blanched Whole 1kg (Natures Secret) |
| `cmoqfblhi00409ky2uo4cvyix` | ALMOND SLICE 1KG -flakes (Natures Secret) EA (10) | Almonds Flaked 1kg (Natures Secret) |
| `cmoqfblid00429ky2jiq1iphv` | ALMOND SMOKED 1KG (Natures Secret) EA (12) | Almonds Smoked 1kg (Natures Secret) |
| `cmoqfbmp8006s9ky287sy0o8n` | CASHEW PIECES 1KG (Natures Secret) EA (12) | Cashew Pieces 1kg (Natures Secret) |
| `cmoqfbnof00909ky2h1tf185q` | CRANBERRIES DRIED 1KG (Natures Secret) EA (12) | Cranberries Dried 1kg (Natures Secret) |
| `cmoqfbrkw00hy9ky2iwndqe3h` | PECAN NUT 1KG (Trumps) | Pecans 1kg (Trumps) |
| `cmoqfbm4d005g9ky2muvzq6qo` | BICARB SODA 1KG (Krio Krush) EA | Bicarb Soda 1kg (Krio Krush) |
| `cmoqfbnky008s9ky2p5k5asro` | CORN KERNELS 425GM (Sandhurst) | Corn Kernels 425g (Sandhurst) |
| `cmoqfbooe00ba9ky2rgiu3k4w` | FLOUR PLAIN 12.5KG (Manildra) EA | Flour Plain 12.5kg (Manildra) |
| `cmoqfbq0900ec9ky2a2efqrsa` | LENTILS PUY FRENCH 1KG (Chefs Choice) EA | Lentils Puy 1kg (Chefs Choice) |
| `cmoqfbrtq00ii9ky2dhag38xv` | POLENTA 1KG (Galaxy) EA (12) | Polenta 1kg (Galaxy) |
| `cmoqfbs0y00iy9ky20hiwsmqa` | RICE JASMINE 1KG (Sunrice) EA (12) | Rice Jasmine 1kg (Sunrice) |
| `cmoqfbsw400kw9ky24e2njhp8` | SUGAR WHITE 1KG (CSR) EA (12) | Sugar White 1kg (CSR) |
| `cmoqfbsat00jk9ky2p2chx5z4` | SALT COD FILLETS 1KG + R/W (Fresh) | Salt Cod Fillets |
| `cmoqfbqc900f49ky2w05b2hki` | MASECA TORTILLA YELLOW CORN  FLOUR 1kg | Masa Flour Yellow Corn 1kg (Maseca) |
| `cmoqfbtbn00lw9ky2oy3ilcko` | TOMATO PEELED PELATI A9 2.5KG (Mutti) EA (6) | Tomatoes Peeled 2.5kg (Mutti) |
| `cmoqfbt8y00lq9ky2ge1cvwea` | TOMATO PASSATA 720ml (Mazza Pomodoro) EA (12) | Tomato Passata 720ml (Mazza) |
| `cmoqfbt9u00ls9ky27of6zcf1` | TOMATO PASTE 500GM (Leggos) EA (6) | Tomato Paste 500g (Leggos) |
| `cmoqfbnbx00889ky2k5ph6qfp` | CLOVES WHOLE 350GM (Galaxy) EA | Cloves Whole 350g (Galaxy) |
| `cmoqfbnb200869ky2ipbri54k` | CLOVES GROUND 450GM (Galaxy) EA | Cloves Ground 450g (Galaxy) |
| `cmoqfbnk3008q9ky24ufnnfk1` | CORIANDER SEED 250GM (Galaxy) EA | Coriander Seed 250g (Galaxy) |
| `cmoqfbntl009c9ky2jen0yylc` | CUMIN SEEDS 450GM (Windsor Farm) EA | Cumin Seeds 450g (Windsor Farm) |
| `cmoqfbok300b09ky244dg0m6l` | FENNEL SEED 450GM (Galaxy) EA | Fennel Seed 450g (Galaxy) |
| `cmoqfblcb003o9ky2dv19lkxa` | ACHIOTE PASTE 1KG (El Yucateco) EA (15) | Achiote Paste 1kg (El Yucateco) |
| `cmoqfbmif006c9ky26bphpb7h` | CAPERS BABY 700GM (Sandhurst) | Capers Baby 700g (Sandhurst) |
| `cmoqfbr3e00gu9ky2bfw1o36q` | OIL OLIVE PURE 4L (Zeno) EA | Oil Olive Pure 4L (Zeno) |
| `cmoqfbr6600h09ky2y0pbyajt` | OLIVES PITTED GREEN 2KG (Riviana) EA (6) | Olives Green Pitted 2kg (Riviana) |
| `cmoqfbrba00hc9ky2wtt2mbp3` | PALM HEART JAR 400GM (Latin Deli) EA (24) | Palm Hearts 400g Jar (Latin Deli) |
| `cmoqfbsgb00jw9ky25u5d96yp` | SAUCE PEPPER RED TABASCO 350ML (Tabasco) EA (12) | Tabasco Red Pepper Sauce 350ml |
| `cmoqfbsyo00l29ky2d3drl5pj` | TAMARIND CONCENTRATE 1LT (Mae Ploy) EA (12) | Tamarind Concentrate 1L (Mae Ploy) |
| `cmoqfbtmy00mm9ky26gs0q595` | VINEGAR RICE WINE 250ML (Obento) EA (6) | Vinegar Rice Wine 250ml (Obento) |
| `cmoqfbtnv00mo9ky2hdqiw4v3` | VINEGAR SHERRY 500ML (Chefs Choice) | Vinegar Sherry 500ml (Chefs Choice) |
| `cmoqfbrrw00ie9ky2bwh4xp8g` | PISTACHIO PASTE 1KG EA | Pistachio Paste 1kg |
| `cmoqfbmud00749ky2mu2gd12f` | CHEESE BLUE 100GM (Castello) EA (10) | Cheese Blue 100g (Castello) |
| `cmoqfbmxs007c9ky2wd688fgo` | CHEESE RICOTTA 500GM (Perfect) EA (6) | Cheese Ricotta 500g (Perfect) |
| `cmoqfboic00aw9ky2m7x56gpg` | EVAPORATED MILK CARNATION 340ML (Nestle) EA (18) | Milk Evaporated 340ml (Carnation) |
| `cmoqfbrd000hg9ky27o1tt8g3` | PARMESAN GRANA WEDGE 14 X 200GM (Zanetti) CTN | Cheese Parmesan Grana Wedge 200g (Zanetti) |
| `cmoqfbm0r00589ky2gcertfzz` | BEEF BRISKET POINT END | Beef Brisket Point End |
| `cmoqfbmyn007e9ky2l50vtjhr` | CHICKEN NO. 15 FRESH | Chicken Whole No. 15 |
| `cmoqfbnw8009i9ky261wivvu9` | DELI BACON STREAKY | Bacon Streaky |
| `cmoqfbrun00ik9ky2lr1i6opg` | PORK BELLY BONELESS SKIN ON | Pork Belly Boneless Skin On |
| `cmoqfbn8g00809ky2hws596tc` | CHORIZO DON'S | Chorizo (Don's) |
| `cmptowbps00wgs601jibnyb8m` | DELI CHORIZO RODRIGUEZ | Chorizo (Rodriguez) |
| `cmoqfbpvy00e29ky2vvgv31d4` | KINGFISH FILLET S/OFF SASHIMI GRADE 1KG S.A FARMED (Hiramasa) | Kingfish Fillet Skin Off Sashimi Grade (Hiramasa) |
| `cmoqfbqzv00gm9ky2zxpzgh97` | OCTOPUS HANDS IMPORTED 1KG (Trading) EA (10) | Octopus Hands 1kg |
| `cmoqfbrwe00io9ky25dkvgsjr` | PRAWN CUTLETS RAW NATURAL 21/25 1KG VANNAMEI IMP (Trading) EA (10) | Prawn Cutlets Raw 21/25 1kg |
| `cmoqfbs9w00ji9ky2v0axetiu` | SALMON FILLETS S/OFF TASI SASHIMI 1.5-2KG R/W (Huon) | Salmon Fillet Sashimi Skin Off (Huon) |
| `cmoqfbsh800jy9ky23564k75d` | SCALLOPS 10/20 CHINA R/OFF 1KG (Trading) EA (10) | Scallops 10/20 Roe Off 1kg (China) |
| `cmoqfbsi300k09ky2la980j49` | SCALLOPS IQF 10/20 R/OFF 1KG (Shark Bay) | Scallops 10/20 Roe Off 1kg (Shark Bay) |
| `cmoqfbsoi00ke9ky2epvlc28b` | SNAPPER WHOLE PLATE SIZE 700-900GM NZ R/W (Fresh) | Snapper Whole Plate Size 700-900g (NZ) |
| `cmoqfbt2200la9ky2nxnixo13` | THIGH FILLET SKIN OFF (Pack of 5kg) | Chicken Thigh Fillet Skin Off 5kg Pack *(duplicate; see 4a)* |
| `cmoqfbu8y00o09ky2md6lkxv9` | YG BEEF CHUCK ROLL | Beef Chuck Roll (YG) *(duplicate; see 4a)* |

**Duplicate survivors whose floor name needs a tweak** (apply after the merge)

| id (suggested survivor) | current | proposed |
|---|---|---|
| `cmptovw6u00bus6018sk0oul2` or `cmsdf10ta00armiion18jgcaz` | Glen fi ddich 12yo Whiskey / Glenfiddich 12YO | Glenfiddich 12YO |
| `cmptovvln0076s601e9458auh` | Ballantines Scotch | Ballantine's Scotch *(add 1L if the 1 L bottle is what's stocked)* |
| `cmptovwak00cos601n7ng1vxa` | Jack Daniels | Jack Daniel's |
| `cmptovw8300c3s601umb3r9uu` | Hendricks Gin | Hendrick's Gin |
| `cmptovwi300e6s6012ryyx12w` | Mezcal Verde | Mezcal Verde Momento |
| `cmptovwe900dfs601n8qi99wn` | Los Siete Misterios Doba-Yej | Siete Misterios Doba-Yej |
| `cmptovw1200als601i7hrddqo` | El Tequileno 1959 Reposado Gran Reserva | El Tequileno 1959 Reposado Gran Reserva *(keep; retire "RESERVA REPOSADO")* |
| `cmptovw5q00bls601l3m2stkj` | G4 Añejo Tequila | G4 Anejo *(or retire it in favour of `cmsdf10sk00a9miiot0xezhg3`)* |
| `cmptovw6400bos601bkmekizq` | G4 Blanco Tequila | G4 Blanco |
| `cmptovv070030s601gk57wmlq` | Vok Creme de Cacao Blanco | Vok Creme de Cacao White 500ml |
| `cmsdf10jz004fmiioy6e21lmz` | Lime Juice | Lime Juice 5L |
| `cmsdf10l00053miioyzpx19ey` | Watermelon Juice | Watermelon Juice 5L |
| `cmptovvbe0050s601gthnv0ek` | Bonnet & Cotton Beaujolais Rouge | (undated twin; rename to the current vintage) |
| `cmptovvci0059s6012vdipwzj` | Domaine Thomson Explorer Pinot Noir | Domaine Thomson Explorer Pinot Noir 2024 |
| `cmsdf111n00g3miiofewysakf` | Loic Mahe Sables & Schists Chenin Blanc | Loic Mahe 'Sables & Schistes' Savennieres 2022 |
| `cmptovuoq000os601tw9t7842` | Laurent Perrier La Cuvee Champagne | Laurent-Perrier La Cuvee NV |

---

## 6. Other data issues

### 6a. Phantom venue "Avalon"

- **830 `VenueStockItem` rows** have venue = `Avalon`, one for every ACTIVE item. The real venues are `Alma Avalon` (829 rows) and `St Alma` (830 rows).
- All 830 rows were created in one batch, 2026-09-01 01:39:31.6 to 01:39:32.8. All are `active=true`, `onHand` is **NULL on all 830**, `parLevel` is **0 on all 830** (non-null but zero), `reorderPoint` is set on 1 row, and `unitOverride` is NULL. They hold no stock or par data and can be deleted outright.
- **A matching Stocktake** `cmti01rjj00qgoa01uhp30tw9` (venue `Avalon`, status IN_PROGRESS, countedAt 2026-09-01 01:39) has 830 lines, **none counted**, value NULL.
  - It was created in the same minute as Alma Avalon's REVIEWED stocktake of 2026-09-01 01:39. That looks like a venue-label bug ("Avalon" vs "Alma Avalon") in the stocktake-start code path, which then created the VenueStockItem rows.
  - Delete the empty stocktake together with its lines.
- **A second orphan:** Stocktake `cmq49xa2i0001s601z7kg0l2q` has venue **NULL**, status IN_PROGRESS, countedAt 2026-06-07. It has 778 lines (603 counted, value $31,128.63) and its lines were created 2026-07-16. Decide whether it's an abandoned draft or a real count that never got a venue.
- **Alma Avalon is missing one row:** `cmoqfble0003s9ky2wvf7mtfg` AGUAS MANSAS 700ML - (CASE OF 6) has rows for St Alma and Avalon only (it's a duplicate anyway; see 4a).

### 6b. Categories / statuses

- No items lack a category (0 / 851).
- 5 categories are empty (section 3).
- The 21 ARCHIVED items have no `VenueStockItem` rows (fine). They are mostly retired "(Case of N)" wine items and Corona variants.

### 6c. Active items with no avgCost (56 NULL + 8 zero)

**NULL avgCost (56)**

- **Bar:**
  - ADG 20L Cube `cmsdf10ac0009miiooz0labvx`
  - empty bottles `cmsdf10ee000rmiiovvs8b9iq`
  - Modus Operandi Cerveza `cmptovunp000js601dnfuov48` (dup)
  - Rhubarb Grapefruit Paloma `cmsdf10eo000xmiio3su1xxt1`
  - Cointreau 1L `cmptovut2001is601ftf5rk3r`
  - GIFFARD STRAWBERRY FRASIS `cmsdf10g1001rmiiowqgdccbj`
  - Cranberry Juice `cmsdf10h9002lmiio6p4gfux6`
  - Grapefruit Juice Bottle `cmsdf10j8003xmiiof5na37su`
  - Don Fulano Extra Anejo `cmsdf10s3009xmiio9qzu4kni`
  - El Jimador Reposado `cmsdf10sc00a3miio2f92xj98` (dup)
  - Grey Goose `cmptovw7q00c0s6014tzf2plx`
  - MANLY SPIRITS COASTAL STONE SINGLE MALT `cmsdf10vn00cfmiiozgitzp16`
  - Tromba Anejo `cmsdf10wz00dfmiiofgmeq8wa` (dup)
  - Tromba Reposado `cmsdf10x900dlmiioc9on3c6z` (dup)
  - Arette Blanco `cmptovvjw006rs601t26qd4hd` (dup)
  - G4 Añejo Tequila `cmptovw5q00bls601l3m2stkj` (dup)
  - Madre Mezcal Espadin `cmsdf10ve00c9miioe6tjyhbp` (dup)
- **Wine:**
  - Hickinbotham Cabernet Sauvignon `cmsdf10n9006lmiior5553wec`
  - Monte fi li Chianti Classico `cmptovvfb005us601ey8hngj9`
  - Yangarra Circle Shiraz `cmsdf10p0007xmiio082rrk7e` (dup)
  - Balmy Nights White Schonberger `cmsdf10y300e3miioz977dws4`
  - Gomez Cruzado Rioja Blanco `cmsdf110600ffmiioj6iqk2cj`
  - Poggio Solosole Vermentino `cmsdf112w00gxmiiogw2f237j`
- **Kitchen:**
  - Milk, Sour Cream Light
  - Beans Black Dry (dup), Beans Butter, Coconut Milk (dup), Onion Fried
  - Peanuts Roasted (dup), Salt Flakes, Sea Salt Flakes (dup)
  - Apples Granny Smith kg, Artichokes Jerusalem Box (dup), Cauliflower Box, Celeriac
  - Chilli Habenero, Chilli Habenero Kg, Chilli Poblano, Coriander Ground
  - Flower Edible Elder / Viola, Flowers Edible Phlox
  - Fresh Mix Forage, Fresh Mix Forage 100g (both dup)
  - Grapefruit Ruby, Lemons Large (dup), Medley Tomatoes (dup), Mesculin Gold Mix Box, Mint Bunch
  - 5 × Petite Bouche microherbs, Shallots Golden Peeled, Tarragon Bunch
  - Spicy Pineapple Margarita Keg 20L

Note: **24 of the 56 are duplicate twins**, and their cost exists on the other twin. Merging fixes those.

**avgCost = 0 (8)**

- Peppercorns Black Whole `cmptowb2f00sjs601qlkwclqb`
- Giffard Ginger Syrup `cmsdf10if003fmiiokrnutenn`
- Apples Granny Smith kg `cmoqfbllu004a9ky25g8j033f`
- Fennel Each `cmoqfboj700ay9ky2iogsvgg2`
- Ginger kg `cmoqfbpaz00cq9ky2lle6639i`
- Lemon `cmoqfbpyi00e89ky2urre7k75`
- Mushrooms Shitaki Punnet `cmoqfbqmq00fs9ky278e3b4s6`
- Spicy Pineapple Margarita Keg `cmoqfbspe00kg9ky2ic9tde14`

### 6d. Evidently wrong avgCost values (likely a case or pack cost stored as a per-unit cost)

| id | name | count unit | avgCost ¢ | comparison |
|---|---|---|---|---|
| `cmoqfbo0n009s9ky23tatpkjn` | DON JULIO BLANCO 750ML BOTTLE | bottle | 50010 | twin 8340 (≈ a 6-pack cost) |
| `cmoqfbory00bi9ky29bqkgj74` | FORTALEZA BLANCO 750ML BOTTLE | bottle | **15** | twin 11200 |
| `cmoqfbp2600c69ky24p8ikf3e` | GIFFARD COCONUT SYRUP 1000ML BOTTLE | bottle | 12840 | twin 2610 (6-pack) |
| `cmoqfbp7g00ci9ky2fenupt1l` | GIFFARD ROSE SYRUP 1L BOTTLE | bottle | 14235 | twins 2120–2373 |
| `cmoqfbq6600eq9ky2qgnr8ejx` | LYRES AGAVE BLANCO 700ML BOTTLE | bottle | 21114 | twin 2925 |
| `cmoqfbq7w00eu9ky2gcs0n6ja` | LYRES WHITE CANE SPIRIT 700ML BOTTLE | bottle | 20442 | twin 2926 |
| `cmoqfbsdo00jq9ky2k3aq5jkd` | SAMMY PIQUANT JETSETTER 700ML BOTTLE | bottle | 17970 | twin 3406 |
| `cmoqfbswy00ky9ky2n2nczql9` | SUPASAWA 700ML - (CASE OF 6) | bottle | 14826 | twin 2760 |
| `cmoqfbpi700d69ky2f8gje5og` | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) | each | 13488 | twin 1228 |
| `cmoqfbkyz002u9ky20vuy0jlx` | 2024 Domaine Thompson Explorer Pinot Noir (Case of 12) | bottle | 24100 | twin 2331 |
| `cmoqfbqwe00ge9ky2i603eznp` | NV Serenello Prosecco (Case of 6) | bottle | 8500 | twin 1468 |
| `cmoqfbnug009e9ky2xcl291f9` | Cuvée Colette Rosé 2024 (Case of 6) | bottle | 10200 | La Belle Colette 1964 |
| `cmoqfbkjw001w9ky255jdvgpp` | 2023 Gilbert Sauvignon Blanc (Case of 12) | bottle | **164** | far too low |
| `cmoqfbtik00mc9ky2871h92mv` | TSEC 20L (NoSugar) | L | 68000 | $680 / L; looks like the 20 L drum cost |
| `cmoqfbqah00f09ky2lwzzszmq` | Manly Spirits Bulk 20Ltr ADG Drum | gram | 7 | gin costed per gram, countUnit "gram" |
| `cmoqfbu8y00o09ky2md6lkxv9` | YG BEEF CHUCK ROLL | kg | 12400 | twin 2050/kg |
| `cmoqfbt2200la9ky2nxnixo13` | THIGH FILLET SKIN OFF (Pack of 5kg) | kg | 6750 | twins ≈1820–1850/kg |
| `cmoqfbs7900jc9ky2ubm4bauh` | Rum | bottle | 40482 | unidentified product |
| `cmptovuxi002fs601ncx5ye8f` / `cmptovuy9002ls601d8i19i99` | Massenez Creme de Peche / Pomme Verte | bottle | 22091 / 20820 | about 5 times other Massenez liqueurs; check for 5 L bulk (stocktake labels mention "5L") |
| `cmoqfbjtt000a9ky24c2sd33w` / `cmptowajj00p1s601zwo9pc7k` / `cmoqfbnit008o9ky2rf1uo52e` / `cmoqfbo5100a29ky24at71nph` | Corn tortillas / Coriander Dozen / Eggs Free Range | each/dozen | 17–63 | look like per-piece costs on pack count units |

### 6e. Count-unit / measure oddities

- **Placeholder measure "100 g" on 101 active items** (Produce 48, Dry 15, NA & Mixers 11, O&C 9, Dairy 8, H&S 5, Bakery 3, Frozen 2). Examples:
  - NA mixers measured in grams: Capi, Midnight Mixers tonic and soda, Strangelove ×4, Lyres Orange Sec, Sammy Piquant, First Press, Fee Brothers bitters
  - Agave Syrup at 100 g with a 4 L cost
  - "Milk" at 100 g
- **Floor bottle items default to 750 mL:** 193 active `cmptov…` bottle items carry 750 mL, including products whose invoice twin (and the real bottle) is 700 mL. Most tequila, gin and liqueur twins disagree, for example Patron Silver 750 vs 700. Any pour costing that uses mL will be about 7% off.
- **69 active items have no measure at all.**
- Keg volumes are inconsistent:
  - Freshwater Brewing Keg `cmoqfbouh00bo9ky2cw59grj4`: **100 mL**
  - Hazy Pale kegs: 10 000 mL
  - Wedge Cerveza Keg `cmoqfbtxh00na9ky2u9rt3d49`: 50 000 mL
  - Freshwater Wedge Cerveza Keg `cmptovuq5000xs601q1f9kaxv`: none
- Odd count units:
  - "gram" for a 20 L gin drum `cmoqfbqah00f09ky2lwzzszmq` (unit "drum", conversion 20000)
  - "can" for Lyres White Cane `cmptovwfk00dos601jtbuuixb` (it's a 700 mL bottle)
  - "12 pack" for Tomato Juice `cmsdf10kq004xmiioiyjtcbhx`
  - "unit" for empty bottles
  - Triple SEC 20L `cmoqfbtf400m49ky2a0orrz04`: unit L, countUnit bottle, conversion 20
  - Limes 5kg / 10kg boxes counted in kg with a 70 g measure
  - Kingfish whole: name carries the delivery note
- **Corrupted onHand at Alma Avalon:** total onHand value is **$3.0M** vs $265k at St Alma. The top rows are clearly mL entered as bottles:
  - Massenez Creme de Peche onHand 4800 → $1.06M
  - Manly Spirits Dry Gin 19 400 → $873k
  - Manly Triple Sec No Sugar 16 500
  - Manly Triple Sec 9 350
  - Manly Vodka 7 500

  This is the known count-unit corruption pattern. Fix it before trusting any onHand-based figures, including the $37.8k duplicate-twin figure in section 4.
- **Stale onHand generally:** 204 Alma Avalon rows and 293 St Alma rows carry non-zero onHand but were not on the 1 Oct sheet. Applying a stocktake doesn't zero items that were left off it.

### 6f. Historic stocktake lines mapped to the wrong item

During the Aug–Dec 2025 Loaded imports, fuzzy matching attached **284 stocktake lines (32 items, $27,994 of value)** to unrelated items. Examples:

| Stocktake label | Mapped to item |
|---|---|
| Bruxo No. 4 / Bruxo No. 2 | CHICKEN NO. 15 FRESH; 12cm Yellow Corn Tortilla |
| Dolin Dry Vermouth | BEANS BLACK DRY 1KG; Manly Spirits Bulk ADG |
| Milagro Silver | PATRON SILVER 700 ML BOTTLE |
| Tres Agaves / El Tesoro / Corralejo / Cascahuin / Batanga / Alquimia Blanco | EL TEQUILENO BLANCO (bottle and case) |
| El Tesoro / Tapatio / Clase Azul / Batanga / Cascahuin Reposado | EL JIMADOR REPOSADO |
| Don Fulano Anejo / Extra Anejo / Blanco | DON JULIO ANEJO / BLANCO |
| Ocho / Corralejo Anejo | GRAN CENTENARIO ANEJO |
| Ocho Extra Anejo, Cascahuin Extra Anejo | HERRADURA SELECCION SUPREMA |
| Manly Coffee Liqueur / Limoncello / Vodka | Triple SEC 20L |
| Fords / Hendricks / Never Never gin | Manly Spirits Bulk ADG drum |
| Kawa Coffee Liqueur | MASSENEZ BIRDSEYE CHILLI |
| Cointreau 1L | GIFFARD ROSE SYRUP 1L |
| Merlet Creme de Mure, Gentiane de Lure, Pico de Gallo, Dulce de Leche | Gotas de Mar Albarino |
| Tenuta de Arceno Chianti, Domaine Gavoty Cigale, Massenez Creme de Peche 5L | Dulce de Leche 1.5L (Messina) |
| Chateau Cru Godard, Domaine du Trapadis Esprit | Ascorbic Acid 600g |
| La Fee Absinthe, La Petit Mort Qvevri, La Violetta Patio Nat | Cuvée Colette Rosé 2024 |
| Teusner The G Grenache | CHIPS 7MM SHOESTRING FRIES |
| Alipus San Juan | Chipotle in adobo (San Marcos) |

These lines inflate the "ST lines" counts of several legacy twins in section 4, and they distort history and averages. Remap or null them as part of the duplicate merge.

---

### Suggested order of work

1. Delete the "Avalon" `VenueStockItem` rows and the empty Avalon stocktake. Resolve the null-venue stocktake.
2. Apply the 45 category moves and delete the 5 empty categories plus "Spirits".
3. Merge the 188 near-certain clusters. For each one: keep the 1 Oct-sheet item, repoint recipe, invoice, alias and stocktake rows, zero and archive the twin. Use the 6d cost fixes when choosing which avgCost survives.
4. Review the 44 possible clusters on the floor.
5. Apply the renames and the standard, then fix the 100 g and 750 mL measure defaults.

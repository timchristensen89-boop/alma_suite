# Alma Stock: data accuracy and usability audit (17 October 2026)

**Status: analysis and testing only.** Nothing in production was changed. Every figure comes from a read-only copy of production taken at 06:37 AEDT on 17 Oct, after the 16 Oct fixes, merges, 1 Oct counts and deploy. All write testing ran on a separate local test copy.

## Summary

| | Alma Avalon | St Alma |
|---|---:|---:|
| Current stock value | **$37,596** | **$63,528** |
| Confirmed overstatement (case or drum price stored as a unit cost) | −$6,001 | −$3,680 |
| **Value with confirmed errors corrected** | **$31,596** | **$59,847** |
| Further suspected errors (pack prices, stale counts, duplicate records) | up to −$3,496 | up to −$6,583 |
| Range if every suspected item is also wrong | $28,100 | $53,265 |

- **Phase 1:** about $9,681 of the "$13k" is confirmed case pricing on 11 items. Last night's merges already fixed about $3k (Colette, Domaine Thompson, Serenello). The other $3,764 is suspected; several of those items may be priced correctly.
- **Phase 2:** of the 69 items still on the 100 g placeholder (14 were merged away), 37 can be set from evidence, 25 should simply be "count only", 2 are genuinely 100 g, and **5 need your answer**.
- **Phase 3:** no group merged on 16 Oct joined two different vintages or sizes **by name**. But **18 merges folded a vintage-labelled record into an undated one**, and **3 joined genuinely different bottle sizes** (1 L Ballantine's, 1 L Jameson, 500 mL Vok). Those need your confirmation. Of the 69 groups not merged, only one is wine: Capa Tempranillo against Capa *Single Vineyard*, which should stay separate.
- **Phase 4:** the whole counting workflow works on a test copy, from start to apply. It found **4 issues to fix**, one of them a mislabelled printout.

## Phase 1: case and drum pricing

I tested every item that holds stock (543) against independent evidence: the pack size in its name or purchase setup, the stored purchase price, invoices, the same product's cost on its twin record (including twins merged on 16 Oct), and the Loaded costing notes. Kitchen supplier names such as "POLENTA 1KG (Galaxy) EA (12)" put the *carton* count in brackets, but those items are bought and priced **each**, so that bracket is not a pack size for costing. An earlier pass that treated it as one produced dozens of false alarms; they're excluded.

**Confirmed** means the price is an exact multiple (6, 12, 20 L) of the same product's per-unit cost on another record. **Suspected** means one piece of evidence, or the price may be right depending on what staff count.

| Item | Holds | Cost now | Purchase unit · pack | Expected unit cost | Avalon impact | St Alma impact | Evidence |
|---|---|---:|---|---:|---:|---:|---|
| **Confirmed** | | | | | | | |
| LYRES WHITE CANE SPIRIT 700ML BOTTLE | Avalon 6, St Alma 4.372 | $204.42/bottle | bottle · case of 6 (inferred) | $34.07 | $1,022.10 | $744.72 | $204.42 = 6 × $34.07; Lyre's 700 mL spirits cost $29–35 a bottle (Lyre's Triple Sec 700 mL $35.19, Lyres White Cane $29.26) |
| LYRES AGAVE BLANCO 700ML BOTTLE | Avalon 0.986, St Alma 6 | $211.14/bottle | bottle · case of 6 (inferred) | $35.19 | $173.45 | $1,055.70 | $211.14 = 6 × $35.19, exactly Lyre's Triple Sec 700 mL; twin Lyres Agave Blanco $29.25 |
| SAMMY PIQUANT JETSETTER 700ML BOTTLE | Avalon 10.7, St Alma 1.95 | $179.70/bottle | bottle · case of 6 (inferred) | $29.95 | $1,602.32 | $292.01 | $179.70 = 6 × $29.95, exactly the twin's latest invoice price |
| HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) | Avalon 15 | $134.88/each | case · case of 12 (purchase unit "case", 12 per case) | $11.24 | $1,854.60 | — | $134.88 = 12 × $11.24; twin Herradura Agave Nectar $12.28 |
| SUPASAWA 700ML - (CASE OF 6) | Avalon 1.4, St Alma 3.3 | $148.26/bottle | case · case of 6 (purchase unit "case", 6 per case) | $24.71 | $172.97 | $407.72 | $148.26 = 6 × $24.71; twin Supasawa $27.60 |
| GIFFARD ROSE SYRUP 1L BOTTLE | Avalon 0.725, St Alma 4.5 | $142.35/bottle | bottle · case of 6 (inferred) | $23.73 | $86.00 | $533.79 | $142.35 = 6 × $23.73, exactly the twin Giffard Rose Syrup |
| GIFFARD COCONUT SYRUP 1000ML BOTTLE | Avalon 0.526, St Alma 2.6 | $128.40/bottle | bottle · case of 6 (inferred) | $21.40 | $56.25 | $278.20 | $128.40 = 6 × $21.40, exactly the other Giffard 1 L syrups; twin $26.10 |
| DON JULIO BLANCO 750ML BOTTLE | Avalon 0.2, St Alma 0.05 | $500.10/bottle | bottle · case of 6 (inferred) | $83.35 | $83.35 | $20.84 | $500.10 = 6 × $83.35; twin Don Julio Blanco $83.40 |
| TSEC 20L (NoSugar) - 20L - 20% ABV | Avalon 1.05, St Alma 0.015 | $680.00/L | L · 20 L drum, counted in litres | $34.00 | $678.30 | $9.69 | $680 is the drum price on a litre unit; twin Triple Sec 20 L is $30/L ($600 a drum) |
| Watermelon Juice (1 x 5L) | Avalon 11.3, St Alma 2.2 | $30.00/L | L · 5 L container, counted in litres | $6.00 | $271.20 | $52.80 | $30 is the 5 L price on a litre unit; twin Watermelon Juice is $34.80 per 5 L ($6.96/L) |
| YG BEEF CHUCK ROLL | St Alma 2.757 | $124.00/kg | kg · case price per kg (inferred) | $20.67 | — | $284.86 | $124/kg = 6 × $20.67; twin Beef Chuck Roll $20.50/kg |
| *Confirmed total* | | | | | **$6,000.54** | **$3,680.33** | |
| **Suspected** | | | | | | | |
| Massenez Creme de Peche | Avalon 1, St Alma 1 | $220.91/bottle | bottle · 6-pack? (no invoice) | $36.82 | $184.09 | $184.09 | $220.91 a bottle is ~6× a normal Massenez liqueur; Loaded recorded '1 Bottle = $220.91'. Tim counted 1 bottle |
| Massenez Pomme Verte | Avalon 6, St Alma 0.5 | $208.20/bottle | bottle · 6-pack? (no invoice) | $34.70 | $1,041.00 | $86.75 | $208.20 for a 500 mL bottle (Tim confirmed the size) is ~6× normal |
| Limes | Avalon 5.8, St Alma 1.49 | $45.57/kg | kg · 5 kg box price on a kg unit? | $9.11 | $211.47 | $54.33 | $45.57/kg; the merged 'Limes 5kg Box' record suggests $45.57 is the box |
| Lime Juice (1 x 5L) | Avalon 3.5, St Alma 3.8 | $70.00/L | L · litre price unclear | $7.60 | $218.40 | $237.12 | $70/L; the only invoice is a 2 L bottle at $15.20 ($7.60/L). You confirmed lime juice comes in 5 L packs, so the true per-litre price needs an invoice |
| Cascahuin Reposado (4x375mL) | St Alma 0.75 | $291.77/bottle | bottle · pack of 4 × 375 mL | $72.94 | — | $164.12 | $291.77 per pack; correct as is if staff count packs, $72.94 if they count 375 mL bottles |
| Lettuce Baby Gem 20s Box | Avalon 6, St Alma 0.3 | $38.00/each | each · box of 20 heads | $1.90 | $216.60 | $10.83 | $38 per box is right if staff count boxes; wrong if they count heads |
| PARMESAN GRANA WEDGE 14 X 200GM (Zanetti) CTN | St Alma 0.58 | $116.00/each | case · carton of 14 wedges | $8.29 | — | $62.47 | $116 per carton is right if staff count cartons; $8.29 if they count wedges |
| Rum | St Alma 2.7 | $404.82/bottle | bottle · unknown product | unknown | — | $1,093.01 | No product named; $404.82 a bottle from a March 2026 sheet. Identify it or archive it |
| *Suspected total* | | | | | **$1,871.56** | **$1,892.72** | |

Already corrected by the 16 Oct merges: Cuvée Colette (case of 6, $102/bottle), Domaine Thompson Explorer (case of 12, $241/bottle) and Serenello (case of 6, $85/bottle). The case-priced twins are archived and the survivors carry per-bottle costs. Premium products that look expensive but are plausibly priced (El Jolgorio, Clase Azul, Rockford, Sandrone Barolo, Bouchard Corton, Gevrey-Chambertin, Laurent-Perrier Rosé) are **not** errors.

## Phase 2: the 100 g placeholder measures

A measure only matters when a recipe uses the item in grams or mL, or someone enters it by weight. It never changes stock value. 69 items still have the placeholder (14 of the 83 were merged away).

### Set from evidence (37)

| Item | Measure | Evidence |
|---|---|---|
| Cheese Halloumi | 750 g | invoice "CHEESE HALOUMI 750GM"; $85 for 5 = $17 each, the item cost |
| Cheese Ricotta Salata | 700 g | invoice "AVG 700GM"; Loaded counted it as "700 Grams" packs |
| Cheese Goat | 1000 g | invoice "CHEESE GOAT LOG 1KG" at $27.50 = the item cost |
| Oil Canola Spray | 450 g | invoice "OIL CANOLA SPRAY 450GM" at $4.50 = the item cost |
| Coriander Ground | 400 g | Loaded counted it as "400 Grams" packs |
| Grapefruit Ruby | 1000 g | Loaded counted it in kilos |
| Medley Tomatoes | 200 g | Loaded counted it as "200 Grams" punnets |
| Milk | 2000 ml | Loaded counted it as "2 L" bottles |
| Vinegar White | 1000 ml | Loaded counted it in litres; $1.08 is a per-litre price |
| Nut Walnut | 1000 g | Loaded counted it in kilos |
| Oil Olive Extra Virgin | 1000 ml | Loaded counted it in litres; $12.27 is a per-litre price |
| Onion Fried | 1000 g | Loaded counted it as "1 KG" packs |
| Onions Spanish | 10000 g | invoice "Onions Spanish Large Bag"; Loaded counted it as "10 KG" bags (14 recipe lines in grams) |
| Chilli Large Red | 1000 g | item note "Pack: 1 kg" |
| Oranges Large | 1000 g | Loaded cost "1 Kilo = $4.74" = the item cost |
| Freshwater Brewing Keg | 50000 ml | item note "Pack: 50 l" (recipe lines in mL) |
| Chilli Choptle in Adobo | 3000 g | Loaded counted it as "3 KG" tins |
| Agave Syrup | 4000 ml | Loaded counted it as "4L"; agave nectar comes in 4 L at about this price |
| Coconut Flakes | 500 g | Loaded counted it as "500 Grams" packs |
| Carrots Medium | 1000 g | item note "Pack: 1 kg"; Loaded counted it in kilos |
| Chilli Habenero | 1000 g | Loaded counted it in kilos |
| Peanuts Roasted | 1000 g | Loaded counted it as "1 KG" packs |
| Chilli Jalapeno | 1000 g | Loaded cost "1.15 Kilo = $10.41" ($9.05/kg = the item cost) |
| Chilli Poblano | 1000 g | Loaded counted it in kilos |
| Large Red Capsicum | 1000 g | Loaded counted it in kilos; $7.15 is a per-kilo price |
| Salt Rock Coarse | 1000 g | Loaded counted it in kilos |
| Shallots Golden Peeled | 1000 g | Loaded counted it as "1 KG" packs |
| Sour Cream Light | 1000 ml | Loaded counted it in litres |
| Sugar Brown | 1000 g | invoice "SUGAR BROWN 1KG" at $4.00 = the item cost |
| Thyme Dried | 1000 g | Loaded counted it as "1 KG" packs |
| Tomatoes Large Box | 10000 g | item note "Pack: 10 kg"; invoice "Tomatoes Large Box" (12 recipe lines in grams) |
| Lyres Orange Sec | 700 ml | Loaded counted it as "700 mL" bottles |
| Sammy Piquant The Jetsetter | 700 ml | Loaded cost "0.5 700 mL = $17.03" |
| Chilli Morita | 1000 g | item note "Pack: 1 kg" |
| Fee Brothers Grapefruit Bitters | 150 ml | Loaded counted it as "150 mL" bottles |
| Tortilla Flour 12inch | 91 g | invoice "FLOUR TORTILLAS 12X91GM" — one tortilla is 91 g |
| Whole Dried Arbol Chilli 75GRS | 75 g | name and item note "Pack: 75 g" |

### Count only (25): clear the measure; managers count units

| Item | Counted by |
|---|---|
| Midnight Mixers Classic Dry Tonic | each |
| Midnight Mixers Soda Water | each |
| Cucumber Telegraph | each |
| Dill | each |
| Eggplant Box | each |
| Cucumber Quks | each |
| Bay Leaves Bunch | each |
| Petite Bouche Watercress | each |
| Celeriac | each |
| Flower Edible Elder | each |
| Flower Edible Marigold | each |
| Flower Edible Viola | each |
| Flowers Edible Phlox | each |
| Petite Bouche Bulls Blood | each |
| Petite Bouche Chervil | each |
| Petite Bouche Red Elk | each |
| Petite Bouche Upperland Cress | each |
| TOMATILLOS A10 GREEN TOMATO (Faro) EA (6) | each |
| Fennel Each | each |
| Capi Ginger Beer | each |
| Broccolinni Box | bunch |
| Carrots Dutch Box | each |
| STRANGELOVE DOUBLE GINGER BEER - (CASE OF 24) | each |
| STRANGELOVE YUZU SODA - (CASE OF 24) | each |
| STRANGELOVE VERY MANDARIN - (CASE OF 24) | each |

### 100 g is real (2): Chilli Guajillo Dried (Loaded: 540 g = $26.02, so $4.82 per 100 g); Castello Blue 100 g

### Your input needed (5)

| Item | Question |
|---|---|
| Beans Butter | 1 recipe line uses grams; bought as an A10 tin — what is the drained weight, or the tin weight? |
| Fresh Mix Forage | 7 recipe lines use grams — how many grams in one punnet/pack? |
| Tomatoes Cherry | 2 recipe lines use grams — how many grams in one punnet? (often 250 g) |
| Tortilla Corn | counted one tortilla at a time (1,700 at Avalon) but counted 2.15 in August — is the count unit one tortilla, or a pack? |
| Coriander Dozen | counted by the dozen bunches, but 18 recipe lines use grams — how many grams is one dozen bunches? |

## Phase 3: duplicate groups, wine first

### First, the 163 groups merged on 16 Oct

I checked every merged group for vintages and bottle sizes, reading both names and stored measures.

**Different vintages joined by name:** none.

**A vintage-labelled record folded into an undated one: 18 groups.** Each was judged the same wine. But your rule is "never merge different vintages", and the undated record could have been counting a different vintage, so please confirm.

- #112 Cà di Bruno Barbaresco 2019
- #113 Villa Albergotti Chianti Superiore 2021
- #115 Stephane Brocard Gevrey-Chambertin **Vieilles Vignes** 2022
- #116 Bonnet & Cotton Beaujolais 2023
- #117 Domaine Thomson Explorer Pinot 2024
- #118 Yangarra Circle Shiraz 2024
- #120 Loïc Mahé Sables & Schistes 2022
- #121 Inama Soave Classico 2023
- #122 Mon Tout **"Heydays"** Chardonnay 2023
- #123 Nick Spencer Grüner Veltliner 2023
- #124 Shut The Gate Gewürztraminer 2023
- #125 i Lauri Pecorino 2024
- #126 Maison Saint Aix Rosé 2023
- #199 Teusner Wark Family Shiraz 2023
- #200 BenMarco Malbec / **Valle de Uco** 2022
- #201 Schlumberger Grand Cru **Saering** Riesling 2021
- #202 Colette Rosé 2024
- (#10 Don Julio 1942 is not a vintage: 1942 is part of the name.)

The **bold** qualifiers are the ones most likely to be a *different* wine from the undated record: Vieilles Vignes, Heydays, Valle de Uco, Saering. Check those four first.

**Genuinely different bottle sizes: 3 groups.**
- #68 Ballantine's 1 L into a 750 mL record
- #75 Jameson 1 L into a 750 mL record
- #94 Vok Crème de Cacao 500 mL into a 750 mL record

These are right only if the venue stocks just that one size. The other ~65 measure disagreements are the same product with the catalogue's 700-vs-750 mL default, plus kitchen placeholders. No stock value depends on those, only recipe costing.

**If any of these 21 should not have been merged:** the snapshot for run `prod-merges-20261016` holds every original row. Since the 1 Oct counts were applied to the merged items afterwards, undoing one means splitting it back out, not a blind restore. I'd prepare that for your approval.

### The 69 groups not merged, by what they need

| What they need | Groups |
|---|---|
| **Keep separate:** different products, expressions or sizes | #114 Capa Tempranillo vs Capa Single Vineyard (different wines); #188 El Jolgorio Pechuga Black Yellow vs Yellow; #189 Cascahuin Reposado 700 mL vs 4×375 mL; #193 Triple Sec 20 L vs **No Sugar** 20 L; #198 Heaps Normal can case vs Another Lager vs Quiet XPA; #205 agave nectar brands; #207 mayonnaise 1/10/15 kg; #208 white vinegar 4 L vs 5 L; #211 milk vs UHT; #212 chorizo brands; #213 scallop brands; #222 eggplant box vs kg; #191 Coastal Stone 500 mL vs 700 mL blends |
| **Merge once the twin's case price is fixed:** same product, and the invoice-named twin carries a case price (Phase 1) | #12 Don Julio Blanco; #25 Fortaleza Blanco (twin cost $0.15, 7 bottles at St Alma); #82 Lyre's White Cane (the floor record wrongly counts "cans"); #99 Giffard Coconut; #102 Giffard Rose (3 records); #104 Herradura Agave Nectar; #106 Lyre's Agave Blanco; #107 Sammy Piquant; #108 Supasawa; #171 Beef chuck roll |
| **Merge but keep both holdings:** the "discard" in the proposal was real stock held inside prep batches | #81 Woodford; #89 Giffard Violette; #100 Giffard Falernum (3 records); #101 Giffard Ginger (survivor has no cost); #146 Sesame; #148 White wine vinegar; #141 Peanuts; #150 Guajillo (100 g vs 1 kg units: convert first); #204 Thyme (100 g vs 200 g: convert first); #206 Chipotle (two brands: merge the two Faro tins, keep San Marcos); #231 Tomatoes (box sizes) |
| **Same product counted two ways:** pick one count unit and convert the holding | Produce each vs kg: #215 carrots, #217 habanero, #218 jalapeño, #219 poblano, #223 grapefruit, #224 capsicum, #227 onions, #229 oranges, #226 mesclun. Dry goods kg vs pack: #143 rice, #144 salt, #147 caster sugar, #149 pomace oil, #161 EVOO, #168 mozzarella. Juices L vs bottle: #96 mango, #98 First Press, #105 lime, #109 watermelon. Herbs: #180 dill, #220 coriander. Also #221 cucumbers, #187 medley tomatoes, #190 Lyre's Orange Sec/Triple Sec, #110 Modus (archive the empty bottle record) |
| **Your call** | #172 beef short ribs (two costs, $25.89 vs $51.80/kg: which is right?); #135 plain flour ($1.12 vs $2.50/kg); #137 onion powder and #157 peppercorns (two different counts on one sheet); #164 Callebaut white chocolate (same 2.5 kg bag?); #192 Manly gin drum vs "ADG 20L Cube" (same drum?); #103/#194 Giffard Strawberry (run as one merge); #145/#203 sea salt (merge the two 2 kg records, keep the 6 kg carton) |

## Phase 4: counting workflow, tested on a test copy

I used a separate local copy of production (`alma_stock_test`), running main's code, with test logins: a manager at Avalon and a counter at St Alma. Nothing was written to production.

| Step | Result |
|---|---|
| Start a count (manager) | ✅ Venue pre-filled; opens on its own count screen |
| Type a number, press Enter or Tab, next row | ✅ Moves to the next row; "Saving…" then "✓ Saved 6:48 am"; progress 3/393 |
| Autosave stores what was typed | ✅ Stored server-side and valued by the server; untouched rows stay **blank**, not zero |
| Search (partial, across sections, by vintage) | ✅ "ali" finds matches across sections; "shiraz 2017" finds Rockford 2017; counts survive filtering |
| Edit an item from the count (pencil) | ✅ Drawer opens over the count; par level saved; the count on that row was untouched |
| Change a quantity, clear a quantity | ✅ 4 → 5 revalued ($925); a cleared row goes back to blank |
| Units handled automatically | ✅ "2 case" stored as 12 bottles; "970 g" of a 1 kg bag stored as 0.97; "170 g" of bay leaves (no real measure) refused with a plain message |
| Print a filled sheet | ✅ A4, two columns, counts already entered shown |
| Print blank sheets from templates | ✅ Avalon Bar & FOH: 393 rows on 6 A4 pages. St Alma Kitchen: 258 rows on 5 pages |
| Excel templates | ✅ Valid A4 .xlsx with Item, Vintage, Unit, Count and Notes, grouped by category |
| Submit for review | ✅ The confirmation states "3 of 393 lines counted. 390 blank lines will be recorded as zero." Blanks were then zeroed |
| Apply to stock (typed "APPLY COUNT") | ✅ 393 movements; every on-hand equals its count |
| Counter permissions | ✅ Can enter counts at their venue; can't start or apply counts, edit items, or open the other venue's counts |
| Phone layout (375 px) | ✅ Large count boxes, collapsible sections, search, add-item, bottom navigation |

**Issues found, to fix before managers rely on them**
1. **Printed and Excel sheets show the wrong venue for another venue's template.** A manager at Avalon who prints the **St Alma Kitchen** sheet gets it headed "Alma Avalon". It's a small code fix.
2. **The start form can override the manager's choice.** If "Full count" is picked before the templates finish loading, the form switches to the venue's first sheet. It's a small code fix.
3. **The dashboard's Stock on Hand card speaks jargon.** It says "Unavailable — BEVERAGE count 2026-10-17 has no FOOD counterpart", and right now it shows "Unavailable" because the 1 Oct counts are 16 days old. It needs plain wording.
4. **An old phantom "Avalon" count still shows as "In progress".** Its cleanup SQL (prepared 16 Oct) has not been approved.

Also worth knowing:
- The count screen's **Excel** button gives a *blank* template of that count, without the counts entered.
- Until the held duplicate groups are merged, sheets show two rows for one product (e.g. "Don Julio Blanco" and "DON JULIO BLANCO 750ML BOTTLE"), which will confuse counters.

## Phase 5: stock value by venue and category

Value is active items, on hand × average cost, on the production copy at 06:37 on 17 Oct. Each flagged item is counted once, under its strongest reason. **Confirmed** is the overstatement on the 11 case-priced items. **Suspected** covers possible pack prices, holdings not counted since before August 2026 (mostly St Alma wines last counted 31 Mar), and duplicate records still holding stock alongside their twin.

| Category | Avalon value | Avalon confirmed | Avalon suspected | St Alma value | St Alma confirmed | St Alma suspected |
|---|---:|---:|---:|---:|---:|---:|
| Wine — Red | $1,767 | — | $33 | $19,749 | — | $801 |
| Spirits — Tequila & Mezcal | $10,490 | $83 | $0 | $10,361 | $21 | $1,952 |
| Wine — White | $3,091 | — | — | $10,932 | — | $633 |
| Spirits — Other | $4,880 | $1,022 | $46 | $5,418 | $745 | $1,386 |
| Non-Alcoholic & Mixers | $4,373 | $2,362 | $266 | $4,575 | $2,620 | $493 |
| Liqueurs & Aperitifs | $4,459 | $678 | $1,297 | $3,998 | $10 | $606 |
| Oils & Condiments | $2,877 | $1,855 | $331 | $514 | — | $37 |
| Wine — Sparkling | $1,063 | — | — | $1,578 | — | — |
| Produce | $1,034 | — | $561 | $1,078 | — | $95 |
| Meat & Poultry | $282 | — | — | $1,827 | $285 | — |
| Wine — Rosé | $305 | — | — | $1,477 | — | — |
| Beer & Cider | $855 | — | $199 | $662 | — | $155 |
| Dry / Pantry | $803 | — | $418 | $423 | — | $11 |
| Seafood | $372 | — | $176 | $122 | — | — |
| Bakery | $301 | — | — | $190 | — | — |
| Spirits | $132 | — | $132 | $228 | — | $228 |
| Dairy & Eggs | $210 | — | $12 | $137 | — | $62 |
| Herbs & Spices | $207 | — | $24 | $66 | — | — |
| Other | $2 | — | — | $124 | — | $124 |
| Frozen | $93 | — | — | $24 | — | — |
| Desserts & Sweets | — | — | — | $45 | — | — |
| **Total** | **$37,596** | **$6,001** | **$3,496** | **$63,528** | **$3,680** | **$6,583** |

Per-item detail is in `valuation-flags.json`, `case-pricing.json` and `placeholder-measures-plan.json`.

## Waiting for your approval (nothing below has been done)

1. **Correct the 11 confirmed case prices** (−$9,681). This is a cost change only, with backup and rollback, as with the unit fixes.
2. **Set the 37 evidenced measures and make the 25 count-only items measure-free.** This affects recipe costing, not stock value.
3. **Confirm or split** the 18 vintage folds and 3 bottle-size merges from 16 Oct.
4. **Merge the held groups** in the order above (case price first, then keep-both-holdings, then convert-then-merge), each rehearsed on a copy first.
5. **Fix the 4 usability issues** (two are code, one is wording, one is the phantom-count SQL).
6. **Answer the 5 measure questions** and the suspected price items (Massenez ×2, limes, lime juice, Cascahuin, baby gem, parmesan, "Rum").

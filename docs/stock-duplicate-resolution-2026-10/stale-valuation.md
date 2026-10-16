# Stale stock valuation — Alma Avalon & St Alma

Source: pristine clone `alma_stock_orig` (read-only), `scratchpad/valuation.json`, `scratchpad/facts/*.json`, plus `special/holdings.json`, `special/latest-lines.json`, `special/last-movements.json` exported from the clone. All money is cents in the database; shown here as dollars. Nothing was written to any database.

"Latest finalised sheet" = the facts' `latestSheets`: **Alma Avalon — "Stocktake 10/1/2026"** (`cmupcujav03c0pd01796c5bpm`, SUBMITTED, 825 lines, 424 counted) and **St Alma — "Bar & FOH 01/10/2026"** (`cmup72ay90000pd01tfoyqda1`, SUBMITTED, 301 lines, 277 counted). Both are SUBMITTED and **not yet applied**, so no 1 Oct count is in `VenueStockItem.onHand` yet; onHand reflects the last *applied* sheets (Avalon Bar & FOH 9/1, St Alma Bar & FOH 31/08 and Kitchen 31/8, the 31 Jul/1 Aug Loaded PDF imports, and the 2025 legacy sheets).

## 0. Three findings that change how the $38k should be read

1. **The $38k is real as a number, but it is mostly not "stock".** Of the $37.8k on near-certain twins not counted on 1 Oct, $27.3k is the *same bottles already counted under the floor-named twin* (a catalogue duplicate), $3.6k is stock genuinely held inside prep batches and credited to the recipe twin by the apply code, and $6.9k is stock nothing on the 1 Oct sheet accounts for (recount). Several of the biggest lines are also priced at a case cost.
2. **The 2025 legacy sheets were applied out of date order.** On 2026-07-16 the "Historical Bar Stocktake" sheets were applied 12.25 → 11.25 → 10.25 → **09.25 last** (`Stocktake.appliedAt` 12:25:17 … 12:25:48), so every May-wave item that has not been counted in 2026 sits at its **September 2025** quantity, not December 2025. That is why `onHand ≠ lastCountQty` on almost every legacy twin (158 Avalon holdings / 150 St Alma holdings equal the 09.25 count and not the 12.25 count). The legacy quantities are therefore 13 months old, not 10.
3. **Avalon's $2.97M is five lines of millilitres stored as bottles, and St Alma is about to inherit the same corruption.** The five Avalon holdings (Massenez Creme de Peche, Manly Dry Gin, Manly Triple Sec, Manly Triple Sec No Sugar, Manly Vodka) carry $2,955,021.50 of the $3.0M; St Alma's two Manly Triple Sec holdings carry $186,048.00 of its $265k. `applyStocktake` writes `line.countedQty` straight into onHand with no unit conversion (`quantityAfter = line.countedQty`, stocktakes.service.ts ≈ line 1380), and the St Alma 1 Oct sheet has four Manly lines entered in **ml** (17 500 / 21 000 / 8 300 / 10 800). Applied as-is they would write $1,928,009.00 of phantom value at St Alma.

## 1. On-hand value parked on cluster members NOT counted on the venue's latest sheet

"Not counted" = no line with a non-null `countedQty` on that venue's 1 Oct sheet (a line left blank counts as not counted; the apply code skips null lines, so a blank never zeroes the holding).

| Venue | Tier | Holdings | Value |
|---|---|---:|---:|
| Alma Avalon | near-certain | 150 | $16,232.21 |
| Alma Avalon | possible | 34 | $2,197.70 |
| St Alma | near-certain | 161 | $21,531.04 |
| St Alma | possible | 38 | $4,440.14 |
| **Both venues** | near-certain | 311 | **$37,763.25** |
| **Both venues** | possible | 72 | **$6,637.83** |

The near-certain figure reproduces the audit's "about $37.8k". Including possible clusters it is $44,401.08.

**Caveat on "latest sheet" for kitchen stock.** The St Alma 1 Oct sheet is Bar & FOH only (no kitchen category on it); the Avalon 1 Oct sheet lists the whole catalogue but the kitchen was barely counted (Produce 19/110, Dairy 4/24, Meat 1/14, Seafood 2/15). Kitchen holdings whose last count is the venue's latest *kitchen* sheet (St Alma Kitchen 31/8/2026, applied; Avalon "Fri 31st Jul (from Loaded)", applied) are current, not stale:

| Venue | Tier | Current on latest kitchen sheet | Stale by either definition |
|---|---|---:|---:|
| Alma Avalon | near-certain | 21 holdings, $703.75 | 129 holdings, $15,528.46 |
| Alma Avalon | possible | 11 holdings, $188.35 | 23 holdings, $2,009.34 |
| St Alma | near-certain | 36 holdings, $2,681.07 | 125 holdings, $18,849.97 |
| St Alma | possible | 24 holdings, $666.59 | 14 holdings, $3,773.55 |

Where the holdings sit relative to the 1 Oct sheet (all holdings, for context):

| Venue | Group | On 1 Oct sheet | Holdings | Value |
|---|---|---|---:|---:|
| Alma Avalon | near-certain | counted on 1 Oct | 157 | $16,660.89 |
| Alma Avalon | near-certain | listed on 1 Oct sheet, left blank | 199 | $12,576.06 |
| Alma Avalon | near-certain | not on the 1 Oct sheet at all | 29 | $3,656.15 |
| Alma Avalon | non-cluster | counted on 1 Oct | 210 | $2,093,228.14 |
| Alma Avalon | non-cluster | listed on 1 Oct sheet, left blank | 132 | $874,018.58 |
| Alma Avalon | possible | counted on 1 Oct | 31 | $2,286.39 |
| Alma Avalon | possible | listed on 1 Oct sheet, left blank | 69 | $1,925.15 |
| Alma Avalon | possible | not on the 1 Oct sheet at all | 2 | $272.55 |
| St Alma | near-certain | counted on 1 Oct | 106 | $12,637.81 |
| St Alma | near-certain | listed on 1 Oct sheet, left blank | 12 | $1,066.62 |
| St Alma | near-certain | not on the 1 Oct sheet at all | 268 | $20,464.42 |
| St Alma | non-cluster | counted on 1 Oct | 149 | $219,113.89 |
| St Alma | non-cluster | listed on 1 Oct sheet, left blank | 10 | $392.23 |
| St Alma | non-cluster | not on the 1 Oct sheet at all | 183 | $5,677.23 |
| St Alma | possible | counted on 1 Oct | 12 | $1,235.12 |
| St Alma | possible | listed on 1 Oct sheet, left blank | 2 | $76.92 |
| St Alma | possible | not on the 1 Oct sheet at all | 88 | $4,363.22 |

By the source of each stale holding's last count:

| Venue | Last count source | Holdings | Value |
|---|---|---:|---:|
| Alma Avalon | Loaded CSV import | 24 | $2,755.64 |
| Alma Avalon | Loaded PDF import | 32 | $892.12 |
| Alma Avalon | app count | 13 | $1,625.57 |
| Alma Avalon | legacy 2025 month-end | 115 | $13,156.59 |
| St Alma | Loaded CSV import | 10 | $2,767.87 |
| St Alma | Loaded PDF import | 12 | $2,485.33 |
| St Alma | app count | 71 | $5,675.98 |
| St Alma | legacy 2025 month-end | 105 | $15,039.78 |
| St Alma | legacy Mar-26 | 1 | $2.24 |

"Legacy 2025 month-end" = the `Historical Bar/Kitchen Stocktake • MM.25` sheets loaded with the May catalogue (unit label "ml", quantities are bottles); "Loaded CSV import" = `Loaded import · venue · date`; "Loaded PDF import" = the 31 Jul / 1 Aug "(from Loaded)" sheets; "app count" = a sheet counted in the app.

### 1a. Every stale cluster holding over $200 (58 holdings, $28,553.50)

| # | Venue | Tier | Cluster | Item (id) | onHand | Cost | Value | Last count | Source | Twin on 1 Oct sheet |
|---|---|---|---|---|---:|---:|---:|---|---|---|
| 1 | Alma Avalon | near-certain | #104 Herradura Agave Nectar | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) (`cmoqfbpi700d69ky2f8gje5og`) | 15 each | $134.88 | **$2,023.20** | 2026-06-02: 8.12 478 mL | Loaded CSV import | Herradura Agave Nectar (`9nm78s`): listed blank; onHand 0 |
| 2 | Alma Avalon | near-certain | #107 Sammy Piquant Jetsetter | SAMMY PIQUANT JETSETTER 700ML BOTTLE (`cmoqfbsdo00jq9ky2k3aq5jkd`) | 10.7 bottle | $179.70 | **$1,922.79** | 2025-12-31: 9 ml | legacy 2025 month-end | Sammy Piquant The Jetsetter (`8qiam2`) counted **6.05 each** on 1 Oct; its onHand 6.2 |
| 3 | St Alma | possible | #202 Colette Rose | Cuvée Colette Rosé 2024 (Case of 6) (`cmoqfbnug009e9ky2xcl291f9`) | 18.4 bottle | $102.00 | **$1,876.80** | 2025-12-31: 9.7 ml | legacy 2025 month-end | La Belle Colette Rose (`9ne9g2`): not on sheet; onHand 0 |
| 4 | St Alma | near-certain | #172 Beef short ribs 3-rib | BEEF SHORT RIBS GRAINFED 3 RIB (`cmoqfbm1m005a9ky2bo078h4b`) | 24.590 kg | $51.80 | **$1,273.77** | 2026-08-31: 0 kg | app count | Beef Short Ribs Grainfed 3rib (`hr91o3`): not on sheet; onHand 0 |
| 5 | St Alma | near-certain | #106 Lyre's Agave Blanco | LYRES AGAVE BLANCO 700ML BOTTLE (`cmoqfbq6600eq9ky2qgnr8ejx`) | 6 bottle | $211.14 | **$1,266.84** | 2026-06-02: 2.67 700 mL | Loaded CSV import | Lyres Agave Blanco (`vkggye`): listed blank; onHand 0 |
| 6 | Alma Avalon | near-certain | #82 Lyre's White Cane | LYRES WHITE CANE SPIRIT 700ML BOTTLE (`cmoqfbq7w00eu9ky2gcs0n6ja`) | 6 bottle | $204.42 | **$1,226.52** | 2025-11-30: 3.3 ml | legacy 2025 month-end | Lyres White Cane (`buuixb`) counted **2.7 can** on 1 Oct; its onHand 1.7 |
| 7 | St Alma | near-certain | #116 Bonnet & Cotton Beaujolais | 2023 Bonnet & Cotton Beaujolais Rogue (Case of 12) (`cmoqfbkha001q9ky2i2jsan2s`) | 28 bottle | $35.00 | **$980.00** | 2026-08-31: 28 bottle | app count | Bonnet & Cotton Beaujolais Rouge (`hnv0ek`) counted **28 bottle** on 1 Oct; its onHand 28 |
| 8 | St Alma | near-certain | #82 Lyre's White Cane | LYRES WHITE CANE SPIRIT 700ML BOTTLE (`cmoqfbq7w00eu9ky2gcs0n6ja`) | 4.372 bottle | $204.42 | **$893.66** | 2026-08-31: 0 bottle | app count | Lyres White Cane (`buuixb`): listed blank; onHand 0 |
| 9 | St Alma | near-certain | #115 Stephane Brocard Gevrey-Chambertin | Stephane Brocard Gevrey-Chambertin (`cmsdf10oe007fmiioqo8nqs8h`) | 6 bottle | $124.54 | **$747.24** | 2026-08-03: 6 bottle | Loaded PDF import | 2022 Stephane Brocard Gevrey-Chambertin Vielles Vignes (Case of 6) (`soxut4`) counted **9 bottle** on 1 Oct; its onHand 9 |
| 10 | Alma Avalon | possible | #193 Triple sec 20 L bulk | TSEC 20L (NoSugar) - 20L - 20% ABV (`cmoqfbtik00mc9ky2871h92mv`) | 1.05 L | $680.00 | **$714.00** | 2025-12-31: 0.375 ml | legacy 2025 month-end | Triple SEC 20L - 20% ABV (`orrz04`): listed blank; onHand 4.4 |
| 11 | St Alma | near-certain | #102 Giffard Rose Syrup | GIFFARD ROSE SYRUP 1L BOTTLE (`cmoqfbp7g00ci9ky2fenupt1l`) | 4.5 bottle | $142.35 | **$640.58** | 2025-12-31: 4.5 ml | legacy 2025 month-end | Giffard Rose Syrup (`2mupn9`) counted **3.1 bottle** on 1 Oct; its onHand 2.1 |
| 12 | St Alma | near-certain | #92 Patron XO Cafe | PATRON XO CAFE 700ML BOTTLE (`cmoqfbri900hs9ky2ttkbikvw`) | 7.2 bottle | $87.66 | **$631.15** | 2025-12-31: 6.7 ml | legacy 2025 month-end | Patron XO Cafe (`x7in1d`) counted **4.5 bottle** on 1 Oct; its onHand 4.5 |
| 13 | St Alma | near-certain | #24 El Tequileno Blanco | EL TEQUILENO BLANCO 750ML - (CASE OF 12) (`cmoqfbogk00as9ky26ir0xs4m`) | 10.95 bottle | $49.00 | **$536.55** | 2025-12-31: 0.65 ml | legacy 2025 month-end | El Tequileno Blanco (`gggwkw`) counted **4.1 bottle** on 1 Oct; its onHand 0.7 |
| 14 | Alma Avalon | near-certain | #24 El Tequileno Blanco | EL TEQUILENO BLANCO 750ML BOTTLE (`cmoqfbohe00au9ky2b5jv59fq`) | 10.5 bottle | $49.00 | **$514.50** | 2025-12-31: 0.8 ml | legacy 2025 month-end | El Tequileno Blanco (`gggwkw`) counted **13.5 bottle** on 1 Oct; its onHand 3.6 |
| 15 | St Alma | near-certain | #185 Tomatillos canned | TOMATILLOS A10 GREEN TOMATO (Faro) EA (6) (`cmoqfbt6e00lk9ky2s49xhsub`) | 36.284 each | $13.50 | **$489.83** | 2026-08-31: 36 each | app count | Tomatillos Green Can (`42rtbn`): not on sheet; onHand 0 |
| 16 | St Alma | near-certain | #108 Supasawa | SUPASAWA 700ML - (CASE OF 6) (`cmoqfbswy00ky9ky2n2nczql9`) | 3.3 bottle | $148.26 | **$489.26** | 2026-06-02: 5.82 700 mL | Loaded CSV import | Supasawa (`llpqd9`) counted **2 bottle** on 1 Oct; its onHand 0 |
| 17 | St Alma | possible | #197 Freshwater Brewing kegs | Secrets Hazy Pale Keg (`cmoqfbsjv00k49ky2xjcdyti7`) | 1.8 keg | $270.00 | **$486.00** | 2025-12-31: 2.2 ml | legacy 2025 month-end | Freshwater Brewing Keg (`59grj4`): not on sheet; onHand — |
| 18 | St Alma | near-certain | #111 Wedge Cerveza Keg | Wedge Cerveza Keg (`cmoqfbtxh00na9ky2u9rt3d49`) | 1.8 keg | $270.00 | **$486.00** | 2025-12-31: 1.9 ml | legacy 2025 month-end | Freshwater Brewing Wedge Cerveza Keg (`f9kaxv`): not on sheet; onHand 0 |
| 19 | St Alma | near-certain | #35 Herradura Seleccion Suprema | HERRADURA SELECCION SUPREMA 750ML BOTTLE (`cmoqfbpmn00dg9ky26x2fue4q`) | 0.95 bottle | $496.24 | **$471.43** | 2025-12-31: 0.9 ml | legacy 2025 month-end | Herradura Seleccion Suprema Extra Anejo (`3gptp6`) counted **0.85 bottle** on 1 Oct; its onHand 0.85 |
| 20 | St Alma | near-certain | #120 Loic Mahe Sables & Schistes | 2022 Loïc Mahe 'Sables & Schists' Chenin Blanc Savennieres (Case of 12) (`cmoqfbkba001c9ky2mg4aq8di`) | 12 bottle | $37.98 | **$455.76** | 2025-12-31: 10 ml | legacy 2025 month-end | Loic Mahe Sables & Schists Chenin Blanc (`wysakf`) counted **3 bottle** on 1 Oct; its onHand 9 |
| 21 | St Alma | near-certain | #0 Aguas Mansas | Aguas Mansas Espadin (`cmsdf10pi0089miio9x0ayy86`) | 6.65 bottle | $65.02 | **$432.38** | 2026-08-03: 6.65 bottle | Loaded PDF import | Aguas Mansas (`1zsvns`) counted **2.8 bottle** on 1 Oct; its onHand 4.1 |
| 22 | Alma Avalon | near-certain | #35 Herradura Seleccion Suprema | HERRADURA SELECCION SUPREMA 750ML BOTTLE (`cmoqfbpmn00dg9ky26x2fue4q`) | 0.8 bottle | $496.24 | **$396.99** | 2025-12-31: 0.6 ml | legacy 2025 month-end | Herradura Seleccion Suprema Extra Anejo (`3gptp6`) counted **0.6 bottle** on 1 Oct; its onHand 0.6 |
| 23 | St Alma | near-certain | #0 Aguas Mansas | AGUAS MANSAS 700ML - (CASE OF 6) (`cmoqfble0003s9ky2wvf7mtfg`) | 6.1 bottle | $65.00 | **$396.50** | 2025-12-31: 5.5 ml | legacy 2025 month-end | Aguas Mansas (`1zsvns`) counted **2.8 bottle** on 1 Oct; its onHand 4.1 |
| 24 | St Alma | near-certain | #107 Sammy Piquant Jetsetter | SAMMY PIQUANT JETSETTER 700ML BOTTLE (`cmoqfbsdo00jq9ky2k3aq5jkd`) | 1.95 bottle | $179.70 | **$350.42** | 2025-12-31: 0.4 ml | legacy 2025 month-end | Sammy Piquant The Jetsetter (`8qiam2`): not on sheet; onHand 0 |
| 25 | St Alma | near-certain | #171 Beef chuck roll | YG BEEF CHUCK ROLL (`cmoqfbu8y00o09ky2md6lkxv9`) | 2.757 kg | $124.00 | **$341.85** | 2026-08-31: 0 kg | app count | Beef Chuck Roll (`syh5ra`): not on sheet; onHand 0 |
| 26 | Alma Avalon | near-certain | #124 Shut The Gate Gewurztraminer | Shut The Gate For Freedom Gewurztraminer (`cmptovx2n00ifs601oytnde3s`) | 20 bottle | $17.03 | **$340.60** | 2026-09-01: 20 bottle | app count | 2023 Shut The Gate For Freedom Gewurtztraminer (Case of 12) (`r32l96`) counted **18 bottle** on 1 Oct; its onHand 15 |
| 27 | St Alma | near-certain | #112 Ca' di Bruno Barbaresco | Ca di Bruno Barbaresco (`cmsdf10lv005lmiiovabrchcu`) | 8 bottle | $42.57 | **$340.56** | 2026-08-03: 8 bottle | Loaded PDF import | 2019 Cà di Bruno Barbaresco DOCG (Case of 6) (`zxe3jt`) counted **12 bottle** on 1 Oct; its onHand 12 |
| 28 | Alma Avalon | near-certain | #109 Watermelon Juice 5 L | Watermelon Juice (1 x 5L) (`cmoqfbtwm00n89ky2nzqu27ne`) | 11.3 L | $30.00 | **$339.00** | 2026-09-01: 11.3 L | app count | Watermelon Juice (`px19ey`) counted **16.6 L** on 1 Oct; its onHand — |
| 29 | St Alma | near-certain | #99 Giffard Coconut Syrup | GIFFARD COCONUT SYRUP 1000ML BOTTLE (`cmoqfbp2600c69ky24p8ikf3e`) | 2.6 bottle | $128.40 | **$333.84** | 2026-06-02: 2.98 1000 ml | Loaded CSV import | Giffard Coconut Syrup (`dlgeog`) counted **2.8 bottle** on 1 Oct; its onHand 3 |
| 30 | Alma Avalon | near-certain | #34 Herradura Reposado | HERRADURA REPOSADO 700ML BOTTLE (`cmoqfbplt00de9ky2fplyh97z`) | 3.95 bottle | $84.33 | **$333.10** | 2025-12-31: 2.6 ml | legacy 2025 month-end | Herradura Reposado (`7x3q5x`) counted **2.5 bottle** on 1 Oct; its onHand 2.5 |
| 31 | Alma Avalon | near-certain | #92 Patron XO Cafe | PATRON XO CAFE 700ML BOTTLE (`cmoqfbri900hs9ky2ttkbikvw`) | 3.7 bottle | $87.66 | **$324.34** | 2025-12-31: 3.15 ml | legacy 2025 month-end | Patron XO Cafe (`x7in1d`) counted **1.85 bottle** on 1 Oct; its onHand 2.6 |
| 32 | St Alma | near-certain | #122 Mon Tout Heydays Chardonnay | 2023 Mon Tout 'Heydays' Chardonnay -skin contact- (Case of 12) (`cmoqfbkr1002c9ky2j322b3z5`) | 22 bottle | $14.67 | **$322.74** | 2025-12-31: 12 ml | legacy 2025 month-end | Mon Tout Chardonnay (`1sqcqq`) counted **9 bottle** on 1 Oct; its onHand 12 |
| 33 | St Alma | near-certain | #113 Villa Albergotti Chianti Superiore | Villa Albergotti Chianti Superiore (`cmptovvhc0069s6014qf2qyy3`) | 14.3 bottle | $21.75 | **$311.02** | 2026-08-03: 14.3 bottle | Loaded PDF import | 2021 Villa Albergotti Chianti Superiore DOCG (Case of 6) (`4xbzfn`) counted **5 bottle** on 1 Oct; its onHand 10.9 |
| 34 | Alma Avalon | near-certain | #0 Aguas Mansas | AGUAS MANSAS 700ML BOTTLE (`cmoqfblev003u9ky20w4npfe3`) | 4.4 bottle | $65.00 | **$286.00** | 2025-12-31: 3.9 ml | legacy 2025 month-end | Aguas Mansas (`1zsvns`) counted **3.6 bottle** on 1 Oct; its onHand 0.95 |
| 35 | Alma Avalon | possible | #200 BenMarco Malbec | 2022 BenMarco Malbec (Case of 6) (`cmoqfbk55000y9ky20svo5cq9`) | 13.8 bottle | $19.75 | **$272.55** | 2025-12-31: 7 ml | legacy 2025 month-end | BenMarco Valle de Uco Malbec (`oyxzcw`) counted **3.7 bottle** on 1 Oct; its onHand 7 |
| 36 | St Alma | near-certain | #16 El Jolgorio Mexicano | EL JOLGORIO MEXICANO (BROWN) 750ML BOTTLE (`cmoqfbo9g00ac9ky26vzlars6`) | 1.25 bottle | $206.93 | **$258.66** | 2025-12-31: 0.75 ml | legacy 2025 month-end | El Jolgorio Mexicano (Brown) (`qi9eax`) counted **1.4 bottle** on 1 Oct; its onHand 1.4 |
| 37 | St Alma | near-certain | #117 Domaine Thomson Explorer Pinot Noir | Domaine Thomson Explorer Pinot Noir (`cmptovvci0059s6012vdipwzj`) | 11 bottle | $23.31 | **$256.41** | 2026-08-03: 11 bottle | Loaded PDF import | 2024 Domaine Thompson Explorer Pinot Noir (Case of 12) (`uy0jlx`) counted **6 bottle** on 1 Oct; its onHand 3.6 |
| 38 | St Alma | possible | #199 Teusner Wark Family Shiraz | 2022 Teusner 'Wark Family' Shiraz (Case of 12) (`cmoqfbkdv001i9ky2leqkwvfo`) | 15 bottle | $16.95 | **$254.25** | 2025-12-31: 6 ml | legacy 2025 month-end | 2023 Teusner 'Wark Family' Shiraz (Case of 12) (`yybxgs`): not on sheet; onHand — |
| 39 | Alma Avalon | near-certain | #22 El Tequileno 1959 Reposado Rare | EL TEQUILENO 1959 REPOSADO RARE 750ML BOTTLE (`cmoqfboes00ao9ky27grn21c4`) | 0.95 bottle | $258.87 | **$245.93** | 2025-12-31: 0.85 ml | legacy 2025 month-end | El Tequileno 1959 Reposado Rare (`ttqxvx`) counted **0.8 bottle** on 1 Oct; its onHand 0.8 |
| 40 | Alma Avalon | near-certain | #105 Lime Juice 5 L | Lime Juice (1 x 5L) (`cmoqfbq3n00ek9ky2f7n9793j`) | 3.5 L | $70.00 | **$245.00** | 2026-09-01: 3.5 L | app count | Lime Juice (`e21lmz`) counted **25.1 L** on 1 Oct; its onHand — |
| 41 | Alma Avalon | possible | #197 Freshwater Brewing kegs | Secrets Hazy Pale Keg (`cmoqfbsjv00k49ky2xjcdyti7`) | 0.9 keg | $270.00 | **$243.00** | 2025-12-31: 2 ml | legacy 2025 month-end | Freshwater Brewing Keg (`59grj4`): listed blank; onHand — |
| 42 | Alma Avalon | near-certain | #10 Don Julio 1942 | DON JULIO 1942 750ML BOTTLE (`cmoqfbnyv009o9ky2yxfcha96`) | 1 bottle | $242.47 | **$242.47** | 2025-12-31: 1 ml | legacy 2025 month-end | Don Julio 1942 (`pnwb8z`) counted **1 bottle** on 1 Oct; its onHand 1 |
| 43 | St Alma | near-certain | #66 Volans Extra Anejo | VOLANS EXTRA ANEJO 750ML BOTTLE (`cmoqfbtuu00n49ky2fio5gbff`) | 1.25 bottle | $192.99 | **$241.24** | 2025-12-31: 1.3 ml | legacy 2025 month-end | Volans Extra Anejo (`vtjmsw`) counted **1.3 bottle** on 1 Oct; its onHand 1.1 |
| 44 | Alma Avalon | near-certain | #33 Herradura Plata | HERRADURA PLATA 700ML BOTTLE (`cmoqfbpkx00dc9ky28s34qym7`) | 3.3 bottle | $72.82 | **$240.31** | 2025-12-31: 1 ml | legacy 2025 month-end | Herradura Plata (`6wrpig`) counted **3.1 bottle** on 1 Oct; its onHand 3.5 |
| 45 | St Alma | near-certain | #121 Inama Soave Classico | 2023 Inama Vin Soave Classico Screwcap (Case of 6) (`cmoqfbkng00249ky2os51r52g`) | 13 bottle | $18.08 | **$235.04** | 2025-12-31: 17 ml | legacy 2025 month-end | Inama Soave Classico (`i1gbqe`) counted **4 bottle** on 1 Oct; its onHand 5 |
| 46 | St Alma | near-certain | #33 Herradura Plata | HERRADURA PLATA 700ML BOTTLE (`cmoqfbpkx00dc9ky28s34qym7`) | 3.2 bottle | $72.82 | **$233.02** | 2025-12-31: 3 ml | legacy 2025 month-end | Herradura Plata (`6wrpig`) counted **2.9 bottle** on 1 Oct; its onHand 2.95 |
| 47 | Alma Avalon | near-certain | #172 Beef short ribs 3-rib | Beef Short Ribs Grainfed 3rib (`cmptowbnz00was601c2hr91o3`) | 8.97 kg | $25.89 | **$232.23** | 2026-08-03: 8.97 kg | Loaded PDF import | BEEF SHORT RIBS GRAINFED 3 RIB (`078h4b`): listed blank; onHand 0 |
| 48 | St Alma | possible | #200 BenMarco Malbec | 2022 BenMarco Valle de Uco (Case of 6) (`cmoqfbk6000109ky29ce36o1h`) | 10 bottle | $22.93 | **$229.30** | 2025-12-31: 22.4 ml | legacy 2025 month-end | BenMarco Valle de Uco Malbec (`oyxzcw`) counted **12 bottle** on 1 Oct; its onHand 12.9 |
| 49 | St Alma | possible | #193 Triple sec 20 L bulk | Triple SEC 20L - 20% ABV (`cmoqfbtf400m49ky2a0orrz04`) | 7.6 L | $30.00 | **$228.00** | 2025-12-31: 0.5 ml | legacy 2025 month-end | TSEC 20L (NoSugar) - 20L - 20% ABV (`1h92mv`): not on sheet; onHand 0.015 |
| 50 | Alma Avalon | near-certain | #80 Vodka One | VODKA ONE 700ML BOTTLE (`cmoqfbtrc00mw9ky2zrisntsx`) | 5.9 bottle | $38.49 | **$227.09** | 2025-12-31: 5.3 ml | legacy 2025 month-end | Vodka One (`1gsrbr`): listed blank; onHand 0 |
| 51 | St Alma | near-certain | #39 Ilegal Reposado | ILEGAL REPOSADO 700ML BOTTLE (`cmoqfbpsj00du9ky2kuexxbon`) | 1.95 bottle | $115.86 | **$225.93** | 2025-12-31: 1.9 ml | legacy 2025 month-end | Ilegal Reposado (`pick3j`) counted **1.7 bottle** on 1 Oct; its onHand 1.6 |
| 52 | St Alma | near-certain | #10 Don Julio 1942 | DON JULIO 1942 750ML BOTTLE (`cmoqfbnyv009o9ky2yxfcha96`) | 0.9 bottle | $242.47 | **$218.22** | 2025-12-31: 0.9 ml | legacy 2025 month-end | Don Julio 1942 (`pnwb8z`) counted **0.7 bottle** on 1 Oct; its onHand 0.75 |
| 53 | St Alma | near-certain | #125 i Lauri Pecorino | 2024 i Lauri Pecorino D'Abruzzo (Case of 6) (`cmoqfbl3c00349ky20k5ndzbl`) | 9 bottle | $23.49 | **$211.41** | 2025-12-31: 5 ml | legacy 2025 month-end | i Lauri AVALOS Pecorino (`z53137`) counted **4 bottle** on 1 Oct; its onHand 4 |
| 54 | St Alma | possible | #199 Teusner Wark Family Shiraz | Teusner Wark Family Shiraz (`cmptovvgk0063s601zzglvf6w`) | 15.2 bottle | $13.83 | **$210.22** | 2026-03-31: 15.2 750 mL | Loaded CSV import | 2022 Teusner 'Wark Family' Shiraz (Case of 12) (`qkwvfo`): not on sheet; onHand 15 |
| 55 | St Alma | near-certain | #119 Chateau La Grave Figeac | Cheateau La Grave Figeac St Emilion Grand Cru (`cmsdf10mb005xmiiod0q42oc0`) | 3 bottle | $69.80 | **$209.40** | 2026-08-03: 3 bottle | Loaded PDF import | Chateau La Grave Figeac (`t02x73`) counted **3 bottle** on 1 Oct; its onHand 3 |
| 56 | Alma Avalon | near-certain | #106 Lyre's Agave Blanco | LYRES AGAVE BLANCO 700ML BOTTLE (`cmoqfbq6600eq9ky2qgnr8ejx`) | 0.986 bottle | $211.14 | **$208.14** | 2026-09-01: 0 bottle | app count | Lyres Agave Blanco (`vkggye`) counted **5.8 bottle** on 1 Oct; its onHand 5.7 |
| 57 | Alma Avalon | near-certain | #108 Supasawa | SUPASAWA 700ML - (CASE OF 6) (`cmoqfbswy00ky9ky2n2nczql9`) | 1.4 bottle | $148.26 | **$207.56** | 2026-06-02: 12.09 700 mL | Loaded CSV import | Supasawa (`llpqd9`) counted **1 bottle** on 1 Oct; its onHand 6.1 |
| 58 | St Alma | near-certain | #123 Nick Spencer Gruner Veltliner | 2023 Nick Spencer Gruner Veltliner (Case of 12) (`cmoqfbkry002e9ky28n1zmqnu`) | 10 bottle | $20.29 | **$202.90** | 2025-12-31: 10 ml | legacy 2025 month-end | Nick Spencer Tumbarumba Gruner Veltliner (`qf5uyk`) counted **6 bottle** on 1 Oct; its onHand 8 |

## 2. Decision per holding: duplicated catalogue record vs genuine valuation/holding error

Method. For each stale holding I looked at (a) whether a twin in the same cluster has a counted line on that venue's 1 Oct sheet, (b) the holding's own last count date and quantity, (c) the last applied `InventoryMovement` for the holding (its notes say "Counted X loose + Y held in <prep>" when the apply credited prepped stock), and (d) the unit cost against the floor twin and supplier invoices.

Three outcomes:

- **DUPLICATED CATALOGUE RECORD** — a twin was counted on the 1 Oct sheet, this record's last count is older, and the quantities are the same order of magnitude (often identical). The physical stock is accounted for under the twin; this holding is a stale copy. Treatment: set the holding to 0 before merging (never let `mergeItems` sum it).
- **GENUINE, PREP-HELD** — the holding is non-zero *because* the applied sheet counted 0 loose and the apply code added the quantity of this ingredient inside counted prep batches ("Short Ribs", "Sensible Marg Batch", …). It is real stock, credited to the invoice-named twin only because `RecipeLine.itemId` points there. Not stale; the merge must repoint recipe lines, and several of these carry a wrong (case) cost.
- **GENUINE HOLDING QUESTION (recount)** — no twin was counted on the 1 Oct sheet at that venue, so nothing on the sheet accounts for the stock. The quantity is whatever the last count said (often the Sep-25 legacy value); some also carry a case cost.

| Venue | Outcome | Holdings | Value at current cost |
|---|---|---:|---:|
| Alma Avalon | DUPLICATE-STALE | 122 | $12,988.55 |
| Alma Avalon | PREP-HELD | 6 | $433.41 |
| Alma Avalon | UNCOUNTED | 56 | $5,007.96 |
| St Alma | DUPLICATE-STALE | 110 | $15,651.49 |
| St Alma | PREP-HELD | 33 | $3,531.91 |
| St Alma | UNCOUNTED | 56 | $6,787.80 |
| **Both** | DUPLICATE (discard) | 232 | **$28,640.04** |
| **Both** | PREP-HELD (keep, repoint recipes, fix cost) | 39 | **$3,965.32** |
| **Both** | UNCOUNTED (recount) | 112 | **$11,795.76** |

### 2a. Decisions for every holding over $200

| # | Venue | Item | Value | Decision | Evidence |
|---|---|---|---:|---|---|
| 1 | Alma Avalon | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) (`gje5og`) | $2,023.20 | **Genuine question — recount** · wrong cost | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 15 each; last count 8.12 478 mL on 2026-06-02 (Loaded CSV import) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. Cost is wrong: use 1124¢ (13488 ÷ 12 (case of 12); floor twin 1228). |
| 2 | Alma Avalon | SAMMY PIQUANT JETSETTER 700ML BOTTLE (`aq5jkd`) | $1,922.79 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (6.05 vs this record's 10.7); this record's last count (2025-12-31, 9 ml) predates it. Discard this holding (set 0) before merging. |
| 3 | St Alma | Cuvée Colette Rosé 2024 (Case of 6) (`l291f9`) | $1,876.80 | **Genuine question — recount** · wrong cost | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 18.4 bottle; last count 9.7 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. Cost is wrong: use 1700¢ (10200 ÷ 6; floor La Belle Colette 1964). |
| 4 | St Alma | BEEF SHORT RIBS GRAINFED 3 RIB (`078h4b`) | $1,273.77 | **Genuine, prep-held** · wrong cost | GENUINE but prep-derived — the applied sheet counted 0 loose and credited 24.590223 kg held in prep (Short Ribs) to this record because recipe lines point at the invoice twin. Not stale; the merge must repoint RecipeLine so the credit lands on the canonical. Cost is wrong: use 2900¢ (FoodByUs invoices Jun–Jul 2026: 57.4 kg = $1,664.60, 17.1 kg = $495.90 → $29.00/kg). |
| 5 | St Alma | LYRES AGAVE BLANCO 700ML BOTTLE (`nr8ejx`) | $1,266.84 | **Genuine question — recount** · wrong cost | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 6 bottle; last count 2.67 700 mL on 2026-06-02 (Loaded CSV import) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. Cost is wrong: use 2925¢ (floor twin Lyres Agave Blanco 2925). |
| 6 | Alma Avalon | LYRES WHITE CANE SPIRIT 700ML BOTTLE (`s0n6ja`) | $1,226.52 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2.7 vs this record's 6); this record's last count (2025-11-30, 3.3 ml) predates it. Discard this holding (set 0) before merging. |
| 7 | St Alma | 2023 Bonnet & Cotton Beaujolais Rogue (Case of 12) (`jsan2s`) | $980.00 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (28 vs this record's 28); this record's last count (2026-08-31, 28 bottle) predates it. Discard this holding (set 0) before merging. |
| 8 | St Alma | LYRES WHITE CANE SPIRIT 700ML BOTTLE (`s0n6ja`) | $893.66 | **Genuine, prep-held** · wrong cost | GENUINE but prep-derived — the applied sheet counted 0 loose and credited 4.371703 bottle held in prep (Sensible Marg Batch) to this record because recipe lines point at the invoice twin. Not stale; the merge must repoint RecipeLine so the credit lands on the canonical. Cost is wrong: use 2926¢ (floor twin Lyres White Cane 2926). |
| 9 | St Alma | Stephane Brocard Gevrey-Chambertin (`8nqs8h`) | $747.24 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (9 vs this record's 6); this record's last count (2026-08-03, 6 bottle) predates it. Discard this holding (set 0) before merging. |
| 10 | Alma Avalon | TSEC 20L (NoSugar) - 20L - 20% ABV (`1h92mv`) | $714.00 | **Genuine question — recount** · wrong cost | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 1.05 L; last count 0.375 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. Cost is wrong: use 3400¢ (68000 ÷ 20 L drum; twin Triple SEC 20L 3000/L). |
| 11 | St Alma | GIFFARD ROSE SYRUP 1L BOTTLE (`nupt1l`) | $640.58 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (3.1 vs this record's 4.5); this record's last count (2025-12-31, 4.5 ml) predates it. Discard this holding (set 0) before merging. |
| 12 | St Alma | PATRON XO CAFE 700ML BOTTLE (`kbikvw`) | $631.15 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (4.5 vs this record's 7.2); this record's last count (2025-12-31, 6.7 ml) predates it. Discard this holding (set 0) before merging. |
| 13 | St Alma | EL TEQUILENO BLANCO 750ML - (CASE OF 12) (`r0xs4m`) | $536.55 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (4.1 vs this record's 10.95); this record's last count (2025-12-31, 0.65 ml) predates it. Discard this holding (set 0) before merging. |
| 14 | Alma Avalon | EL TEQUILENO BLANCO 750ML BOTTLE (`jv59fq`) | $514.50 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (13.5 vs this record's 10.5); this record's last count (2025-12-31, 0.8 ml) predates it. Discard this holding (set 0) before merging. |
| 15 | St Alma | TOMATILLOS A10 GREEN TOMATO (Faro) EA (6) (`9xhsub`) | $489.83 | **Genuine, prep-held** | GENUINE but prep-derived — the applied sheet counted 36 loose and credited 0.283898 each held in prep (Tomatillo Salsa) to this record because recipe lines point at the invoice twin. Not stale; the merge must repoint RecipeLine so the credit lands on the canonical. |
| 16 | St Alma | SUPASAWA 700ML - (CASE OF 6) (`nczql9`) | $489.26 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2 vs this record's 3.3); this record's last count (2026-06-02, 5.82 700 mL) predates it. Discard this holding (set 0) before merging. |
| 17 | St Alma | Secrets Hazy Pale Keg (`cdyti7`) | $486.00 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 1.8 keg; last count 2.2 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. |
| 18 | St Alma | Wedge Cerveza Keg (`rt3d49`) | $486.00 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 1.8 keg; last count 1.9 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. |
| 19 | St Alma | HERRADURA SELECCION SUPREMA 750ML BOTTLE (`2fue4q`) | $471.43 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (0.85 vs this record's 0.95); this record's last count (2025-12-31, 0.9 ml) predates it. Discard this holding (set 0) before merging. |
| 20 | St Alma | 2022 Loïc Mahe 'Sables & Schists' Chenin Blanc Savennieres (Case of 12) (`4aq8di`) | $455.76 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (3 vs this record's 12); this record's last count (2025-12-31, 10 ml) predates it. Discard this holding (set 0) before merging. |
| 21 | St Alma | Aguas Mansas Espadin (`0ayy86`) | $432.38 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2.8 vs this record's 6.65); this record's last count (2026-08-03, 6.65 bottle) predates it. Discard this holding (set 0) before merging. |
| 22 | Alma Avalon | HERRADURA SELECCION SUPREMA 750ML BOTTLE (`2fue4q`) | $396.99 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (0.6 vs this record's 0.8); this record's last count (2025-12-31, 0.6 ml) predates it. Discard this holding (set 0) before merging. |
| 23 | St Alma | AGUAS MANSAS 700ML - (CASE OF 6) (`f7mtfg`) | $396.50 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2.8 vs this record's 6.1); this record's last count (2025-12-31, 5.5 ml) predates it. Discard this holding (set 0) before merging. |
| 24 | St Alma | SAMMY PIQUANT JETSETTER 700ML BOTTLE (`aq5jkd`) | $350.42 | **Genuine question — recount** · wrong cost | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 1.95 bottle; last count 0.4 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. Cost is wrong: use 3406¢ (floor twin Sammy Piquant The Jetsetter 3406). |
| 25 | St Alma | YG BEEF CHUCK ROLL (`6lkxv9`) | $341.85 | **Genuine, prep-held** · wrong cost | GENUINE but prep-derived — the applied sheet counted 0 loose and credited 2.756846 kg held in prep (Beef Birria) to this record because recipe lines point at the invoice twin. Not stale; the merge must repoint RecipeLine so the credit lands on the canonical. Cost is wrong: use 2050¢ (FoodByUs invoices: 13.9 kg = $284.95 → $20.50/kg; floor twin 2050). |
| 26 | Alma Avalon | Shut The Gate For Freedom Gewurztraminer (`tnde3s`) | $340.60 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (18 vs this record's 20); this record's last count (2026-09-01, 20 bottle) predates it. Discard this holding (set 0) before merging. |
| 27 | St Alma | Ca di Bruno Barbaresco (`brchcu`) | $340.56 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (12 vs this record's 8); this record's last count (2026-08-03, 8 bottle) predates it. Discard this holding (set 0) before merging. |
| 28 | Alma Avalon | Watermelon Juice (1 x 5L) (`qu27ne`) | $339.00 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (16.6 vs this record's 11.3); this record's last count (2026-09-01, 11.3 L) predates it. Discard this holding (set 0) before merging. |
| 29 | St Alma | GIFFARD COCONUT SYRUP 1000ML BOTTLE (`8ikf3e`) | $333.84 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2.8 vs this record's 2.6); this record's last count (2026-06-02, 2.98 1000 ml) predates it. Discard this holding (set 0) before merging. |
| 30 | Alma Avalon | HERRADURA REPOSADO 700ML BOTTLE (`lyh97z`) | $333.10 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2.5 vs this record's 3.95); this record's last count (2025-12-31, 2.6 ml) predates it. Discard this holding (set 0) before merging. |
| 31 | Alma Avalon | PATRON XO CAFE 700ML BOTTLE (`kbikvw`) | $324.34 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (1.85 vs this record's 3.7); this record's last count (2025-12-31, 3.15 ml) predates it. Discard this holding (set 0) before merging. |
| 32 | St Alma | 2023 Mon Tout 'Heydays' Chardonnay -skin contact- (Case of 12) (`22b3z5`) | $322.74 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (9 vs this record's 22); this record's last count (2025-12-31, 12 ml) predates it. Discard this holding (set 0) before merging. |
| 33 | St Alma | Villa Albergotti Chianti Superiore (`f2qyy3`) | $311.02 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (5 vs this record's 14.3); this record's last count (2026-08-03, 14.3 bottle) predates it. Discard this holding (set 0) before merging. |
| 34 | Alma Avalon | AGUAS MANSAS 700ML BOTTLE (`4npfe3`) | $286.00 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (3.6 vs this record's 4.4); this record's last count (2025-12-31, 3.9 ml) predates it. Discard this holding (set 0) before merging. |
| 35 | Alma Avalon | 2022 BenMarco Malbec (Case of 6) (`vo5cq9`) | $272.55 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (3.7 vs this record's 13.8); this record's last count (2025-12-31, 7 ml) predates it. Discard this holding (set 0) before merging. |
| 36 | St Alma | EL JOLGORIO MEXICANO (BROWN) 750ML BOTTLE (`zlars6`) | $258.66 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (1.4 vs this record's 1.25); this record's last count (2025-12-31, 0.75 ml) predates it. Discard this holding (set 0) before merging. |
| 37 | St Alma | Domaine Thomson Explorer Pinot Noir (`dipwzj`) | $256.41 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (6 vs this record's 11); this record's last count (2026-08-03, 11 bottle) predates it. Discard this holding (set 0) before merging. |
| 38 | St Alma | 2022 Teusner 'Wark Family' Shiraz (Case of 12) (`qkwvfo`) | $254.25 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 15 bottle; last count 6 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. |
| 39 | Alma Avalon | EL TEQUILENO 1959 REPOSADO RARE 750ML BOTTLE (`rn21c4`) | $245.93 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (0.8 vs this record's 0.95); this record's last count (2025-12-31, 0.85 ml) predates it. Discard this holding (set 0) before merging. |
| 40 | Alma Avalon | Lime Juice (1 x 5L) (`n9793j`) | $245.00 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (25.1 vs this record's 3.5); this record's last count (2026-09-01, 3.5 L) predates it. Discard this holding (set 0) before merging. |
| 41 | Alma Avalon | Secrets Hazy Pale Keg (`cdyti7`) | $243.00 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 0.9 keg; last count 2 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. |
| 42 | Alma Avalon | DON JULIO 1942 750ML BOTTLE (`fcha96`) | $242.47 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (1 vs this record's 1); this record's last count (2025-12-31, 1 ml) predates it. Discard this holding (set 0) before merging. |
| 43 | St Alma | VOLANS EXTRA ANEJO 750ML BOTTLE (`o5gbff`) | $241.24 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (1.3 vs this record's 1.25); this record's last count (2025-12-31, 1.3 ml) predates it. Discard this holding (set 0) before merging. |
| 44 | Alma Avalon | HERRADURA PLATA 700ML BOTTLE (`34qym7`) | $240.31 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (3.1 vs this record's 3.3); this record's last count (2025-12-31, 1 ml) predates it. Discard this holding (set 0) before merging. |
| 45 | St Alma | 2023 Inama Vin Soave Classico Screwcap (Case of 6) (`51r52g`) | $235.04 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (4 vs this record's 13); this record's last count (2025-12-31, 17 ml) predates it. Discard this holding (set 0) before merging. |
| 46 | St Alma | HERRADURA PLATA 700ML BOTTLE (`34qym7`) | $233.02 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (2.9 vs this record's 3.2); this record's last count (2025-12-31, 3 ml) predates it. Discard this holding (set 0) before merging. |
| 47 | Alma Avalon | Beef Short Ribs Grainfed 3rib (`hr91o3`) | $232.23 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 8.97 kg; last count 8.97 kg on 2026-08-03 (Loaded PDF import). Recount. |
| 48 | St Alma | 2022 BenMarco Valle de Uco (Case of 6) (`e36o1h`) | $229.30 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (12 vs this record's 10); this record's last count (2025-12-31, 22.4 ml) predates it. Discard this holding (set 0) before merging. |
| 49 | St Alma | Triple SEC 20L - 20% ABV (`orrz04`) | $228.00 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 7.6 L; last count 0.5 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. |
| 50 | Alma Avalon | VODKA ONE 700ML BOTTLE (`isntsx`) | $227.09 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 5.9 bottle; last count 5.3 ml on 2025-12-31 (legacy 2025 month-end) — they differ because the Sep-25 legacy sheet was applied last (section 0.2). Recount. |
| 51 | St Alma | ILEGAL REPOSADO 700ML BOTTLE (`exxbon`) | $225.93 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (1.7 vs this record's 1.95); this record's last count (2025-12-31, 1.9 ml) predates it. Discard this holding (set 0) before merging. |
| 52 | St Alma | DON JULIO 1942 750ML BOTTLE (`fcha96`) | $218.22 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (0.7 vs this record's 0.9); this record's last count (2025-12-31, 0.9 ml) predates it. Discard this holding (set 0) before merging. |
| 53 | St Alma | 2024 i Lauri Pecorino D'Abruzzo (Case of 6) (`5ndzbl`) | $211.41 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (4 vs this record's 9); this record's last count (2025-12-31, 5 ml) predates it. Discard this holding (set 0) before merging. |
| 54 | St Alma | Teusner Wark Family Shiraz (`glvf6w`) | $210.22 | **Genuine question — recount** | GENUINE HOLDING QUESTION — no twin was counted on the 1 Oct sheet, so nothing on the sheet accounts for this stock. onHand 15.2 bottle; last count 15.2 750 mL on 2026-03-31 (Loaded CSV import). Recount. |
| 55 | St Alma | Cheateau La Grave Figeac St Emilion Grand Cru (`q42oc0`) | $209.40 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (3 vs this record's 3); this record's last count (2026-08-03, 3 bottle) predates it. Discard this holding (set 0) before merging. |
| 56 | Alma Avalon | LYRES AGAVE BLANCO 700ML BOTTLE (`nr8ejx`) | $208.14 | **Genuine, prep-held** · wrong cost | GENUINE but prep-derived — the applied sheet counted 0 loose and credited 0.985776 bottle held in prep (Sensible Marg Batch) to this record because recipe lines point at the invoice twin. Not stale; the merge must repoint RecipeLine so the credit lands on the canonical. Cost is wrong: use 2925¢ (floor twin Lyres Agave Blanco 2925). |
| 57 | Alma Avalon | SUPASAWA 700ML - (CASE OF 6) (`nczql9`) | $207.56 | **Duplicate** · wrong cost | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (1 vs this record's 1.4); this record's last count (2026-06-02, 12.09 700 mL) predates it. Discard this holding (set 0) before merging. |
| 58 | St Alma | 2023 Nick Spencer Gruner Veltliner (Case of 12) (`1zmqnu`) | $202.90 | **Duplicate** | DUPLICATED CATALOGUE RECORD — the same bottles are on the 1 Oct sheet under the twin (6 vs this record's 10); this record's last count (2025-12-31, 10 ml) predates it. Discard this holding (set 0) before merging. |

Notes on specific lines above:

- **Bonnet & Cotton (St Alma, #116)**: both twins carry 28 at St Alma — the 31/08 Bar & FOH sheet (applied) counted the May item at 28 and the 1 Oct sheet counted the floor item at 28. St Alma's onHand already double-counts these 28 bottles ($980). A merge without zeroing the twin would write 56.
- **Shut The Gate For Freedom (Avalon, #124)**: the 9/1 Avalon sheet counted *both* twins (20 and 15) and 1 Oct counted the floor item at 18. Treated as duplicate, but 35 vs 18 bottles is worth a shelf check: "2023 Shut The Gate For Freedom" vs the undated floor item could be two vintages.
- **Watermelon Juice / Lime Juice (1 x 5L) (Avalon, #109/#105)**: the 9/1 count landed on the May items (11.3 L, 3.5 L), the 1 Oct count on the Aug floor items (16.6 L, 25.1 L) whose onHand is still NULL. Same juice, different record each month. "Lime Juice (1 x 5L)" is costed at $70.00/L; the 17 Jun 2026 Produce to Perfection invoice is $15.20 for 2 L ($7.60/L).
- **Herradura Agave Nectar (Avalon, #104)**: 15 "each" is the Sep-25 legacy count (12.9 → 15.5 at St Alma was then zeroed by the 31/8 kitchen sheet; Avalon was never recounted). $134.88 is the case-of-12 price; per bottle ≈ $11.24, so even if all 15 exist the value is $168.60, not $2,023.
- **Beef short ribs (St Alma, #172)**: the 31/8 kitchen sheet counted 0 loose ribs and 30 kg of "Short Ribs" prep (recipe: 20.573 kg of ribs per batch); the apply credited 24.59 kg to this record — real braised stock, not a stale count. The May item's $51.80/kg is wrong: 12 FoodByUs invoices Apr–Jul 2026 are $29.00/kg. Correct value ≈ $713, not $1,274.
- **Lyres (both venues, #82/#106)**: all four Lyres holdings over $200 are costed at $204–211 a bottle; the floor twins are $29.25–29.26. Two are prep-held (Sensible Marg Batch), one is a Dec-25 duplicate, one (St Alma Lyres Agave Blanco, 6 bottles) is uncounted. Corrected (and with the Avalon Dec-25 duplicate discarded) the four are worth $508 together, not $3,595.
- **Kegs (St Alma, #197/#111)**: "Secrets Hazy Pale Keg" and "Wedge Cerveza Keg" at 1.8 kegs each are Dec-25/Sep-25 legacy values; no keg of any name was counted on the St Alma 1 Oct sheet, and the Avalon sheet lists six keg lines all blank. Kegs were simply not counted — recount, do not discard.
- **TSEC 20L (NoSugar) (Avalon, #193)** is $680.00 per litre — the 20 L drum price. At $34.00/L the 1.05 L is $35.70. Neither triple-sec drum was counted at Avalon on 1 Oct (Triple SEC 20L listed blank with onHand 4.4 L).

### 2b. The 6 Avalon / 33 St Alma prep-held holdings

| Venue | Item | onHand | Movement note (abridged) |
|---|---|---:|---|
| St Alma | BEEF SHORT RIBS GRAINFED 3 RIB (`078h4b`) | 24.590 kg = $1,273.77 | counted 0 loose + 24.590223 kg in Short Ribs |
| St Alma | LYRES WHITE CANE SPIRIT 700ML BOTTLE (`s0n6ja`) | 4.372 bottle = $893.66 | counted 0 loose + 4.371703 bottle in Sensible Marg Batch |
| St Alma | TOMATILLOS A10 GREEN TOMATO (Faro) EA (6) (`9xhsub`) | 36.284 each = $489.83 | counted 36 loose + 0.283898 each in Tomatillo Salsa |
| St Alma | YG BEEF CHUCK ROLL (`6lkxv9`) | 2.757 kg = $341.85 | counted 0 loose + 2.756846 kg in Beef Birria |
| Alma Avalon | LYRES AGAVE BLANCO 700ML BOTTLE (`nr8ejx`) | 0.986 bottle = $208.14 | counted 0 loose + 0.985776 bottle in Sensible Marg Batch |
| St Alma | MAYONNAISE WHOLE EGG 15KG (Birch & Waite) EA (`v7olue`) | 0.916 each = $107.21 | counted 0.2 loose + 0.716292 each in Salmon & Guajillo Pate, Chipotle Mayo |
| Alma Avalon | GIFFARD ROSE SYRUP 1L BOTTLE (`nupt1l`) | 0.725 bottle = $103.20 | counted 0.5 loose + 0.225 bottle in Beach, Please Batch |
| St Alma | Onions Spanish Large Bag (`ze22b1`) | 2.555 each = $81.76 | counted 0 loose + 2.555085 each in Tomatillo Salsa |
| St Alma | LYRES TRIPLE SEC 700ML BOTTLE (`pz087i`) | 2.186 bottle = $76.92 | counted 0 loose + 2.185852 bottle in Sensible Marg Batch |
| Alma Avalon | GIFFARD COCONUT SYRUP 1000ML BOTTLE (`8ikf3e`) | 0.526 bottle = $67.50 | counted 0 loose + 0.525686 bottle in Coconut Margarita Batch |
| St Alma | CHICKEN THIGH FILLETS SKIN OFF (`97b2mv`) | 2.877 kg = $53.22 | counted 0 loose + 2.876757 kg in Chicken Tinga |
| Alma Avalon | LYRES TRIPLE SEC 700ML BOTTLE (`pz087i`) | 0.996 bottle = $35.04 | counted 0.01 loose + 0.985776 bottle in Sensible Marg Batch |
| St Alma | TOMATO box LRG (10kg) (`5k7g6p`) | 0.431 each = $27.93 | counted 0 loose + 0.430956 each in Short Ribs, Beef Birria, Chicken Tinga |
| St Alma | Tomatoes Large Box (`97oeb6`) | 0.758 each = $26.91 | counted 0.474 loose + 0.283898 each in Tomatillo Salsa |
| St Alma | MILK LONG LIFE UHT 1LT (Devondale) EA (10) (`cjfmi6`) | 8.165 each = $21.64 | counted 2 loose + 6.165092 each in Polenta Fries, White Chocolate Almond Ganache |
| St Alma | Mexican Oregano - 250g (`iwf2bf`) | 1.064 each = $18.83 | counted 0.82 loose + 0.243879 each in Chimichurri, Beef Birria |
| St Alma | Cauliflower Each (`ifslkb`) | 3.671 each = $17.62 | counted 0 loose + 3.670732 each in Cauliflower Puree |
| St Alma | CREAM THICK FRESH 5LT (Dairy Farmers) EA (3) (`6p4gg7`) | 0.451 each = $16.77 | counted 0.24 loose + 0.21083 each in Cauliflower Puree, White Chocolate Almond Ganache |
| St Alma | SALT TABLE 14KG (Olssons) CTN (`b89fp0`) | 1.091 each = $15.27 | counted 1.09 loose + 0.000608 each in Tomatillo Salsa |
| Alma Avalon | GIFFARD GINGER SYRUP 1000ML BOTTLE (`s8f0n8`) | 0.688 bottle = $14.71 | counted 0 loose + 0.6875 bottle in Ginger Spice Batch |
| St Alma | OIL OLIVE POMACE 4L (Trading) (`bfja0w`) | 0.417 each = $10.85 | counted 0.3 loose + 0.11731 each in Cauliflower Puree, Chimichurri, Chicken Tinga |
| St Alma | OIL OLIVE EXTRA VIRGIN 4LT (Natures Secret) (`f9olq3`) | 0.819 L = $10.04 | counted 0 loose + 0.819406 L in Salsa Macha |
| St Alma | Onions Brown Med-Lge 10kg Bag (`pn80eh`) | 5.042 kg = $9.83 | counted 0 loose + 5.042474 kg in Cauliflower Puree, Salsa Macha, Short Ribs, Beef Birria, Chicken Tinga, Mole Verde |
| St Alma | Whole dried Guajillo (Mirasol) Chilli 1kg (`c9vwwh`) | 0.176 each = $8.47 | counted 0 loose + 0.175988 each in Salmon & Guajillo Pate, Cauliflower Puree, Salsa Macha, Beef Birria |
| St Alma | Callebaut Chocolate White Callet 28% 2.5kg (`j9dwty`) | 0.055 each = $6.01 | counted 0 loose + 0.054966 each in White Chocolate Almond Ganache |
| St Alma | ALLSPICE WHOLE 350GM (Galaxy) EA (`8runbo`) | 0.367 each = $5.14 | counted 0.17 loose + 0.197277 each in Short Ribs, Beef Birria, Chicken Tinga, Mole Verde |
| Alma Avalon | GIFFARD FALERNUM 1000ML BOTTLE (`00l6gn`) | 0.225 bottle = $4.82 | counted 0 loose + 0.225 bottle in Beach, Please Batch |
| St Alma | CHIPOTLE CHILLIS A10 IN ADOBE SCE 3KG (Faro) EA (6) (`5tiwej`) | 0.245 each = $4.53 | counted 0 loose + 0.244853 each in Chipotle Mayo, Chicken Tinga |
| St Alma | PEPPER CORNS BLACK WHOLE 500GM (Windsor Farm) EA (`7l87g8`) | 0.204 each = $3.16 | counted 0 loose + 0.2038 each in Beef Birria, Polenta Fries, Tomatillo Salsa, Chicken Tinga |
| St Alma | SESAME SEED WHITE 1KG (Galaxy) EA (12) (`8qaiuw`) | 0.312 each = $2.81 | counted 0 loose + 0.312161 each in Salsa Macha, Mole Verde |
| St Alma | THYME LEAVES 200GM (Natures Secret) EA (`pigdc8`) | 0.298 each = $2.38 | counted 0 loose + 0.297956 each in Chimichurri |
| St Alma | Capsicum Red Large Kg (`ucn5r4`) | 0.238 kg = $1.38 | counted 0 loose + 0.238365 kg in Chimichurri |
| St Alma | CUMIN GROUND 450GM (Chefs Choice) EA (`4gk1ve`) | 0.150 each = $1.20 | counted 0.13 loose + 0.019811 each in Beef Birria, Chicken Tinga |
| St Alma | PEANUTS ROASTED SALTED 1KG (Galaxy) EA (12) (`0xpza8`) | 0.148 each = $1.19 | counted 0 loose + 0.14828 each in Mole Verde |
| St Alma | Coriander Dozen (`1uo52e`) | 3.731 dozen = $0.75 | counted 0 loose + 3.730637 dozen in Chimichurri, Short Ribs, Mole Verde |
| St Alma | VINEGAR WHITE WINE 500ML (PGF) EA (`tmc7au`) | 0.138 each = $0.69 | counted 0 loose + 0.137842 each in Beef Birria |
| St Alma | Chilli Jalapeno Kg (`a6sixk`) | 0.015 kg = $0.21 | counted 0 loose + 0.014828 kg in Mole Verde |
| St Alma | CINNAMON GROUND 400GM (Chefs Choice) EA (`qa9af7`) | 0.004 each = $0.05 | counted 0 loose + 0.004308 each in Beef Birria |
| St Alma | Carrots Medium (`ijhsw1`) | 0.012 each = $0.03 | counted 0 loose + 0.011953 each in Short Ribs |

## 3. Holdings outside the clusters: why Avalon reads $2.97M and St Alma $225k


### 3a. Alma Avalon — 342 non-cluster holdings, $2,967,246.72; top 25 = $2,961,120.51

| # | Item (id) | onHand | Count unit · measure | Avg cost | Value | Last count (source) | 1 Oct line | Classification |
|---|---|---:|---|---:|---:|---|---|---|
| 1 | Massenez Creme de Peche (`cmptovuxi002fs601ncx5ye8f`) | 4800 | bottle · 750 ml | $220.91 | **$1,060,368.00** | 2026-10-01: 4.9 L (app count) | 4.9 L | mL entered as bottles (and the "bottle" is a 5 L pack) → 0.96 bottle = $212.07 |
| 2 | Manly Spirits Dry Gin (`cmptovwfz00drs601ep9r8o8y`) | 19400 | bottle · 750 ml | $45.01 | **$873,194.00** | 2026-09-01: 19400 mL (app count) | blank | mL entered as bottles → 25.867 bottle = $1,164.26 |
| 3 | Manly Spirits Triple Sec No Sugar (`cmptovwgv00dxs601pi20zgpp`) | 16500 | bottle · 750 ml | $29.07 | **$479,655.00** | 2026-10-01: 11 L (app count) | 11 L | mL entered as bottles → 22 bottle = $639.54 |
| 4 | Manly Spirits Triple Sec (`cmptovwge00dus601f7xn8avx`) | 9350 | bottle · 750 ml | $29.07 | **$271,804.50** | 2026-10-01: 2 L (app count) | 2 L | mL entered as bottles → 12.467 bottle = $362.41 |
| 5 | Manly Spirits Vodka (`cmptovwhb00e0s601nys0gi1x`) | 7500 | bottle · 750 ml | $36.00 | **$270,000.00** | 2026-10-01: 5.1 L (app count) | 5.1 L | mL entered as bottles → 10 bottle = $360.00 |
| 6 | Kendall Jackson Vintners Reserve Chardonnay (`cmptovx1j00i6s60122qvd3ss`) | 17 | bottle · 750 ml | $55.90 | **$950.30** | 2026-10-01: 16 bottle (app count) | 16 bottle | plausible; 1 Oct (unapplied) count is 16 bottle → will move to that on apply |
| 7 | El Tequileno Reposado (`cmptovw2e00aus601h0ukw0h1`) | 9.4 | bottle · 750 ml | $51.99 | **$488.71** | 2026-10-01: 4.6 bottle (app count) | 4.6 bottle | plausible; 1 Oct (unapplied) count is 4.6 bottle → will move to that on apply |
| 8 | Eperosa Magnolia Semillon (`cmptovwxr00hfs601579kkvqj`) | 11.8 | bottle · 750 ml | $30.00 | **$354.00** | 2026-10-01: 0 bottle (app count) | 0 bottle | plausible; 1 Oct (unapplied) count is 0 bottle → will move to that on apply |
| 9 | Badenhorst Secateurs Chenin Blanc (`cmptovwx100h9s601v4ar2i63`) | 15 | bottle · 750 ml | $23.00 | **$345.00** | 2026-10-01: 0 bottle (app count) | 0 bottle | plausible; 1 Oct (unapplied) count is 0 bottle → will move to that on apply |
| 10 | Frogmore Creek Riesling (`cmptovwyi00hls601zr66wkhy`) | 16 | bottle · 750 ml | $21.16 | **$338.56** | 2026-10-01: 11 bottle (app count) | 11 bottle | plausible; 1 Oct (unapplied) count is 11 bottle → will move to that on apply |
| 11 | CORONA BOTTLE - (CASE OF 24) (`cmoqfbnmp008w9ky2dmlgo49x`) | 117 | bottle · 750 ml | $2.54 | **$297.18** | 2026-10-01: 44 bottle (app count) | 44 bottle | plausible; 1 Oct (unapplied) count is 44 bottle → will move to that on apply |
| 12 | Geoff Merrill Reserve Cabernet Sauvignon (`cmptovvdr005is601zb90suqp`) | 10 | bottle · 750 ml | $28.84 | **$288.40** | 2026-10-01: 0 bottle (app count) | 0 bottle | plausible; 1 Oct (unapplied) count is 0 bottle → will move to that on apply |
| 13 | El Jolgorio Jabali (Black Tan) (`cmptovvwz009ls601e2p27ihm`) | 0.9 | bottle · 750 ml | $311.05 | **$279.94** | 2026-10-01: 0.9 bottle (app count) | 0.9 bottle | plausible; matches the 1 Oct count |
| 14 | Marionette Blue Curacao (`cmptovuwm0029s6016gkk6526`) | 6 | bottle · 750 ml | $45.11 | **$270.66** | 2026-10-01: 4.3 bottle (app count) | 4.3 bottle | plausible; 1 Oct (unapplied) count is 4.3 bottle → will move to that on apply |
| 15 | BICARB SODA 1KG (Krio Krush) EA (`cmoqfbm4d005g9ky2muvzq6qo`) | 45 | each · 1000 g | $6.00 | **$270.00** | 2025-10-31: 0.1 g (legacy 2025 month-end) | blank | stale legacy artefact — 45 "each" written by the Sep-25 sheet applied last; left blank on 1 Oct |
| 16 | Gotas de Mar Albarino (`cmptovwyx00hos60124vylzv4`) | 10.45 | bottle · 750 ml | $25.15 | **$262.82** | 2026-10-01: 10.25 bottle (app count) | 10.25 bottle | plausible; 1 Oct (unapplied) count is 10.25 bottle → will move to that on apply |
| 17 | El Jolgorio Todos Santos Arroqueno (Neon Pink) (`cmptovvzo00a9s601d8exakd7`) | 0.8 | bottle · 750 ml | $319.94 | **$255.95** | 2026-10-01: 0.8 bottle (app count) | 0.8 bottle | plausible; matches the 1 Oct count |
| 18 | Cascahuin Extra Anejo (`cmptovvqb0083s6017kxd0nyn`) | 0.9 | bottle · 750 ml | $263.81 | **$237.43** | 2026-10-01: 0.9 bottle (app count) | 0.9 bottle | plausible; matches the 1 Oct count |
| 19 | Cannonball Cabernet Sauvignon (`cmptovvbq0053s601fgbq1ekm`) | 9 | bottle · 750 ml | $26.07 | **$234.63** | 2026-10-01: 9 bottle (app count) | 9 bottle | plausible; matches the 1 Oct count |
| 20 | El Jolgorio Sierrudo (Black Green) (`cmptovvyn00a0s601e2pkrrq4`) | 0.9 | bottle · 750 ml | $249.94 | **$224.95** | 2026-10-01: 0.9 bottle (app count) | 0.9 bottle | plausible; matches the 1 Oct count |
| 21 | El Jolgorio Arroqueno (Black Red) (`cmptovvw0009cs6016ypoge9b`) | 0.9 | bottle · 750 ml | $249.94 | **$224.95** | 2026-10-01: 0.9 bottle (app count) | 0.9 bottle | plausible; matches the 1 Oct count |
| 22 | El Jolgorio Todos Santos Tobasiche (Neon Orange) (`cmptovvzz00acs601sml1goac`) | 0.7 | bottle · 750 ml | $319.95 | **$223.97** | 2026-10-01: 0.7 bottle (app count) | 0.7 bottle | plausible; matches the 1 Oct count |
| 23 | Catalina Sounds Sound of White Sauvignon Blanc (`cmptovwxc00hcs601tua0pn1q`) | 12.3 | bottle · 750 ml | $15.77 | **$193.97** | 2026-10-01: 17.7 bottle (app count) | 17.7 bottle | plausible; 1 Oct (unapplied) count is 17.7 bottle → will move to that on apply |
| 24 | Vanguardist Field GSM (`cmptovvh00066s60141oxxgr4`) | 8 | bottle · 750 ml | $23.50 | **$188.00** | 2026-10-01: 0 bottle (app count) | 0 bottle | plausible; 1 Oct (unapplied) count is 0 bottle → will move to that on apply |
| 25 | Manly Spirits Coffee Liqueur (`cmptovuw50026s601h56s07ef`) | 4.6 | bottle · 750 ml | $36.87 | **$169.60** | 2026-10-01: 5 bottle (app count) | 5 bottle | plausible; 1 Oct (unapplied) count is 5 bottle → will move to that on apply |

### 3b. St Alma — 342 non-cluster holdings, $225,183.35; top 12 = $198,177.32

| # | Item (id) | onHand | Count unit · measure | Avg cost | Value | Last count (source) | 1 Oct line | Classification |
|---|---|---:|---|---:|---:|---|---|---|
| 1 | Manly Spirits Triple Sec (`cmptovwge00dus601f7xn8avx`) | 3400 | bottle · 750 ml | $29.07 | **$98,838.00** | 2026-10-01: 10800 ml (app count) | 10800 ml | mL entered as bottles → 4.533 bottle = $131.78 |
| 2 | Manly Spirits Triple Sec No Sugar (`cmptovwgv00dxs601pi20zgpp`) | 3000 | bottle · 750 ml | $29.07 | **$87,210.00** | 2026-10-01: 21000 ml (app count) | 21000 ml | mL entered as bottles → 4 bottle = $116.28 |
| 3 | Rockford Basket Press Shiraz 2018 (`cmoqfbs3o00j49ky2oq8g2ict`) | 11 | bottle · 750 ml | $210.00 | **$2,310.00** | 2026-10-01: 11 bottle (app count) | 11 bottle | plausible; matches the 1 Oct count |
| 4 | Sandrone Le Vigne Barolo (`cmoqfbsfg00ju9ky291xocoez`) | 5 | bottle · 750 ml | $360.00 | **$1,800.00** | 2026-10-01: 5 bottle (app count) | 5 bottle | plausible; matches the 1 Oct count |
| 5 | Rockford Basket Press Shiraz 2017 (`cmoqfbs2s00j29ky24cztf4cu`) | 9 | bottle · 750 ml | $185.00 | **$1,665.00** | 2026-10-01: 9 bottle (app count) | 9 bottle | plausible; matches the 1 Oct count |
| 6 | Domaine Bouchard Corton Grand Cru (`cmoqfbnxy009m9ky2afstepnx`) | 4 | bottle · 750 ml | $300.00 | **$1,200.00** | 2026-10-01: 4 bottle (app count) | 4 bottle | plausible; matches the 1 Oct count |
| 7 | Rum (`cmoqfbs7900jc9ky2ubm4bauh`) | 2.7 | bottle · 750 ml | $404.82 | **$1,093.01** | 2026-03-15: 0 ml (legacy Mar-26 sheet) | not listed | unidentified product with a $404.82 cost; quantity from a Mar-26 legacy sheet; not on any 2026 sheet |
| 8 | Manly Spirits Vodka (`cmptovwhb00e0s601nys0gi1x`) | 27.6 | bottle · 750 ml | $36.00 | **$993.60** | 2026-10-01: 17500 ml (app count) | 17500 ml | mL entered as bottles → 0.037 bottle = $1.32 |
| 9 | Pol Roger Brut Rose (`cmoqfbrst00ig9ky2gxgotwxu`) | 5 | bottle · 750 ml | $165.00 | **$825.00** | 2026-10-01: 5 bottle (app count) | 5 bottle | plausible; matches the 1 Oct count |
| 10 | Manly Spirits Dry Gin (`cmptovwfz00drs601ep9r8o8y`) | 17.73 | bottle · 750 ml | $45.01 | **$798.03** | 2026-10-01: 8300 ml (app count) | 8300 ml | mL entered as bottles → 0.024 bottle = $1.06 |
| 11 | 2021 Cannonball Chardonnay (Case of 12) (`cmoqfbk0w000o9ky2haaw48oz`) | 28.7 | bottle · 750 ml | $26.03 | **$747.06** | 2026-10-01: 27 bottle (app count) | 27 bottle | plausible; 1 Oct (unapplied) count is 27 bottle → will move to that on apply |
| 12 | 2022 Utopos Cabernet Sauvignon (Case of 6) (`cmoqfbker001k9ky2dbog0agf`) | 14 | bottle · 750 ml | $49.83 | **$697.62** | 2026-10-01: 14 bottle (app count) | 14 bottle | plausible; matches the 1 Oct count |

How the mL got in. `InventoryMovement` for the five Avalon items shows the 9/1 Avalon Bar & FOH sheet (applied 2026-10-02) wrote **19 400 mL → onHand 19 400** for Manly Dry Gin (before 20.45 L), 16 500 mL for Triple Sec No Sugar, 9 350 mL for Triple Sec, 7 500 mL for Vodka and 4 800 mL for Massenez (before 1 × 5 L). These items are bulk (20 L drums / 5 L packs) that Loaded counted in litres; the floor items are configured as 750 mL bottles with a per-750-mL cost (item notes: "Cost taken from the Loaded count (drinks.json): 20583.36 mL = $1,235.00"). The apply path does not convert line units, so the mL quantity became a bottle quantity. The St Alma 31/08 sheet did the same to the two Triple Secs (3 400 mL and 3 000 mL). The Avalon 1 Oct sheet has the same items in **L** (4.9, 11, 2, 5.1) and St Alma in **ml** (17 500, 21 000, 8 300, 10 800); 52 Avalon lines and 5 St Alma lines on 1 Oct are in a unit other than the item's count unit (g/kg/L on "each" items), so the same thing will happen again on apply unless the lines are converted first.

Everything else in the Avalon top 25 is plausible bar stock (premium mezcal at 0.7–0.9 of a bottle, 8–17 bottles of a listed wine). St Alma's non-cluster top list is plausible fine wine except "Rum" (unidentified, $404.82 a bottle, 2.7 from a Mar-26 legacy sheet).

## 4. The 7 clusters counted twice on the same 1 Oct sheet

Both lines are on the same sheet and adjacent positions, i.e. the counter saw two rows for one product. `mergeItems` repoints lines to the parent and, where the parent already has a line on that stocktake **with the same unit**, adds the duplicate's quantity and value into it; with different units both lines survive and the apply loop writes onHand once per line (last write wins). Either way the two lines must be reconciled to one before merge or apply.

| Cluster | Venue | Line A | Line B | Same bottles or distinct? | Evidence | Treatment |
|---|---|---|---|---|---|---|
| #103 Giffard Strawberry Syrup | Avalon | `cmsdf10iz…` Giffard Strawberry Syrup: 0.4 bottle, $9.40 (pos 388) | `cmoqfbp8b…` GIFFARD STRAWBERRY 1000ML BOTTLE: 0.4 each, $8.54 (pos 386) | **Same 0.4 of a bottle counted twice** | identical fraction 0.4 on both; "each" and "bottle" are the same 1 L bottle; costs 2350 vs 2136 are both per-bottle | keep the floor line, delete the May line ($8.54 double count) |
| #105 Lime Juice 5 L | St Alma | `cmsdf10jz…` Lime Juice: 1 each (5 L pack), $15.20 (pos 190) | `cmoqfbq3n…` Lime Juice (1 x 5L): 3.8 L, $266.00 (pos 191) | **Probably distinct quantities, same product** — 1 unopened pack + 3.8 L open — but the second line's value is wrong | $70.00/L on the May item vs invoice $7.60/L; corrected line B = $28.88 | recount as one line in litres; fix cost to 760¢/L (or 1520¢ per 2 L) |
| #125 i Lauri Pecorino | Avalon | `cmoqfbl3c…` 2024 i Lauri Pecorino (Case of 6): 10 bottle, $234.90 (pos 34) | `cmptovx0b…` i Lauri AVALOS Pecorino: 10 bottle, $234.90 (pos 430) | **Same 10 bottles counted twice** | identical 10 / 10, identical cost 2349 | keep the floor line; delete the case line ($234.90 double count) |
| #136 Garlic powder | Avalon | `cmsdf12sy…` Garlic Powder: 540 g (pos 363) | `cmoqfboyr…` GARLIC POWDER 540GM: 1 each = 1 × 540 g tub, $9.00 (pos 364) | **Same single 540 g tub** | 540 g = exactly one tub; line A has no value (unit g on an "each" item) | one line, 1 each |
| #137 Onion powder | Avalon | `cmsdf12th…` Onion Powder: 500 g (pos 578) | `cmoqfbr71…` ONION POWDER 500GM: 0.5 each, $4.50 (pos 579) | **Same tub, inconsistent fill** (500 g = a full tub vs half a tub) | adjacent lines; one of the two readings is wrong | one line; recount (0.5 or 1 each) |
| #138 Smoked paprika | Avalon | `cmsdf12tr…` Paprika Smoked: 1.2 kg (pos 596) | `cmoqfbrc5…` PAPRIKA SMOKED 500GM: 1.2 each, $14.40 (pos 597) | **Same count typed on both lines, different unit** ("1.2" kg vs 1.2 × 500 g tubs = 0.6 kg) | identical number 1.2 | one line, 1.2 each (the kg reading is the typo) |
| #157 Black peppercorns whole | Avalon | `cmptowb2f…` Peppercorns Black Whole: 237 g, no value (cost 0, measure 100 g) (pos 616) | `cmoqfbrod…` PEPPER CORNS BLACK WHOLE 500GM: 1 each, $15.50 (pos 617) | **Plausibly distinct** — an open 237 g bag plus one sealed 500 g tub | different quantities, one weighed and one whole | keep both as one item: 1.474 each (737 g) |

Other clusters with two counted lines on the same 1 Oct sheet where one line is **0** (harmless to sum, but confirm which record the counter meant): #58 Quiquiriqui (0 + 0.75 Avalon), #117 Domaine Thomson (0 + 7 Avalon), #127 Laurent-Perrier La Cuvée (0 + 13 Avalon), #128 Serenello (0 + 6.55 Avalon), #199 Teusner (0 + 0 + 14.9 Avalon), #202 Colette Rosé (0 + 7.25 Avalon) and ten wine clusters at 0 + 0. Possible-tier pairs that are **distinct products and must stay separate**: #188 El Jolgorio Pechuga (Black Yellow) 0.7 vs (Yellow) 0.45; #189 Cascahuin Reposado 700 mL 0.7 vs 4×375 mL pack 0.75; #191 Coastal Stone Whiskey 500 mL vs Xplore Blend 700 mL; #198 Heaps Normal Another Lager vs Quiet XPA.

## 5. Per-venue stock value before and after the recommended treatments

Treatments, in order: (A) convert the mL-as-bottle holdings; (B) set the duplicated stale twin holdings to 0; (C) re-cost the surviving holdings that carry a case/drum cost; (D) set aside the non-cluster legacy artefacts for recount. (B) and (C) only touch holdings classified in section 2; nothing here applies the 1 Oct sheets.

### Alma Avalon

| Step | Change | Amount | Running total |
|---|---|---:|---:|
| — | **Before** (sum of `VenueStockItem.onHand × avgCostCents`, 829 holdings) | | **$3,004,623.90** |
| A | Manly Spirits Dry Gin: 19400 → 25.867 bottle (19400 mL ÷ 750 mL per bottle (item notes: cost derived from Loaded mL totals; bulk gin/vodka/triple sec held in litres)); $873,194.00 → $1,164.26 | −$872,029.74 | $2,132,594.16 |
| A | Manly Spirits Triple Sec: 9350 → 12.467 bottle (9350 mL ÷ 750 mL per bottle (item notes: cost derived from Loaded mL totals; bulk gin/vodka/triple sec held in litres)); $271,804.50 → $362.41 | −$271,442.09 | $1,861,152.07 |
| A | Manly Spirits Triple Sec No Sugar: 16500 → 22 bottle (16500 mL ÷ 750 mL per bottle (item notes: cost derived from Loaded mL totals; bulk gin/vodka/triple sec held in litres)); $479,655.00 → $639.54 | −$479,015.46 | $1,382,136.61 |
| A | Manly Spirits Vodka: 7500 → 10 bottle (7500 mL ÷ 750 mL per bottle (item notes: cost derived from Loaded mL totals; bulk gin/vodka/triple sec held in litres)); $270,000.00 → $360.00 | −$269,640.00 | $1,112,496.61 |
| A | Massenez Creme de Peche: 4800 → 0.96 bottle (4800 mL ÷ 5000 mL per pack (Loaded counts: "1 × 5 L"; 30 Jun 2026 Loaded line "1 Bottle = $220.91")); $1,060,368.00 → $212.07 | −$1,060,155.93 | $52,340.68 |
| B | Discard 122 duplicated stale twin holdings (section 2, DUPLICATE) | −$12,988.55 | $39,352.13 |
| C | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) (Uncounted): 15 each × $134.88 → × $11.24 | −$1,854.60 | $37,497.53 |
| C | TSEC 20L (NoSugar) - 20L - 20% ABV (Uncounted): 1.05 L × $680.00 → × $34.00 | −$678.30 | $36,819.23 |
| C | LYRES AGAVE BLANCO 700ML BOTTLE (Prep-Held): 0.986 bottle × $211.14 → × $29.25 | −$179.31 | $36,639.93 |
| C | GIFFARD ROSE SYRUP 1L BOTTLE (Prep-Held): 0.725 bottle × $142.35 → × $23.73 | −$86.00 | $36,553.93 |
| C | GIFFARD COCONUT SYRUP 1000ML BOTTLE (Prep-Held): 0.526 bottle × $128.40 → × $26.10 | −$53.78 | $36,500.15 |
| D | Set aside for recount: BICARB SODA 1KG (Krio Krush) EA (45 each × $6.00) | −$270.00 | $36,230.15 |
| — | **After** | | **$36,230.15** |
| — | of which pending recount (UNCOUNTED cluster holdings at corrected cost) | | $2,475.06 |
| — | of which prep-held on recipe twins at corrected cost | | $114.33 |

### St Alma

| Step | Change | Amount | Running total |
|---|---|---:|---:|
| — | **Before** (sum of `VenueStockItem.onHand × avgCostCents`, 830 holdings) | | **$265,027.46** |
| A | Manly Spirits Triple Sec: 3400 → 4.533 bottle (3400 mL ÷ 750 mL per bottle (item notes: cost derived from Loaded mL totals; bulk gin/vodka/triple sec held in litres)); $98,838.00 → $131.78 | −$98,706.22 | $166,321.25 |
| A | Manly Spirits Triple Sec No Sugar: 3000 → 4 bottle (3000 mL ÷ 750 mL per bottle (item notes: cost derived from Loaded mL totals; bulk gin/vodka/triple sec held in litres)); $87,210.00 → $116.28 | −$87,093.72 | $79,227.53 |
| B | Discard 110 duplicated stale twin holdings (section 2, DUPLICATE) | −$15,651.49 | $63,576.04 |
| C | Cuvée Colette Rosé 2024 (Case of 6) (Uncounted): 18.4 bottle × $102.00 → × $17.00 | −$1,564.00 | $62,012.04 |
| C | LYRES AGAVE BLANCO 700ML BOTTLE (Uncounted): 6 bottle × $211.14 → × $29.25 | −$1,091.34 | $60,920.70 |
| C | LYRES WHITE CANE SPIRIT 700ML BOTTLE (Prep-Held): 4.372 bottle × $204.42 → × $29.26 | −$765.74 | $60,154.95 |
| C | BEEF SHORT RIBS GRAINFED 3 RIB (Prep-Held): 24.590 kg × $51.80 → × $29.00 | −$560.65 | $59,594.30 |
| C | YG BEEF CHUCK ROLL (Prep-Held): 2.757 kg × $124.00 → × $20.50 | −$285.33 | $59,308.96 |
| C | SAMMY PIQUANT JETSETTER 700ML BOTTLE (Uncounted): 1.95 bottle × $179.70 → × $34.06 | −$284.00 | $59,024.96 |
| C | TSEC 20L (NoSugar) - 20L - 20% ABV (Uncounted): 0.015 L × $680.00 → × $34.00 | −$9.69 | $59,015.27 |
| D | Set aside for recount: Rum (2.7 bottle × $404.82) | −$1,093.01 | $57,922.26 |
| — | **After** | | **$57,922.26** |
| — | of which pending recount (UNCOUNTED cluster holdings at corrected cost) | | $3,838.77 |
| — | of which prep-held on recipe twins at corrected cost | | $1,920.18 |

**Both venues: before $3,269,651.37 → after $94,152.41**, of which $6,313.83 is pending recount. The group-wide correction is almost entirely step A ($3,138,083.16); the duplicate-twin discard is $28,640.04, and the case-cost re-pricing of surviving holdings is $7,412.75.

Not included above, but it will matter the moment the 1 Oct sheets are applied: St Alma's four Manly lines in ml would add $1,928,009.00 (17 500 ml Vodka → 17 500 bottles, etc.); Avalon's "4.9 L" Massenez line on a 5 L pack would write 4.9 packs = $1,082 instead of ≈ $216; and the 420-odd Avalon lines left blank (including the kitchen) do nothing, so every uncounted holding stays at whatever it is now.

### 5a. Recount list

Holdings nothing on the 1 Oct sheet accounts for, at the corrected cost where one is known. Sorted by value; holdings under $25 are summarised at the end.

| Venue | Item (id) | onHand | Last count (source) | Value now | Value at corrected cost | Why |
|---|---|---:|---|---:|---:|---|
| Alma Avalon | HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) (`cmoqfbpi700d69ky2f8gje5og`) | 15 each | 2026-06-02: 8.12 478 mL (Loaded CSV import) | $2,023.20 | $168.60 | twin Herradura Agave Nectar listed blank |
| St Alma | Cuvée Colette Rosé 2024 (Case of 6) (`cmoqfbnug009e9ky2xcl291f9`) | 18.4 bottle | 2025-12-31: 9.7 ml (legacy 2025 month-end) | $1,876.80 | $312.80 | twin La Belle Colette Rose not on sheet |
| St Alma | LYRES AGAVE BLANCO 700ML BOTTLE (`cmoqfbq6600eq9ky2qgnr8ejx`) | 6 bottle | 2026-06-02: 2.67 700 mL (Loaded CSV import) | $1,266.84 | $175.50 | twin Lyres Agave Blanco listed blank |
| Alma Avalon | TSEC 20L (NoSugar) - 20L - 20% ABV (`cmoqfbtik00mc9ky2871h92mv`) | 1.05 L | 2025-12-31: 0.375 ml (legacy 2025 month-end) | $714.00 | $35.70 | twin Triple SEC 20L - 20% ABV listed blank |
| St Alma | Secrets Hazy Pale Keg (`cmoqfbsjv00k49ky2xjcdyti7`) | 1.8 keg | 2025-12-31: 2.2 ml (legacy 2025 month-end) | $486.00 | $486.00 | twin Freshwater Brewing Keg not on sheet |
| St Alma | Wedge Cerveza Keg (`cmoqfbtxh00na9ky2u9rt3d49`) | 1.8 keg | 2025-12-31: 1.9 ml (legacy 2025 month-end) | $486.00 | $486.00 | twin Freshwater Brewing Wedge Cerveza Keg not on sheet |
| St Alma | SAMMY PIQUANT JETSETTER 700ML BOTTLE (`cmoqfbsdo00jq9ky2k3aq5jkd`) | 1.95 bottle | 2025-12-31: 0.4 ml (legacy 2025 month-end) | $350.42 | $66.42 | twin Sammy Piquant The Jetsetter not on sheet |
| St Alma | 2022 Teusner 'Wark Family' Shiraz (Case of 12) (`cmoqfbkdv001i9ky2leqkwvfo`) | 15 bottle | 2025-12-31: 6 ml (legacy 2025 month-end) | $254.25 | $254.25 | twin 2023 Teusner 'Wark Family' Shiraz (Case of 12) not on sheet |
| Alma Avalon | Secrets Hazy Pale Keg (`cmoqfbsjv00k49ky2xjcdyti7`) | 0.9 keg | 2025-12-31: 2 ml (legacy 2025 month-end) | $243.00 | $243.00 | twin Freshwater Brewing Keg listed blank |
| Alma Avalon | Beef Short Ribs Grainfed 3rib (`cmptowbnz00was601c2hr91o3`) | 8.97 kg | 2026-08-03: 8.97 kg (Loaded PDF import) | $232.23 | $232.23 | twin BEEF SHORT RIBS GRAINFED 3 RIB listed blank |
| St Alma | Triple SEC 20L - 20% ABV (`cmoqfbtf400m49ky2a0orrz04`) | 7.6 L | 2025-12-31: 0.5 ml (legacy 2025 month-end) | $228.00 | $228.00 | twin TSEC 20L (NoSugar) - 20L - 20% ABV not on sheet |
| Alma Avalon | VODKA ONE 700ML BOTTLE (`cmoqfbtrc00mw9ky2zrisntsx`) | 5.9 bottle | 2025-12-31: 5.3 ml (legacy 2025 month-end) | $227.09 | $227.09 | twin Vodka One listed blank |
| St Alma | Teusner Wark Family Shiraz (`cmptovvgk0063s601zzglvf6w`) | 15.2 bottle | 2026-03-31: 15.2 750 mL (Loaded CSV import) | $210.22 | $210.22 | twin 2022 Teusner 'Wark Family' Shiraz (Case of 12) not on sheet |
| Alma Avalon | SCALLOPS 10/20 CHINA R/OFF 1KG (Trading) EA (10) (`cmoqfbsh800jy9ky23564k75d`) | 4 kg | 2025-11-30: 4 g (legacy 2025 month-end) | $176.00 | $176.00 | twin SCALLOPS IQF 10/20 R/OFF 1KG (Shark Bay) listed blank |
| St Alma | EL JIMADOR REPOSADO 700ML BOTTLE (`cmoqfbo7n00a89ky2wndy34ao`) | 3.3 bottle | 2025-12-31: 0.85 ml (legacy 2025 month-end) | $175.03 | $175.03 | twin El Jimador Reposado not on sheet |
| St Alma | 12cm Yellow Corn Tortilla 4.5 (`cmoqfbjtt000a9ky24c2sd33w`) | 928 each | 2026-08-31: 928 each (app count) | $167.04 | $167.04 | twin Tortilla Corn not on sheet |
| St Alma | EL JOLGORIO TOBASICHE (BLACK BROWN) 750ML BOTTLE (`cmoqfboc500ai9ky2bb9zv8j6`) | 0.6 bottle | 2025-12-31: 0.9 ml (legacy 2025 month-end) | $163.97 | $163.97 | twin El Jolgorio Tobasiche (Black Brown) not on sheet |
| St Alma | Ascorbic Acid 600g - Red Spoon (`cmoqfblr3004m9ky2sqjpkwct`) | 2.54 each | 2026-08-31: 2.54 each (app count) | $135.89 | $135.89 | twin Ascorbic Acid not on sheet |
| Alma Avalon | Triple SEC 20L - 20% ABV (`cmoqfbtf400m49ky2a0orrz04`) | 4.4 L | 2025-12-31: 4 ml (legacy 2025 month-end) | $132.00 | $132.00 | twin TSEC 20L (NoSugar) - 20L - 20% ABV listed blank |
| Alma Avalon | CHICKEN THIGH FILLETS SKIN OFF (`cmoqfbmzg007g9ky2i997b2mv`) | 6.066 kg | 2025-11-30: 0 g (legacy 2025 month-end) | $112.22 | $112.22 | twin Chicken Thigh Fillet Skin Off listed blank |
| St Alma | VODKA ONE 700ML BOTTLE (`cmoqfbtrc00mw9ky2zrisntsx`) | 2.9 bottle | 2025-11-30: 5.55 ml (legacy 2025 month-end) | $111.62 | $111.62 | twin Vodka One not on sheet |
| Alma Avalon | ARETTE SUAVE BLANCO 750ML BOTTLE (`cmoqfblpc004i9ky2slcm5tns`) | 0.8 bottle | 2025-12-31: 0.7 ml (legacy 2025 month-end) | $96.85 | $96.85 | twin Arette Suave Blanco listed blank |
| Alma Avalon | Arette Suave Blanco (`cmptovvkz0070s601192af70l`) | 0.8 bottle | 2026-09-01: 0.8 bottle (app count) | $96.85 | $96.85 | twin ARETTE SUAVE BLANCO 750ML BOTTLE listed blank |
| Alma Avalon | Salmon Fillet Sashimi Skin On (`cmptowbsy00wxs601gf9775f0`) | 2.3 kg | 2026-08-03: 2.3 kg (Loaded PDF import) | $86.23 | $86.23 | twin SALMON FILLET S/ON TASI SASHIMI 1.5-2KG  (Huon) listed blank |
| Alma Avalon | Cheese Halloumi (`cmptowaly00pgs6019u3x1oam`) | 5 each | 2026-08-03: 5 each (Loaded PDF import) | $85.00 | $85.00 | twin CHEESE HALOUMI 750GM (Cypriana) EA (5) listed blank |
| Alma Avalon | Wedge Cerveza Keg (`cmoqfbtxh00na9ky2u9rt3d49`) | 0.3 keg | 2025-12-31: 2 ml (legacy 2025 month-end) | $81.00 | $81.00 | twin Freshwater Brewing Wedge Cerveza Keg listed blank |
| St Alma | Giffard Falernum Syrup 1000ml (`cmptovv30003is60112onwtn0`) | 3.3 bottle | 2026-08-31: 3.3 bottle (app count) | $78.54 | $78.54 | twin GIFFARD FALERNUM 1000ML BOTTLE listed blank |
| St Alma | Chicken Thigh Fillet Skin Off (`cmptowboz00wds601urh3ubcf`) | 3.97 kg | 2026-08-31: 3.97 kg (app count) | $72.25 | $72.25 | twin CHICKEN THIGH FILLETS SKIN OFF not on sheet |
| Alma Avalon | PRAWN MEAT RAW VANNAMEI 31/40 700GM (Trading) EA (10) (`cmoqfbrxd00iq9ky2o4v4ecmh`) | 4 kg | 2025-11-30: 4 g (legacy 2025 month-end) | $72.00 | $72.00 | twin Prawn Meat Raw listed blank |
| St Alma | GIFFARD FALERNUM 1000ML BOTTLE (`cmoqfbp3200c89ky2hb00l6gn`) | 3.2 bottle | 2025-12-31: 0.9 ml (legacy 2025 month-end) | $68.48 | $68.48 | twin Giffard Falernum Syrup not on sheet |
| Alma Avalon | SEA SALT FLAKES 6KG (Olssons) CTN (`cmoqfbsiy00k29ky26w7hlejy`) | 1 each | 2026-05-31: 0 2 KG (Loaded CSV import) | $65.50 | $65.50 | twin Sea Salt Flakes listed blank |
| St Alma | Barramundi Fillets (`cmptowbr900wos6017aiqhusr`) | 3.5 kg | 2026-08-31: 3.5 kg (app count) | $60.90 | $60.90 | twin BARRAMUNDI FILLETS IMP 200/300 S/OFF 5KG (Trading) CTN not on sheet |
| St Alma | DELI CHORIZO RODRIGUEZ (`cmptowbps00wgs601jibnyb8m`) | 3 kg | 2026-08-31: 3 kg (app count) | $59.40 | $59.40 | twin CHORIZO DON'S not on sheet |
| St Alma | JACK DANIELS 700ML BOTTLE (`cmoqfbptf00dw9ky2yeuz5jh6`) | 0.95 bottle | 2025-12-31: 1 ml (legacy 2025 month-end) | $49.23 | $49.23 | twin Jack Daniels listed blank |
| St Alma | MODUS CERVEZA CAN - (CASE OF 12) (`cmoqfbqlt00fq9ky2ft2fnprc`) | 19 can | 2025-08-31: 19 unit (legacy 2025 month-end) | $47.12 | $47.12 | twin Modus Operandi Cerveza not on sheet |
| Alma Avalon | Ascorbic Acid 600g - Red Spoon (`cmoqfblr3004m9ky2sqjpkwct`) | 0.875 each | 2025-11-30: 0.875 g (legacy 2025 month-end) | $46.81 | $46.81 | twin Ascorbic Acid listed blank |
| Alma Avalon | MODUS CERVEZA CAN - (CASE OF 12) (`cmoqfbqlt00fq9ky2ft2fnprc`) | 18 can | 2025-11-30: 6 unit (legacy 2025 month-end) | $44.64 | $44.64 | twin Modus Operandi Cerveza listed blank |
| St Alma | CHOCOLATE WHITE 2.5KG (Callebaut) EA (8) (`cmoqfbn7k007y9ky2wi6xz75s`) | 0.324 each | 2026-08-31: 0.324 each (app count) | $38.88 | $38.88 | twin Callebaut Chocolate White Callet 28% 2.5kg not on sheet |
| St Alma | Chilli Choptle in Adobo (`cmptowar500qgs6017lhxa9vq`) | 2 each | 2026-08-31: 2 each (app count) | $36.92 | $36.92 | twin Chipotle Chillis in adobo sauce  2.8KG-SAN MARCOS not on sheet |
| St Alma | Del Maguey Vida (`cmptovvt7008rs601e8b0092x`) | 0.4 bottle | 2026-03-31: 0.4 750 mL (Loaded CSV import) | $36.24 | $36.24 | twin DEL MAGUEY VIDA 750ML BOTTLE not on sheet |
| Alma Avalon | Prawn Meat Raw (`cmptowbsd00wus601fjwi5dv2`) | 2 kg | 2026-08-03: 2 kg (Loaded PDF import) | $36.00 | $36.00 | twin PRAWN MEAT RAW VANNAMEI 31/40 700GM (Trading) EA (10) listed blank |
| Alma Avalon | G4 ANEJO 750ML BOTTLE (`cmoqfbovf00bq9ky29jv0c2ib`) | 0.2 bottle | 2025-12-31: 0.15 ml (legacy 2025 month-end) | $34.56 | $34.56 | twin G4 Anejo listed blank |
| St Alma | Avocadoes Hass Tray (`cmoqfblrz004o9ky2ykw85p9k`) | 1 each | 2026-08-31: 1 each (app count) | $33.73 | $33.73 | twin Avocadoes Hass not on sheet |
| Alma Avalon | Chilli Jalapeno Kg (`cmoqfbn0r007i9ky28na6sixk`) | 2.386 kg | 2025-11-30: 2.386 g (legacy 2025 month-end) | $33.40 | $33.40 | twin Chilli Jalapeno listed blank |
| St Alma | FORTALEZA REPOSADO 750ML BOTTLE (`cmoqfboss00bk9ky24y28tfq0`) | 0.25 bottle | 2025-12-31: 1 ml (legacy 2025 month-end) | $31.86 | $31.86 | twin Fortaleza Reposado listed blank |
| Alma Avalon | CONDENSED MILK 395GM (Nestle) EA (12) (`cmoqfbng7008i9ky2de5tltvx`) | 7 each | 2025-10-31: 7 g (legacy 2025 month-end) | $28.00 | $28.00 | twin Milk Condensed listed blank |
| St Alma | VINEGAR WHITE 4LT (Edlyn) EA (3) (`cmoqfbtor00mq9ky2jb7tdpcq`) | 6 each | 2026-08-31: 6 each (app count) | $25.80 | $25.80 | twin Vinegar White not on sheet |
| | **65 further holdings under $25** | | | $577.75 | | mostly Avalon kitchen items last counted on the 31 Jul Loaded PDF |

Also recount (non-cluster): **Rum** (St Alma `cmoqfbs7900jc9ky2ubm4bauh`, 2.7 × $404.82 = $1,093.01, unidentified "4500 ml pack"), **BICARB SODA 1KG** (Avalon `cmoqfbm4d005g9ky2muvzq6qo`, 45 each = $270, Sep-25 legacy value, 1 Oct blank), **Oasis Pale Ale** (Avalon, 34 bottles = $106.42, last counted 0 on the 30 Jun Loaded import which is LOCKED and never applied), and the **kegs** at both venues (no keg counted on either 1 Oct sheet).

### 5b. Unit/cost fixes to make before the 1 Oct sheets are applied

- Convert the St Alma Manly lines from ml to bottles (17 500 ml ÷ 750 = 23.33 Vodka; 21 000 ÷ 750 = 28 Triple Sec No Sugar; 8 300 ÷ 750 = 11.07 Dry Gin; 10 800 ÷ 750 = 14.4 Triple Sec) or, better, set these four items' count unit to L with a per-litre cost, since the venues hold them in drums.
- Set Massenez Creme de Peche / Pomme Verte `measurePerCountUnit` to 5000 mL (they are 5 L packs at $220.91 / $208.20) and convert the Avalon "4.9 L" and "3 L" lines to 0.98 and 0.6 packs.
- Re-cost the 15 case/drum-priced items in `COST_FIX` (section 2a "wrong cost") before any value is reported; the same ids are in the audit's section 6d.
- Convert or reject the 52 Avalon and 5 St Alma 1 Oct lines whose unit is g/kg/L/ml on an "each"/"bottle" item (e.g. "Nut Pistachio Kernel 970 g" on a 100 g-measure each item would write 970 each).

## 6. The phantom "Avalon" venue and the unassigned $31k stocktake (investigated, not modified)

- **Phantom venue "Avalon"**: 830 `VenueStockItem` rows, every `onHand` NULL, every `parLevel` 0, created 2026-09-01 01:39:31–32 in the same minute as the real "Alma Avalon — Bar & FOH 9/1/2026" sheet, plus stocktake `cmti01rjj00qgoa01uhp30tw9` ("Stocktake 9/1/2026", venue `Avalon`, IN_PROGRESS, 830 lines, 0 counted). It holds **$0** of value and contributes nothing to any figure above. It is a venue-label bug ("Avalon" vs "Alma Avalon") in the stocktake-start path; it should be deleted with its lines, but it is harmless to the valuation until then. Note `balanceTargetForItem` upserts a VenueStockItem for whatever venue string a stocktake carries, so a second mis-labelled sheet would recreate it.
- **Unassigned stocktake `cmq49xa2i0001s601z7kg0l2q`** ("VOID — stray count (likely 2025) — 08/06/2026", venue NULL, IN_PROGRESS, countedAt 2026-06-07 21:07, 778 lines, 777 counted, line value **$31,128.63**; lines re-created 2026-07-16 12:56). It **was applied** on 2026-06-07 21:08 — 778 `InventoryMovement` rows exist with `sourceStocktakeId` pointing at it, every one with `quantityDelta = 0` (it was applied with no venue, against `StockItem.onHand`, and the counts equalled the then-current item totals). So it moved no stock and its value is not in any venue holding. Its quantities match the **St Alma 31 Mar 2026 Loaded import** on 226 of 262 overlapping items (104/104 tequila & mezcal, 28/28 liqueurs, 19/19 other spirits) and the St Alma Kitchen 31/8 on only 110/323, the Avalon sheets far less — it is a copy of the St Alma March 2026 bar count with a kitchen section, not a 2025 count. Its $31k is also inflated: Triple SEC 20L 15.31 L at $680.00/L = $10,410.80 (drum price per litre; at $34/L it is $520.54), 15 Ramos Pinto at $150.96, and ten Strangelove lines at $57–62 per *can* (case-of-24 prices). Re-priced it is roughly $21k. Recommendation: leave it as the VOID record it is; nothing depends on it; delete only after the Loaded-import history is no longer needed.

## 7. Rules the migration must respect (from this analysis)

1. Zero the DUPLICATE twin's `VenueStockItem.onHand` **before** `mergeItems` runs for that cluster; the merge sums venue stock where the parent already has the venue.
2. For PREP-HELD twins, keep the quantity (it is real prep stock) but move it onto the canonical and repoint the `RecipeLine`s in the same transaction, otherwise the next apply credits the archived item again.
3. Where both twins have a counted line on the same sheet (section 4), delete one line (or set it to 0) before merge; `mergeItems` sums same-unit lines.
4. Never merge the five bulk spirit/liqueur items with their bottle twins until their count unit is settled (L vs bottle), and never apply the 1 Oct sheets while the ml lines stand.
5. Backfill of cost from the duplicate into the parent (`mergeItems` fills missing cost) must not pull a case cost; the 15 wrong-cost ids are listed in section 2a.
6. The legacy 09.25-applied-last quantities (158 Avalon / 150 St Alma holdings) are the real "stale" population; most of their value is on cluster twins and is handled above, but the 2025 legacy counts should not be summed into anything.


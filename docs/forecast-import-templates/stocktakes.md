# Stocktakes (stocktakes)

Physical counts. COGS = opening + purchases + in − out − closing.

Target: fc_stocktakes
Duplicate detection key: company_code + venue_code + stocktake_date + category

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `stocktake_date` | date | yes | NA | Count date. |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `category` | string | yes | NA | Stock category. |
| `opening_stock` | money | no | EXCLUSIVE | Opening valuation EXCLUDING GST. |
| `purchases` | money | no | EXCLUSIVE | Purchases in the period. |
| `transfers_in` | money | no | EXCLUSIVE | Transfers in. |
| `transfers_out` | money | no | EXCLUSIVE | Transfers out. |
| `wastage` | money | no | EXCLUSIVE | Wastage — kept visible, not hidden in COGS. |
| `staff_meals` | money | no | EXCLUSIVE | Staff meals. |
| `closing_stock` | money | no | EXCLUSIVE | Closing valuation. |

Money columns are entered in DOLLARS and stored as integer cents.

# Daily sales (sales_daily)

One row per venue per trading day.

Target: fc_sales_orders
Duplicate detection key: date + company_code + venue_code

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `date` | date | yes | NA | Trading date (YYYY-MM-DD). |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `gross_sales_inc_gst` | money | yes | INCLUSIVE | Gross takings INCLUDING GST. |
| `net_sales_ex_gst` | money | no | EXCLUSIVE | Net sales EXCLUDING GST. Derived when blank. |
| `gst` | money | no | NA | GST component. Derived when blank. |
| `discounts` | money | no | INCLUSIVE | Discounts given. |
| `refunds` | money | no | INCLUSIVE | Refunds issued. |
| `service_charges` | money | no | INCLUSIVE | Service charges. |
| `tips` | money | no | NA | Tips collected. |
| `transactions` | integer | no | NA | Transaction count. |
| `covers` | integer | no | NA | Covers served. |
| `source` | string | no | NA | Where the figure came from. |

Money columns are entered in DOLLARS and stored as integer cents.

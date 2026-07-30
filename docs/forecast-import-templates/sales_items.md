# Item sales (sales_items)

Item-level sales for menu and margin analysis.

Target: fc_sales_order_lines
Duplicate detection key: business_date + company_code + venue_code + item_id

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `business_date` | date | yes | NA | Trading date. |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `item_id` | string | yes | NA | POS item identifier. |
| `item_name` | string | yes | NA | Item name. |
| `category` | string | no | NA | Menu category. |
| `quantity` | decimal | yes | NA | Units sold. |
| `gross_sales_inc_gst` | money | no | INCLUSIVE | Gross item sales INCLUDING GST. |
| `net_sales_ex_gst` | money | no | EXCLUSIVE | Net item sales EXCLUDING GST. |
| `discounts` | money | no | INCLUSIVE | Discounts on this item. |
| `refunds` | money | no | INCLUSIVE | Refunds on this item. |
| `menu_price` | money | no | INCLUSIVE | Menu price per unit. |
| `unit_cogs` | money | no | EXCLUSIVE | Recipe cost per unit, EXCLUDING GST. |
| `gst` | money | no | NA | GST component. |
| `source` | string | no | NA | Source system. |

Money columns are entered in DOLLARS and stored as integer cents.

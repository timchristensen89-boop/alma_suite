# BAS history (bas_history)

Lodged BAS. Replaces the estimated GST reserve rate wherever available.

Target: fc_tax_obligations
Duplicate detection key: company_code + period_start

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `period_start` | date | yes | NA | Period start. |
| `period_end` | date | yes | NA | Period end. |
| `accounting_basis` | enum | no | NA | Both entities report GST on a CASH basis. |
| `g1_gross_sales` | money | no | INCLUSIVE | G1 total sales INCLUDING GST. |
| `gst_1a` | money | no | NA | 1A GST on sales. |
| `gst_1b` | money | no | NA | 1B GST on purchases. |
| `net_gst` | money | no | NA | Net GST payable. |
| `payg` | money | no | NA | PAYG withholding remitted. |
| `total_statement` | money | no | NA | Total BAS amount. |
| `due_date` | date | no | NA | Lodgement due date. |
| `paid_date` | date | no | NA | Date paid. |
| `status` | enum | no | NA | Status. |

Money columns are entered in DOLLARS and stored as integer cents.

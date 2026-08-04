# Bills due (bills_due)

Accounts payable for the cash-flow forecast.

Target: fc_xero_bills
Duplicate detection key: company_code + bill_id

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `bill_id` | string | yes | NA | Bill identifier. |
| `supplier` | string | yes | NA | Supplier name. |
| `invoice_date` | date | no | NA | Invoice date. |
| `due_date` | date | yes | NA | Due date — drives the cash outflow timing. |
| `amount_due` | money | yes | INCLUSIVE | Amount owing INCLUDING GST. |
| `gst` | money | no | NA | GST component. |
| `payment_terms_days` | integer | no | NA | Supplier terms in days. |
| `status` | string | no | NA | Bill status. |
| `priority` | string | no | NA | Payment priority. |
| `category` | string | no | NA | Operational group. |
| `notes` | string | no | NA | Free text. |

Money columns are entered in DOLLARS and stored as integer cents.

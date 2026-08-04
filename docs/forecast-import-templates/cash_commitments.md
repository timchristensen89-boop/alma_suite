# Cash commitments (cash_commitments)

Recurring and one-off committed payments.

Target: fc_recurring_commitments
Duplicate detection key: company_code + description + start_date

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `description` | string | yes | NA | What the payment is. |
| `category` | string | yes | NA | Operational group. |
| `start_date` | date | yes | NA | First payment date. |
| `end_date` | date | no | NA | Last payment date. Blank for open-ended. |
| `frequency` | enum | yes | NA | Payment frequency. |
| `amount` | money | yes | EXCLUSIVE | Amount per payment. State the GST treatment below. |
| `gst_treatment` | enum | no | NA | How GST applies to the amount. |
| `payment_day` | integer | no | NA | Day of month or week the payment falls. |
| `priority` | string | no | NA | Payment priority. |
| `scenario` | string | no | NA | Scenario key, blank for all scenarios. |
| `active` | boolean | no | NA | Whether the commitment is live. |

Money columns are entered in DOLLARS and stored as integer cents.

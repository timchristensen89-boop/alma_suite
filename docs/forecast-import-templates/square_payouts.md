# Square payouts (square_payouts)

Actual Square-to-bank settlements. The basis for cash timing.

Target: fc_square_payouts
Duplicate detection key: payout_id

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `payout_id` | string | yes | NA | Square payout id. |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `payout_date` | date | yes | NA | Date Square initiated the payout. |
| `arrival_date` | date | no | NA | Date the money lands. Preferred for cash timing. |
| `gross_amount` | money | no | INCLUSIVE | Gross before fees. |
| `fees` | money | no | INCLUSIVE | Square fees. |
| `refunds` | money | no | INCLUSIVE | Refunds netted off. |
| `adjustments` | money | no | INCLUSIVE | Other adjustments. |
| `net_payout` | money | yes | INCLUSIVE | Net amount reaching the bank. |
| `destination_account` | string | no | NA | Destination bank account. |
| `status` | string | no | NA | Payout status. |

Money columns are entered in DOLLARS and stored as integer cents.

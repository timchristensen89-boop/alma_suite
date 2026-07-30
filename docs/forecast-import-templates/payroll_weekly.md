# Weekly payroll (payroll_weekly)

Gross wages ALREADY include PAYG. PAYG is captured for BAS timing only.

Target: fc_payroll_periods
Duplicate detection key: company_code + venue_code + week_start

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `week_start` | date | yes | NA | Monday of the pay week. |
| `week_end` | date | no | NA | Sunday of the pay week. |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `gross_wages` | money | yes | NA | GROSS wages, INCLUDING PAYG withheld. Do not add PAYG again. |
| `super` | money | no | NA | Superannuation. |
| `payg` | money | no | NA | PAYG withheld FROM gross wages. Remittance timing only. |
| `hours` | decimal | no | NA | Hours worked. |
| `headcount` | integer | no | NA | Staff paid. |
| `overtime_hours` | decimal | no | NA | Overtime hours. |
| `kitchen_wages` | money | no | NA | Kitchen split. |
| `foh_wages` | money | no | NA | Front of house split. |
| `management_wages` | money | no | NA | Management split. |
| `notes` | string | no | NA | Free text. |

Money columns are entered in DOLLARS and stored as integer cents.

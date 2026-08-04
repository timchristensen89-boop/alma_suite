# Forecast overrides (forecast_overrides)

Manual adjustments. Sit above forecasts, never above actuals.

Target: fc_overrides
Duplicate detection key: company_code + metric + date_from

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `date_from` | date | yes | NA | First date the override applies. |
| `date_to` | date | yes | NA | Last date the override applies. |
| `metric` | string | yes | NA | Metric being adjusted. |
| `adjustment_type` | enum | yes | NA | How the value applies. |
| `adjustment_value` | decimal | yes | NA | Percent, or dollars for a dollar adjustment. |
| `reason` | string | yes | NA | Why — required for the audit trail. |
| `author` | string | yes | NA | Who entered it. |
| `expires_at` | date | no | NA | When the override lapses. |

Money columns are entered in DOLLARS and stored as integer cents.

# Business events (business_events)

Closures, promotions and one-offs so the model does not learn from an unexplained day.

Target: fc_business_events
Duplicate detection key: company_code + venue_code + date_from + event_type

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `date_from` | date | yes | NA | First affected date. |
| `date_to` | date | yes | NA | Last affected date. |
| `event_type` | enum | yes | NA | Event type. |
| `expected_sales_impact_percent` | percent | no | NA | Expected sales impact, percent. |
| `expected_cost_impact` | money | no | EXCLUSIVE | Expected cost impact in dollars. |
| `description` | string | no | NA | What happened. |

Money columns are entered in DOLLARS and stored as integer cents.

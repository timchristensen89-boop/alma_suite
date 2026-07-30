# Forecast import templates

Download a template, fill it in, and upload it at `/forecast/imports`.

Money columns are entered in **dollars** and stored as integer cents. Every
money column states whether it is GST inclusive or exclusive — that is never
inferred, because mixing the two is how a cost base gets overstated.

Each file ships with two clearly-labelled example rows. Delete them before
uploading your own data.

| Dataset | Template | Reference | Rows identified by |
| --- | --- | --- | --- |
| Daily sales | [`sales_daily.csv`](sales_daily.csv) | [columns](sales_daily.md) | date + company_code + venue_code |
| Item sales | [`sales_items.csv`](sales_items.csv) | [columns](sales_items.md) | business_date + company_code + venue_code + item_id |
| Square payouts | [`square_payouts.csv`](square_payouts.csv) | [columns](square_payouts.md) | payout_id |
| Xero transactions | [`xero_transactions.csv`](xero_transactions.csv) | [columns](xero_transactions.md) | source_id |
| Bills due | [`bills_due.csv`](bills_due.csv) | [columns](bills_due.md) | company_code + bill_id |
| Weekly payroll | [`payroll_weekly.csv`](payroll_weekly.csv) | [columns](payroll_weekly.md) | company_code + venue_code + week_start |
| Stocktakes | [`stocktakes.csv`](stocktakes.csv) | [columns](stocktakes.md) | company_code + venue_code + stocktake_date + category |
| Cash commitments | [`cash_commitments.csv`](cash_commitments.csv) | [columns](cash_commitments.md) | company_code + description + start_date |
| BAS history | [`bas_history.csv`](bas_history.csv) | [columns](bas_history.md) | company_code + period_start |
| Creditor claims | [`creditor_claims.csv`](creditor_claims.csv) | [columns](creditor_claims.md) | company_code + creditor_name |
| Forecast overrides | [`forecast_overrides.csv`](forecast_overrides.csv) | [columns](forecast_overrides.md) | company_code + metric + date_from |
| Daily bookings | [`bookings_daily.csv`](bookings_daily.csv) | [columns](bookings_daily.md) | company_code + venue_code + service_date + snapshot_date |
| Business events | [`business_events.csv`](business_events.csv) | [columns](business_events.md) | company_code + venue_code + date_from + event_type |

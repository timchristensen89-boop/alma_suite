# SevenRooms Marketing Import Dry Run

Use this helper to validate a local SevenRooms customer or guest export before any Alma customer, Reserve guest, or Marketing contact data is changed.

The importer is intentionally dry-run only. It does not connect to the database, does not require credentials, and does not write production data.

## Command

```bash
pnpm db:import:sevenrooms-marketing -- --file tmp/sevenrooms-customers.csv --dry-run
```

JSON files are also accepted:

```bash
pnpm db:import:sevenrooms-marketing -- --file tmp/sevenrooms-customers.json
```

## Accepted Columns

Preferred CSV/JSON columns:

```text
venue
first_name
last_name
full_name
name
email
phone
mobile
birthday
date_of_birth
tags
allergy_notes
allergies
dietary_notes
visit_notes
notes
marketing_opt_in
email_opt_in
sms_opt_in
email_unsubscribed
sms_unsubscribed
email_unsubscribed_at
sms_unsubscribed_at
total_visits
visits
total_spend
total_spend_cents
no_show_count
last_visit_at
last_visit
first_visit_at
first_visit
sevenrooms_guest_id
sevenrooms_client_id
client_id
guest_id
```

Required:

```text
first_name and last_name, or full_name/name
email or phone
```

## Mapping

The dry run maps each valid row into previews for:

- `ReserveGuest`
- `MarketingContact`

Venue names are normalised to `Alma Avalon` or `St Alma` where possible. Unknown venues are reported in the preview instead of being guessed.

SevenRooms IDs are kept in dry-run preview metadata only. A future write-mode import should preserve the source ID either in `ReserveGuest.preferences` or a dedicated source mapping table if that becomes necessary.

## Output Meaning

The dry run prints:

- rows read
- `ReserveGuest` previews by venue
- `MarketingContact` previews by venue
- email and SMS consent counts
- duplicate-looking rows by venue/email or venue/phone
- invalid rows and reasons
- missing optional fields
- unrecognised columns
- preview rows for the Alma mapping

If invalid rows or duplicate-looking rows are found, the command exits non-zero so the export can be cleaned before import approval.

No production write path exists in this helper yet.

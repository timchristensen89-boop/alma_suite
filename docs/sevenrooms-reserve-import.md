# SevenRooms Reserve Import Dry Run

Use this helper to validate a local SevenRooms shifts/access-rules export before any Alma Reserve data is changed.

The importer is intentionally dry-run only. It does not connect to the database, does not require credentials, and does not write production configuration.

## Command

```bash
pnpm db:import:sevenrooms-reserve -- --file tmp/sevenrooms-reserve-export.csv --dry-run
```

JSON files are also accepted:

```bash
pnpm db:import:sevenrooms-reserve -- --file tmp/sevenrooms-reserve-export.json
```

## Accepted Columns

Preferred CSV/JSON columns:

```text
venue
service_name
access_rule_name
days_of_week
start_time
end_time
party_size_min
party_size_max
booking_interval
duration_minutes
capacity
booking_cutoff
booking_opening_window
closed_dates
special_dates
notes
```

Required for availability rows:

```text
venue
service_name or access_rule_name
days_of_week
start_time
end_time
party_size_min
party_size_max
booking_interval
capacity
```

Optional fields are reported if missing. SevenRooms IDs can be included as `sevenrooms_shift_id`, `shift_id`, `sevenrooms_access_rule_id`, or `access_rule_id`; the dry run reports that schema support would be needed to preserve them.

## Output Meaning

The dry run prints:

- mapped `ReserveAvailabilityRule` counts by venue
- mapped `ReserveBlackout` counts by venue
- invalid rows and reasons
- missing optional fields
- unrecognised columns
- preview rows for the Alma Reserve mapping

Rows with `closed_dates` are mapped to `ReserveBlackout` previews. Use `YYYY-MM-DD` or `YYYY-MM-DD..YYYY-MM-DD`. `special_dates` are only mapped as blackouts when the value includes `closed`.

No production write path exists in this helper yet.

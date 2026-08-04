# Daily bookings (bookings_daily)

Booking pace for the covers forecast.

Target: fc_bookings_snapshots
Duplicate detection key: company_code + venue_code + service_date + snapshot_date

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `venue_code` | enum | no | NA | Trading venue. Optional where the row is company-level. |
| `service_date` | date | yes | NA | Date being served. |
| `snapshot_date` | date | yes | NA | Date the count was taken — booking pace needs both. |
| `lunch_covers` | integer | no | NA | Lunch covers booked. |
| `dinner_covers` | integer | no | NA | Dinner covers booked. |
| `total_covers` | integer | no | NA | Total covers booked. |
| `capacity` | integer | no | NA | Seats available. |
| `cancellations` | integer | no | NA | Cancellations. |
| `no_shows` | integer | no | NA | No-shows. |
| `event_name` | string | no | NA | Event, if any. |

Money columns are entered in DOLLARS and stored as integer cents.

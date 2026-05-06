# ALMA Reserve Product And Backend Blueprint

This note captures the booking-app direction from the current SevenRooms references and the supplied Alma table-layout images. It is a build target for ALMA Reserve, not a requirement to copy SevenRooms code or interaction details.

## Reference Inputs

- `downloadtables alma.png`: Alma Avalon table/floorplan reference.
- `tableesstalma.png`: St Alma table/floorplan reference.
- SevenRooms reservation list screenshots: daily diary, grouped list, bookings table, status/source/spend columns.
- SevenRooms grid screenshots: time-column booking grid, table rows, manual booking blocks, seating-area headers, collapsible areas.
- SevenRooms settings screenshots: shifts, access rules, daily availability, floorplan/tables/settings navigation.

## Current Implementation

The current Reserve slice is intentionally small:

- API routes live in `apps/api/src/routes/reserve.ts`.
- Business logic lives in `apps/api/src/services/reserve.service.ts`.
- UI lives in `apps/reserve-web/src/App.tsx`.
- Existing Prisma models cover guests, tables, and reservations:
  - `ReserveGuest`
  - `ReserveTable`
  - `ReserveReservation`
  - `ReserveReservationStatus`
  - `ReserveServicePeriod`

Current manager features:

- Daily diary query.
- Guest create/upsert.
- Table create/upsert.
- Reservation create.
- Reservation status update.

Missing product areas:

- Visual floorplan coordinates.
- Rooms/floorplans.
- Table combinations.
- Shift/capacity schedules.
- Access rules.
- Blackout dates.
- Manual blocks/holds.
- Waitlist and requests.
- Public booking widget availability.
- Payment/deposit records.
- Reservation audit/event log.
- Reporting and revenue handoff.

## Target Manager Surfaces

### Diary/List

The list view should be the fastest way to review a service.

Core columns:

- Time.
- Covers.
- Guest name.
- Table.
- Notes.
- Booked by/source.
- Status.
- Spend/deposit.

Required controls:

- Venue selector.
- Date selector.
- Shift/service selector.
- Search.
- Group by default, time, seating area, VIP/other, tags, or status.
- Show cancelled/no-show toggle.
- Add reservation.

### Grid/Cover Flow

The grid should become the main manager working view.

Core behavior:

- Horizontal time scale, usually 15-minute slots.
- Vertical table rows grouped by seating area.
- Bookings render as blocks spanning their start/end time.
- Blocks show covers, guest name, status/source tags, and notes indicators.
- Manual blocks render separately from real bookings.
- Seating areas are collapsible to save space.
- Totals row shows reservations and covers for the selected day/shift.

API must own all conflict checks. The frontend can request moves or edits, but the backend decides whether a table/time is available.

### Floorplan

The floorplan should be a real layout, not just a table list.

Core behavior:

- Per-venue floorplan canvas.
- Tables have x/y coordinates, width, height, rotation, shape, area, and capacity.
- Tables can be rectangular, round, bar/stool, bench, or combined.
- Booked tables show booking state and cover count.
- Managers can click a table to create, view, move, or seat a reservation.

### Availability Settings

These are the backend foundations that make the public widget and manager grid reliable.

Settings surfaces:

- Shifts/service periods.
- Access rules.
- Daily program.
- Blackout dates.
- Availability quick view.
- Floorplan layouts.
- Rooms.
- Seating areas.
- Tables.
- Table combinations.

### Guestlist And Requests

Later operational surfaces:

- Waitlist entries.
- Booking requests.
- Guest profiles.
- Guest tags.
- Visit history.
- Allergy and preference notes.
- Marketing consent.
- Revenue/spend handoff.

## Backend Target Model

The current `ReserveTable` and `ReserveReservation` models can remain as the base, but ALMA Reserve needs these concepts before it can replace a mature reservation platform.

Suggested future models:

### Venue And Floorplan

- `ReserveVenue`
  - id
  - name
  - slug
  - timezone
  - defaultTurnMinutes
  - isActive

- `ReserveRoom`
  - id
  - venueId
  - name
  - sortOrder
  - isActive

- `ReserveFloorplan`
  - id
  - venueId
  - roomId
  - name
  - width
  - height
  - isDefault
  - isActive

- `ReserveTableLayout`
  - id
  - tableId
  - floorplanId
  - x
  - y
  - width
  - height
  - rotation
  - shape
  - labelPosition

### Tables

- `ReserveTable`
  - existing fields stay.
  - add optional room/floorplan references later if useful.

- `ReserveTableCombination`
  - id
  - venueId
  - label
  - minCovers
  - maxCovers
  - tableIds
  - isActive

Table combinations should be first-class. Do not model combinations only as labels like `Com1`.

### Availability

- `ReserveServiceShift`
  - id
  - venueId
  - name
  - servicePeriod
  - daysOfWeek
  - startsAtLocal
  - endsAtLocal
  - effectiveFrom
  - effectiveTo
  - isActive

- `ReserveCapacityRule`
  - id
  - venueId
  - shiftId
  - date
  - area
  - maxCovers
  - maxBookings
  - pacingIntervalMinutes
  - notes

- `ReserveAccessRule`
  - id
  - venueId
  - shiftId
  - name
  - source
  - area
  - tableIds
  - startsAtLocal
  - endsAtLocal
  - minCovers
  - maxCovers
  - availabilityMode
  - priority
  - isActive

- `ReserveBlackoutDate`
  - id
  - venueId
  - startsAt
  - endsAt
  - area
  - tableIds
  - reason

- `ReserveBookingBlock`
  - id
  - venueId
  - tableId
  - startsAt
  - endsAt
  - reason
  - createdById

### Reservation Operations

- `ReserveReservationEvent`
  - id
  - reservationId
  - actorId
  - eventType
  - beforeJson
  - afterJson
  - createdAt

- `ReservePayment`
  - id
  - reservationId
  - provider
  - providerPaymentId
  - amountCents
  - status
  - createdAt

- `ReserveWaitlistEntry`
  - id
  - venueId
  - guestId
  - serviceDate
  - servicePeriod
  - desiredTime
  - covers
  - status
  - notes

- `ReserveRequest`
  - id
  - venueId
  - guestId
  - requestedAt
  - serviceDate
  - servicePeriod
  - covers
  - status
  - notes

## API Shape To Build Toward

Existing routes should stay stable where possible. Add new routes around the existing `/api/reserve` namespace.

Suggested endpoints:

- `GET /api/reserve/diary?venue&start&end`
- `GET /api/reserve/grid?venue&date&shift`
- `GET /api/reserve/floorplans?venue`
- `GET /api/reserve/floorplans/:id/tables`
- `POST /api/reserve/floorplans`
- `PATCH /api/reserve/floorplans/:id`
- `GET /api/reserve/tables?venue`
- `POST /api/reserve/tables`
- `PATCH /api/reserve/tables/:id`
- `GET /api/reserve/shifts?venue`
- `POST /api/reserve/shifts`
- `PATCH /api/reserve/shifts/:id`
- `GET /api/reserve/access-rules?venue&week`
- `POST /api/reserve/access-rules`
- `PATCH /api/reserve/access-rules/:id`
- `GET /api/reserve/blackouts?venue&start&end`
- `POST /api/reserve/blackouts`
- `GET /api/reserve/blocks?venue&date`
- `POST /api/reserve/blocks`
- `DELETE /api/reserve/blocks/:id`
- `POST /api/reserve/availability/search`
- `POST /api/reserve/reservations`
- `PATCH /api/reserve/reservations/:id`
- `POST /api/reserve/reservations/:id/move`
- `POST /api/reserve/reservations/:id/cancel`
- `GET /api/reserve/waitlist?venue&date`
- `POST /api/reserve/waitlist`
- `GET /api/reserve/requests?venue`
- `POST /api/reserve/requests/:id/convert`

## Business Rules

- The frontend must never be the source of truth for availability.
- Every reservation create, move, resize, or table assignment must be validated by the API.
- API validation must consider shifts, access rules, blackout dates, manual blocks, table capacity, table combinations, and existing reservations.
- Manual booking blocks consume or remove availability.
- Cancelled and no-show reservations stay visible for reporting and guest history.
- All reservation changes should create an event log entry.
- Public widget availability must use the same backend rules as the manager grid.
- Deposits and gift-card payments should not confirm a booking unless payment confirmation is received from the payment provider.

## Table References From Images

These are reference observations, not final seed data. The floorplan images should be manually reconciled before migrations/seeds are changed.

### Alma Avalon

Visible table labels across the supplied image and screenshots:

- Dining/table grid: `10`, `11`, `20`, `21`, `30`, `31`, `32`, `40`, `41`, `42`, `50`, `51`, `52`, `Com1`, `Com2`.
- Bar/kitchen stool groups in grid: `B1`, `B2`, `B3`, `K2`.
- Floorplan image also shows: `43`, `44`, `45`, `61`, `62`, `64`, `70`, `71`, `72`, `73`, `74`, `75`, `76`, `Bench 1`, `Bench 2`, `Bench 3`, `Bar 1`, `Bar 2`, `Bar 3`, `Com 1`.

Needed follow-up:

- Reconcile whether these are current active tables, historical tables, or different rooms/layouts.
- Capture approximate x/y positions from the image into a seed only after Tim confirms the active table set.

### St Alma

Visible labels across the supplied image and screenshots:

- Dining/table grid: `10`, `11`, `20`, `21`, `30`, `31`, `32`, `40`, `41`, `42`, `50`, `51`, `52`, `Com1`, `Com2`.
- Floorplan image appears to include `61`, `62`, `63` or nearby numbered round tables.

Needed follow-up:

- Confirm active table list and capacities.
- Confirm seating area names and whether bar/stool groups are currently bookable online.

## Shift And Capacity References

These are screenshot-derived references and should be confirmed before hardcoding.

### Alma Avalon

- Sunday: day service around `12:00 PM-7:30 PM`.
- Mothers Day reference: `12:00 PM-9:00 PM`.
- Wednesday and Thursday: `5:00 PM-10:00 PM`.
- Friday: `4:00 PM-10:00 PM`.
- Saturday: `12:00 PM-11:00 PM`.

### St Alma

- Friday to Sunday day service: `12:00 PM-8:45 PM`.
- Tuesday: `5:00 PM-8:30 PM`.
- Wednesday and Thursday: `5:00 PM-8:15 PM`.

## Small Safe Build Sequence

1. Add a read-only Reserve grid endpoint that returns one day, one venue, tables grouped by area, time slots, reservations, and blocks.
2. Build the read-only grid UI in `apps/reserve-web` using current `ReserveTable` and `ReserveReservation` data.
3. Add manager table edit fields for area, capacity, sort order, and active/inactive.
4. Add floorplan layout models and a seed for confirmed active Alma Avalon and St Alma tables.
5. Add shift schedule models and manager settings UI.
6. Add access rules and blackout dates.
7. Add API-validated drag/move booking actions.
8. Add public booking widget only after manager availability and conflict checks are reliable.

## Immediate Next Product Slice

The best next production-safe slice is a read-only Reserve grid:

- No schema migration required at first.
- Uses existing tables and reservations.
- Shows table rows grouped by area.
- Shows bookings as time blocks.
- Shows covers/reservation totals.
- Gives managers the familiar operating view without risking broken availability logic.


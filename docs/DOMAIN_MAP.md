# Alma Suite — Domain Map & Staff Split Seam

_Source of truth: `packages/db/prisma/schema.prisma` (120 models, single Postgres database)._
_Generated as the basis for the stock-forward refactor: keep Stock + Compliance as the suite, keep a People-core, extract the Workforce engine behind an API._

## TL;DR

- **One database, 120 models, every domain intertwined.** This is the real coupling — not the separate apps.
- **`StaffProfile` is the identity hub.** It is referenced by stock invoices (`SupplierInvoice.triagedBy/assignedTo`), the cross-cutting task system (`AlmaTask.owner/completedBy/dismissedBy`), and every staff-domain table. **It must stay in the suite.** You cannot ship it with payroll.
- The split is therefore **People-core stays / Workforce engine leaves**, not "staff leaves."
- The trickiest seam is **ShiftTask\*** — it ties rostering to compliance checklists and stocktakes. Recommendation: it stays in the suite; its links to the workforce become soft (optional) references.

---

## Domain buckets

### 🟩 STOCK — the anchor (21 models)
Keep in the suite, finish first. Already has its own `apps/stock-api` + `apps/stock-web`.

`StockCategory`, `StockItem`, `StockTransfer`, `VenueStockItem`, `StockWastageRecord`, `StockDeliveryCheck`, `StockDeliveryCheckItem`, `StockReorderNotice`, `Stocktake`, `StocktakeLine`, `InventoryMovement`, `Recipe`, `RecipeCategory`, `RecipeLine`, `RecipeVenuePrice`, `Supplier`, `SupplierInvoice`, `SupplierInvoiceLine`, `InvoiceExclusionRule`, `SquareCatalogItem`, `SquareMenuRecipeMapping`

### 🟦 COMPLIANCE — sits with stock (back-of-house) (20 models)
Keep in the suite, alongside stock. Food-safety / licensing / audits are operationally adjacent to inventory.

`Issue`, `IssueEvidence`, `IssueAreaRule`, `IssueCategoryOption`, `IssueActivity`, `ChecklistTemplate`, `ChecklistItemTemplate`, `ChecklistRun`, `ChecklistItem`, `AuditTemplate`, `AuditTemplateSection`, `AuditRun`, `AuditFinding`, `IncidentReport`, `IncidentPerson`, `TemperatureAsset`, `TemperatureIntegration`, `TemperatureSensor`, `TemperatureLog`, `LiquorLicence`

### 🟨 PEOPLE-CORE — stays in the suite (10 models)
Identity, roles, access, and certifications. The whole suite depends on knowing *who people are* and *whether they're allowed to work*. This is the half of "staff" that does **not** leave.

`StaffProfile` _(identity hub)_, `StaffRoleTemplate`, `StaffRoleTemplateAccess`, `StaffAppAccess`, `StaffInvite`, `StaffPasswordResetToken`, `StaffComplianceRecord` _(RSA / food-safety certs — gates who can work)_, `StaffDocumentReview`, `StaffTrainingRecord`, `TrainingModule`

> Note: `StaffComplianceRecord`, `StaffTrainingRecord`, and `TrainingModule` are certification records (RSA, food safety, allergen). They are compliance-adjacent and gate eligibility to work, so they belong with the suite, not the payroll engine.

### 🟧 WORKFORCE ENGINE — extracts behind an API (20 models)
Scheduling, time, pay, tips, leave, forecasting, HR. The complex, regulated, commoditized half. This is the beast (`apps/staff-web/src/App.tsx` = 17,008 lines; `apps/api/src/services/staff.service.ts` = 6,316 lines).

`RosterShift`, `RosterForecastSnapshot`, `StaffClockSession`, `StaffClockEvent`, `Timesheet`, `StaffTipCashEntry`, `StaffTipCardEntry`, `StaffTipManualHoursEntry`, `StaffTipPaymentRun`, `StaffTipPaymentRunLine`, `StaffPayProfile`, `TrainingLevelPayRule`, `StaffLeaveRequest`, `StaffHrRecord`, `StaffHrDocumentTemplate`, `StaffManagerNote`, `StaffManagementEvent`, `StaffShiftConfirmation`, `SalesActualEntry`, `SalesItemActualEntry`

### 🔶 BRIDGE — decide explicitly (2 models)
`ShiftTaskRule`, `ShiftTaskAssignment` link rostering → compliance (`ChecklistTemplate`, `ChecklistRun`) and stock (`Stocktake`). They are "tasks to do during a shift," which is operational compliance/stock work.

**Recommendation:** keep in the suite. When the workforce engine leaves, make `ShiftTaskAssignment.rosterShiftId` and `.staffProfileId` soft/optional references (they already are `SetNull` / optional), resolved via the workforce API when present.

### ⬜ OTHER SUITE DOMAINS (not part of this split, but share the DB)
- **Reserve (12):** `ReserveGuest`, `ReserveTable`, `ReserveTableCall`, `ReserveDrinkPackage`, `ReserveArea`, `ReserveReservation`, `ReserveAvailabilityRule`, `ReserveBlackout`, `ReserveWaitlistEntry`, `GoogleReserveIntegrationSetting`, `GuestTag`, `GuestTagAssignment`
- **Marketing (12):** `MarketingContact`, `MarketingSegment`, `MarketingCampaign`, `MarketingCampaignRecipient`, `MarketingEmailTemplate`, `MarketingAutomation`, `MarketingAutomationRun`, `MarketingContentAsset`, `MarketingContentPost`, `MarketingContentPostAsset`, `MarketingSocialAccount`, `MarketingContentPublishAttempt`
- **Gift Cards (3):** `GiftCard`, `GiftCardPromoCode`, `GiftCardRedemption`
- **Comms / Collaboration (12):** `CommsThread`, `CommsMessage`, `CommsRecipient`, `CommsAttachment`, `CommsLink`, `CommsAlertRule`, `CommsAlertEvent`, `SuiteAnnouncement`, `SuiteChatChannel`, `SuiteChatMessage`, `NotificationMutePreference`, `NotificationRead`
- **Integrations / Platform (5):** `IntegrationConnection`, `IntegrationSyncRun`, `IntegrationOAuthState`, `IntegrationEvent`, `IntegrationWebhookEvent`
- **Shared / Tenant (3):** `Venue` _(tenant root)_, `AppSettings`, `AlmaTask` _(cross-cutting task system)_

---

## The seams that matter (cross-domain foreign keys)

These are the joins that break when the workforce engine moves to its own database. Each must become either (a) a soft reference + API lookup, or (b) a retained relation because the target stays in the suite.

| From (model.field) | → To | Crosses | Resolution when workforce leaves |
|---|---|---|---|
| `SupplierInvoice.triagedByStaffProfileId` | `StaffProfile` | Stock → People-core | **Stays** — `StaffProfile` is in the suite. No change. |
| `SupplierInvoice.assignedToStaffProfileId` | `StaffProfile` | Stock → People-core | **Stays.** No change. |
| `AlmaTask.ownerStaffProfileId` / `completedBy` / `dismissedBy` | `StaffProfile` | Platform → People-core | **Stays.** No change. |
| `ShiftTaskAssignment.rosterShiftId` | `RosterShift` | Bridge → Workforce | Soft reference; resolve via workforce API (already `SetNull`). |
| `ShiftTaskAssignment.staffProfileId` | `StaffProfile` | Bridge → People-core | **Stays.** |
| `ShiftTaskAssignment.checklistTemplateId` / `checklistRunId` | Compliance | Bridge → Compliance | **Stays** (both in suite). |
| `ShiftTaskAssignment.stocktakeId` | `Stocktake` | Bridge → Stock | **Stays** (both in suite). |
| `SalesItemActualEntry.recipeId` | `Recipe` | Workforce → Stock | Becomes a soft `recipeId` on the workforce side; resolve Recipe via stock API for costing/margin. |
| `StaffTrainingRecord.staffProfileId` | `StaffProfile` | People-core → People-core | **Stays** (both people-core). |
| All `Staff*` workforce tables `.staffProfileId` | `StaffProfile` | Workforce → People-core | The key seam: workforce tables move out but still need person identity → resolve `StaffProfile` via the suite/people API (or replicate a read-only person mirror into the workforce DB). |

### The one hard problem
Every workforce table points back at `StaffProfile`, which stays in the suite. When the workforce engine gets its own database, it loses that foreign key. Two clean options:

1. **Person ID as a value, not a relation.** Workforce stores `staffProfileId` as a plain string and calls the suite's people API to hydrate names/roles. Simplest; introduces network dependency on reads.
2. **Read-only person mirror.** The suite publishes person identity (id, name, role, active) into the workforce DB via events. Workforce keeps fast local joins; the suite remains the system of record. More moving parts, better performance and offline behaviour.

Given the app is described as "local-first," option 2 (a small replicated person table kept in sync by events) is likely the better long-term fit, but option 1 is the right place to **start** because it requires no sync infrastructure.

---

## Multi-venue note
Venue scoping is largely done via a `venueId` string/slug rather than hard foreign keys throughout. That's convenient for separation — the tenant boundary is already loosely coupled, so the workforce engine can carry `venueId` as a value without a cross-database FK to `Venue`.

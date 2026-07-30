// Import template registry — the 13 datasets from the brief.
//
// Data-driven on purpose: the templates, the validator, the downloadable
// sample files and the column-mapping UI all read from this one definition, so
// a column cannot exist in the sample file but not the validator.
//
// Money columns are declared in DOLLARS (that is what a finance person types
// into a spreadsheet) and coerced to integer cents on the way in. Whether a
// figure is GST inclusive or exclusive is stated per column, never guessed.

export type ColumnType =
  | "date"
  | "string"
  | "money" /* dollars in the file → cents in the database */
  | "integer"
  | "decimal"
  | "percent"
  | "boolean"
  | "enum";

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  required?: boolean;
  /** Allowed values for an enum column, lower-cased on comparison. */
  values?: readonly string[];
  /** Stated so nothing downstream has to guess a GST basis. */
  gstBasis?: "INCLUSIVE" | "EXCLUSIVE" | "NA";
  description: string;
  /** Two clearly-labelled example values for the sample file. */
  examples: [string, string];
}

export interface DatasetSpec {
  key: string;
  title: string;
  description: string;
  /** Columns that together identify a row, for duplicate detection. */
  naturalKey: readonly string[];
  targetTable: string;
  columns: readonly ColumnSpec[];
}

const company: ColumnSpec = {
  name: "company_code",
  type: "enum",
  required: true,
  values: ["TCC", "AF"],
  gstBasis: "NA",
  description: "Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma).",
  examples: ["TCC", "AF"],
};

const venue: ColumnSpec = {
  name: "venue_code",
  type: "enum",
  values: ["AVALON", "FRESHWATER"],
  gstBasis: "NA",
  description: "Trading venue. Optional where the row is company-level.",
  examples: ["AVALON", "FRESHWATER"],
};

export const DATASETS: readonly DatasetSpec[] = [
  {
    key: "sales_daily",
    title: "Daily sales",
    description: "One row per venue per trading day.",
    naturalKey: ["date", "company_code", "venue_code"],
    targetTable: "fc_sales_orders",
    columns: [
      { name: "date", type: "date", required: true, gstBasis: "NA", description: "Trading date (YYYY-MM-DD).", examples: ["2026-07-01", "2026-07-02"] },
      company,
      venue,
      { name: "gross_sales_inc_gst", type: "money", required: true, gstBasis: "INCLUSIVE", description: "Gross takings INCLUDING GST.", examples: ["4210.55", "3980.10"] },
      { name: "net_sales_ex_gst", type: "money", gstBasis: "EXCLUSIVE", description: "Net sales EXCLUDING GST. Derived when blank.", examples: ["3827.77", "3618.27"] },
      { name: "gst", type: "money", gstBasis: "NA", description: "GST component. Derived when blank.", examples: ["382.78", "361.83"] },
      { name: "discounts", type: "money", gstBasis: "INCLUSIVE", description: "Discounts given.", examples: ["120.00", "85.50"] },
      { name: "refunds", type: "money", gstBasis: "INCLUSIVE", description: "Refunds issued.", examples: ["0.00", "45.00"] },
      { name: "service_charges", type: "money", gstBasis: "INCLUSIVE", description: "Service charges.", examples: ["0.00", "0.00"] },
      { name: "tips", type: "money", gstBasis: "NA", description: "Tips collected.", examples: ["85.00", "62.50"] },
      { name: "transactions", type: "integer", gstBasis: "NA", description: "Transaction count.", examples: ["142", "131"] },
      { name: "covers", type: "integer", gstBasis: "NA", description: "Covers served.", examples: ["186", "170"] },
      { name: "source", type: "string", gstBasis: "NA", description: "Where the figure came from.", examples: ["square_export", "manual_count"] },
    ],
  },
  {
    key: "sales_items",
    title: "Item sales",
    description: "Item-level sales for menu and margin analysis.",
    naturalKey: ["business_date", "company_code", "venue_code", "item_id"],
    targetTable: "fc_sales_order_lines",
    columns: [
      { name: "business_date", type: "date", required: true, gstBasis: "NA", description: "Trading date.", examples: ["2026-07-01", "2026-07-01"] },
      company,
      venue,
      { name: "item_id", type: "string", required: true, gstBasis: "NA", description: "POS item identifier.", examples: ["SQ-1001", "SQ-1002"] },
      { name: "item_name", type: "string", required: true, gstBasis: "NA", description: "Item name.", examples: ["Barramundi", "Margarita"] },
      { name: "category", type: "string", gstBasis: "NA", description: "Menu category.", examples: ["Mains", "Cocktails"] },
      { name: "quantity", type: "decimal", required: true, gstBasis: "NA", description: "Units sold.", examples: ["24", "63"] },
      { name: "gross_sales_inc_gst", type: "money", gstBasis: "INCLUSIVE", description: "Gross item sales INCLUDING GST.", examples: ["936.00", "1197.00"] },
      { name: "net_sales_ex_gst", type: "money", gstBasis: "EXCLUSIVE", description: "Net item sales EXCLUDING GST.", examples: ["850.91", "1088.18"] },
      { name: "discounts", type: "money", gstBasis: "INCLUSIVE", description: "Discounts on this item.", examples: ["0.00", "24.00"] },
      { name: "refunds", type: "money", gstBasis: "INCLUSIVE", description: "Refunds on this item.", examples: ["0.00", "0.00"] },
      { name: "menu_price", type: "money", gstBasis: "INCLUSIVE", description: "Menu price per unit.", examples: ["39.00", "19.00"] },
      { name: "unit_cogs", type: "money", gstBasis: "EXCLUSIVE", description: "Recipe cost per unit, EXCLUDING GST.", examples: ["11.20", "4.60"] },
      { name: "gst", type: "money", gstBasis: "NA", description: "GST component.", examples: ["85.09", "108.82"] },
      { name: "source", type: "string", gstBasis: "NA", description: "Source system.", examples: ["square_export", "square_export"] },
    ],
  },
  {
    key: "square_payouts",
    title: "Square payouts",
    description: "Actual Square-to-bank settlements. The basis for cash timing.",
    naturalKey: ["payout_id"],
    targetTable: "fc_square_payouts",
    columns: [
      { name: "payout_id", type: "string", required: true, gstBasis: "NA", description: "Square payout id.", examples: ["po_A1B2", "po_C3D4"] },
      company,
      venue,
      { name: "payout_date", type: "date", required: true, gstBasis: "NA", description: "Date Square initiated the payout.", examples: ["2026-07-01", "2026-07-02"] },
      { name: "arrival_date", type: "date", gstBasis: "NA", description: "Date the money lands. Preferred for cash timing.", examples: ["2026-07-02", "2026-07-03"] },
      { name: "gross_amount", type: "money", gstBasis: "INCLUSIVE", description: "Gross before fees.", examples: ["4310.55", "4080.10"] },
      { name: "fees", type: "money", gstBasis: "INCLUSIVE", description: "Square fees.", examples: ["100.00", "100.00"] },
      { name: "refunds", type: "money", gstBasis: "INCLUSIVE", description: "Refunds netted off.", examples: ["0.00", "0.00"] },
      { name: "adjustments", type: "money", gstBasis: "INCLUSIVE", description: "Other adjustments.", examples: ["0.00", "0.00"] },
      { name: "net_payout", type: "money", required: true, gstBasis: "INCLUSIVE", description: "Net amount reaching the bank.", examples: ["4210.55", "3980.10"] },
      { name: "destination_account", type: "string", gstBasis: "NA", description: "Destination bank account.", examples: ["NAB ****1234", "NAB ****1234"] },
      { name: "status", type: "string", gstBasis: "NA", description: "Payout status.", examples: ["PAID", "PAID"] },
    ],
  },
  {
    key: "xero_transactions",
    title: "Xero transactions",
    description: "General transaction export from Xero.",
    naturalKey: ["source_id"],
    targetTable: "fc_xero_bank_transactions",
    columns: [
      { name: "date", type: "date", required: true, gstBasis: "NA", description: "Transaction date.", examples: ["2026-07-01", "2026-07-02"] },
      company,
      { name: "contact", type: "string", gstBasis: "NA", description: "Contact name.", examples: ["FoodByUs", "Paramount Liquor"] },
      { name: "account_code", type: "string", gstBasis: "NA", description: "Xero account code.", examples: ["310", "312"] },
      { name: "account_name", type: "string", gstBasis: "NA", description: "Xero account name.", examples: ["Purchases Kitchen", "Purchases Bar"] },
      { name: "description", type: "string", gstBasis: "NA", description: "Line description.", examples: ["Weekly produce", "Beverage order"] },
      { name: "transaction_type", type: "string", gstBasis: "NA", description: "SPEND, RECEIVE, ACCPAY, ACCREC.", examples: ["ACCPAY", "SPEND"] },
      { name: "invoice_number", type: "string", gstBasis: "NA", description: "Invoice number.", examples: ["INV-1042", "INV-1043"] },
      { name: "invoice_date", type: "date", gstBasis: "NA", description: "Invoice date.", examples: ["2026-07-01", "2026-07-02"] },
      { name: "due_date", type: "date", gstBasis: "NA", description: "Due date.", examples: ["2026-07-31", "2026-08-01"] },
      { name: "gross_amount", type: "money", gstBasis: "INCLUSIVE", description: "Amount INCLUDING GST.", examples: ["1100.00", "550.00"] },
      { name: "net_amount", type: "money", gstBasis: "EXCLUSIVE", description: "Amount EXCLUDING GST.", examples: ["1000.00", "500.00"] },
      { name: "tax_amount", type: "money", gstBasis: "NA", description: "GST amount.", examples: ["100.00", "50.00"] },
      { name: "tax_rate", type: "string", gstBasis: "NA", description: "Xero tax rate name.", examples: ["GST on Expenses", "GST on Expenses"] },
      { name: "status", type: "string", gstBasis: "NA", description: "Status.", examples: ["AUTHORISED", "PAID"] },
      { name: "bank_account", type: "string", gstBasis: "NA", description: "Bank account.", examples: ["NAB Business", "NAB Business"] },
      { name: "tracking_category", type: "string", gstBasis: "NA", description: "Tracking category.", examples: ["Avalon", "Freshwater"] },
      { name: "source_id", type: "string", required: true, gstBasis: "NA", description: "Xero record id — used for deduplication.", examples: ["xero-txn-0001", "xero-txn-0002"] },
    ],
  },
  {
    key: "bills_due",
    title: "Bills due",
    description: "Accounts payable for the cash-flow forecast.",
    naturalKey: ["company_code", "bill_id"],
    targetTable: "fc_xero_bills",
    columns: [
      company,
      { name: "bill_id", type: "string", required: true, gstBasis: "NA", description: "Bill identifier.", examples: ["BILL-2001", "BILL-2002"] },
      { name: "supplier", type: "string", required: true, gstBasis: "NA", description: "Supplier name.", examples: ["FoodByUs", "Paramount Liquor"] },
      { name: "invoice_date", type: "date", gstBasis: "NA", description: "Invoice date.", examples: ["2026-07-01", "2026-07-03"] },
      { name: "due_date", type: "date", required: true, gstBasis: "NA", description: "Due date — drives the cash outflow timing.", examples: ["2026-07-31", "2026-08-02"] },
      { name: "amount_due", type: "money", required: true, gstBasis: "INCLUSIVE", description: "Amount owing INCLUDING GST.", examples: ["2310.00", "1650.00"] },
      { name: "gst", type: "money", gstBasis: "NA", description: "GST component.", examples: ["210.00", "150.00"] },
      { name: "payment_terms_days", type: "integer", gstBasis: "NA", description: "Supplier terms in days.", examples: ["30", "14"] },
      { name: "status", type: "string", gstBasis: "NA", description: "Bill status.", examples: ["AUTHORISED", "AUTHORISED"] },
      { name: "priority", type: "string", gstBasis: "NA", description: "Payment priority.", examples: ["NORMAL", "CRITICAL"] },
      { name: "category", type: "string", gstBasis: "NA", description: "Operational group.", examples: ["FOOD_COGS", "BEVERAGE_COGS"] },
      { name: "notes", type: "string", gstBasis: "NA", description: "Free text.", examples: ["Weekly account", "On hold pending credit"] },
    ],
  },
  {
    key: "payroll_weekly",
    title: "Weekly payroll",
    description: "Gross wages ALREADY include PAYG. PAYG is captured for BAS timing only.",
    naturalKey: ["company_code", "venue_code", "week_start"],
    targetTable: "fc_payroll_periods",
    columns: [
      { name: "week_start", type: "date", required: true, gstBasis: "NA", description: "Monday of the pay week.", examples: ["2026-06-29", "2026-07-06"] },
      { name: "week_end", type: "date", gstBasis: "NA", description: "Sunday of the pay week.", examples: ["2026-07-05", "2026-07-12"] },
      company,
      venue,
      { name: "gross_wages", type: "money", required: true, gstBasis: "NA", description: "GROSS wages, INCLUDING PAYG withheld. Do not add PAYG again.", examples: ["7000.00", "9000.00"] },
      { name: "super", type: "money", gstBasis: "NA", description: "Superannuation.", examples: ["840.00", "1080.00"] },
      { name: "payg", type: "money", gstBasis: "NA", description: "PAYG withheld FROM gross wages. Remittance timing only.", examples: ["1400.00", "1850.00"] },
      { name: "hours", type: "decimal", gstBasis: "NA", description: "Hours worked.", examples: ["286.5", "372.0"] },
      { name: "headcount", type: "integer", gstBasis: "NA", description: "Staff paid.", examples: ["14", "18"] },
      { name: "overtime_hours", type: "decimal", gstBasis: "NA", description: "Overtime hours.", examples: ["6.5", "12.0"] },
      { name: "kitchen_wages", type: "money", gstBasis: "NA", description: "Kitchen split.", examples: ["3200.00", "4100.00"] },
      { name: "foh_wages", type: "money", gstBasis: "NA", description: "Front of house split.", examples: ["2900.00", "3800.00"] },
      { name: "management_wages", type: "money", gstBasis: "NA", description: "Management split.", examples: ["900.00", "1100.00"] },
      { name: "notes", type: "string", gstBasis: "NA", description: "Free text.", examples: ["Public holiday loading", ""] },
    ],
  },
  {
    key: "stocktakes",
    title: "Stocktakes",
    description: "Physical counts. COGS = opening + purchases + in − out − closing.",
    naturalKey: ["company_code", "venue_code", "stocktake_date", "category"],
    targetTable: "fc_stocktakes",
    columns: [
      { name: "stocktake_date", type: "date", required: true, gstBasis: "NA", description: "Count date.", examples: ["2026-06-30", "2026-06-30"] },
      company,
      venue,
      { name: "category", type: "string", required: true, gstBasis: "NA", description: "Stock category.", examples: ["Food", "Beverage"] },
      { name: "opening_stock", type: "money", gstBasis: "EXCLUSIVE", description: "Opening valuation EXCLUDING GST.", examples: ["18500.00", "24200.00"] },
      { name: "purchases", type: "money", gstBasis: "EXCLUSIVE", description: "Purchases in the period.", examples: ["42000.00", "31000.00"] },
      { name: "transfers_in", type: "money", gstBasis: "EXCLUSIVE", description: "Transfers in.", examples: ["0.00", "450.00"] },
      { name: "transfers_out", type: "money", gstBasis: "EXCLUSIVE", description: "Transfers out.", examples: ["450.00", "0.00"] },
      { name: "wastage", type: "money", gstBasis: "EXCLUSIVE", description: "Wastage — kept visible, not hidden in COGS.", examples: ["620.00", "180.00"] },
      { name: "staff_meals", type: "money", gstBasis: "EXCLUSIVE", description: "Staff meals.", examples: ["980.00", "120.00"] },
      { name: "closing_stock", type: "money", gstBasis: "EXCLUSIVE", description: "Closing valuation.", examples: ["19100.00", "23800.00"] },
    ],
  },
  {
    key: "cash_commitments",
    title: "Cash commitments",
    description: "Recurring and one-off committed payments.",
    naturalKey: ["company_code", "description", "start_date"],
    targetTable: "fc_recurring_commitments",
    columns: [
      company,
      venue,
      { name: "description", type: "string", required: true, gstBasis: "NA", description: "What the payment is.", examples: ["Rent", "NAB loan repayment"] },
      { name: "category", type: "string", required: true, gstBasis: "NA", description: "Operational group.", examples: ["RENT", "FINANCE_REPAYMENTS"] },
      { name: "start_date", type: "date", required: true, gstBasis: "NA", description: "First payment date.", examples: ["2026-08-01", "2026-08-15"] },
      { name: "end_date", type: "date", gstBasis: "NA", description: "Last payment date. Blank for open-ended.", examples: ["2027-07-31", ""] },
      { name: "frequency", type: "enum", required: true, values: ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "QUARTERLY", "ANNUAL", "ONE_OFF"], gstBasis: "NA", description: "Payment frequency.", examples: ["MONTHLY", "MONTHLY"] },
      { name: "amount", type: "money", required: true, gstBasis: "EXCLUSIVE", description: "Amount per payment. State the GST treatment below.", examples: ["12828.77", "11656.00"] },
      { name: "gst_treatment", type: "enum", values: ["EXCLUSIVE", "INCLUSIVE", "FREE"], gstBasis: "NA", description: "How GST applies to the amount.", examples: ["EXCLUSIVE", "FREE"] },
      { name: "payment_day", type: "integer", gstBasis: "NA", description: "Day of month or week the payment falls.", examples: ["1", "15"] },
      { name: "priority", type: "string", gstBasis: "NA", description: "Payment priority.", examples: ["CRITICAL", "CRITICAL"] },
      { name: "scenario", type: "string", gstBasis: "NA", description: "Scenario key, blank for all scenarios.", examples: ["", "BASE"] },
      { name: "active", type: "boolean", gstBasis: "NA", description: "Whether the commitment is live.", examples: ["true", "true"] },
    ],
  },
  {
    key: "bas_history",
    title: "BAS history",
    description: "Lodged BAS. Replaces the estimated GST reserve rate wherever available.",
    naturalKey: ["company_code", "period_start"],
    targetTable: "fc_tax_obligations",
    columns: [
      company,
      { name: "period_start", type: "date", required: true, gstBasis: "NA", description: "Period start.", examples: ["2026-04-01", "2026-01-01"] },
      { name: "period_end", type: "date", required: true, gstBasis: "NA", description: "Period end.", examples: ["2026-06-30", "2026-03-31"] },
      { name: "accounting_basis", type: "enum", values: ["CASH", "ACCRUAL"], gstBasis: "NA", description: "Both entities report GST on a CASH basis.", examples: ["CASH", "CASH"] },
      { name: "g1_gross_sales", type: "money", gstBasis: "INCLUSIVE", description: "G1 total sales INCLUDING GST.", examples: ["318000.00", "402000.00"] },
      { name: "gst_1a", type: "money", gstBasis: "NA", description: "1A GST on sales.", examples: ["28909.09", "36545.45"] },
      { name: "gst_1b", type: "money", gstBasis: "NA", description: "1B GST on purchases.", examples: ["10400.00", "12100.00"] },
      { name: "net_gst", type: "money", gstBasis: "NA", description: "Net GST payable.", examples: ["18509.09", "24445.45"] },
      { name: "payg", type: "money", gstBasis: "NA", description: "PAYG withholding remitted.", examples: ["18200.00", "22400.00"] },
      { name: "total_statement", type: "money", gstBasis: "NA", description: "Total BAS amount.", examples: ["36709.09", "46845.45"] },
      { name: "due_date", type: "date", gstBasis: "NA", description: "Lodgement due date.", examples: ["2026-07-28", "2026-04-28"] },
      { name: "paid_date", type: "date", gstBasis: "NA", description: "Date paid.", examples: ["", "2026-04-28"] },
      { name: "status", type: "enum", values: ["ESTIMATED", "DRAFT", "LODGED", "PAID"], gstBasis: "NA", description: "Status.", examples: ["DRAFT", "PAID"] },
    ],
  },
  {
    key: "creditor_claims",
    title: "Creditor claims",
    description: "Proofs of debt. Only external claims participate unless switched on.",
    naturalKey: ["company_code", "creditor_name"],
    targetTable: "fc_creditor_claims",
    columns: [
      company,
      { name: "creditor_name", type: "string", required: true, gstBasis: "NA", description: "Creditor name.", examples: ["FoodByUs", "Director loan account"] },
      { name: "creditor_class", type: "enum", required: true, values: ["EXTERNAL_TRADE", "DIRECTOR_LOAN", "INTERCOMPANY", "SECURED", "PRIORITY_EMPLOYEE", "RELATED_PARTY", "CONTINGENT", "STATUTORY"], gstBasis: "NA", description: "Claim class. Drives participation.", examples: ["EXTERNAL_TRADE", "DIRECTOR_LOAN"] },
      { name: "related_party", type: "boolean", gstBasis: "NA", description: "Whether the creditor is a related party.", examples: ["false", "true"] },
      { name: "secured", type: "boolean", gstBasis: "NA", description: "Whether the claim is secured.", examples: ["false", "false"] },
      { name: "priority", type: "boolean", gstBasis: "NA", description: "Whether the claim is a priority claim.", examples: ["false", "false"] },
      { name: "claimed_amount", type: "money", required: true, gstBasis: "INCLUSIVE", description: "Amount claimed.", examples: ["42150.00", "180000.00"] },
      { name: "admitted_amount", type: "money", gstBasis: "INCLUSIVE", description: "Amount admitted by the administrator. Blank until adjudicated.", examples: ["42150.00", ""] },
      { name: "excluded_from_distribution", type: "boolean", gstBasis: "NA", description: "Explicit exclusion on top of the class default.", examples: ["false", "true"] },
      { name: "notes", type: "string", gstBasis: "NA", description: "Free text.", examples: ["Trade supplier", "Excluded per proposal"] },
    ],
  },
  {
    key: "forecast_overrides",
    title: "Forecast overrides",
    description: "Manual adjustments. Sit above forecasts, never above actuals.",
    naturalKey: ["company_code", "metric", "date_from"],
    targetTable: "fc_overrides",
    columns: [
      company,
      venue,
      { name: "date_from", type: "date", required: true, gstBasis: "NA", description: "First date the override applies.", examples: ["2026-08-01", "2026-09-01"] },
      { name: "date_to", type: "date", required: true, gstBasis: "NA", description: "Last date the override applies.", examples: ["2026-08-31", "2026-09-30"] },
      { name: "metric", type: "string", required: true, gstBasis: "NA", description: "Metric being adjusted.", examples: ["sales", "wages"] },
      { name: "adjustment_type", type: "enum", required: true, values: ["FIXED_REPLACEMENT", "DOLLAR_ADJUSTMENT", "PERCENT_ADJUSTMENT"], gstBasis: "NA", description: "How the value applies.", examples: ["PERCENT_ADJUSTMENT", "DOLLAR_ADJUSTMENT"] },
      { name: "adjustment_value", type: "decimal", required: true, gstBasis: "NA", description: "Percent, or dollars for a dollar adjustment.", examples: ["-10", "2500"] },
      { name: "reason", type: "string", required: true, gstBasis: "NA", description: "Why — required for the audit trail.", examples: ["Kitchen refurbishment", "Additional chef"] },
      { name: "author", type: "string", required: true, gstBasis: "NA", description: "Who entered it.", examples: ["T Christensen", "T Christensen"] },
      { name: "expires_at", type: "date", gstBasis: "NA", description: "When the override lapses.", examples: ["2026-09-01", "2026-10-01"] },
    ],
  },
  {
    key: "bookings_daily",
    title: "Daily bookings",
    description: "Booking pace for the covers forecast.",
    naturalKey: ["company_code", "venue_code", "service_date", "snapshot_date"],
    targetTable: "fc_bookings_snapshots",
    columns: [
      company,
      venue,
      { name: "service_date", type: "date", required: true, gstBasis: "NA", description: "Date being served.", examples: ["2026-08-01", "2026-08-02"] },
      { name: "snapshot_date", type: "date", required: true, gstBasis: "NA", description: "Date the count was taken — booking pace needs both.", examples: ["2026-07-28", "2026-07-28"] },
      { name: "lunch_covers", type: "integer", gstBasis: "NA", description: "Lunch covers booked.", examples: ["42", "38"] },
      { name: "dinner_covers", type: "integer", gstBasis: "NA", description: "Dinner covers booked.", examples: ["96", "104"] },
      { name: "total_covers", type: "integer", gstBasis: "NA", description: "Total covers booked.", examples: ["138", "142"] },
      { name: "capacity", type: "integer", gstBasis: "NA", description: "Seats available.", examples: ["180", "180"] },
      { name: "cancellations", type: "integer", gstBasis: "NA", description: "Cancellations.", examples: ["4", "6"] },
      { name: "no_shows", type: "integer", gstBasis: "NA", description: "No-shows.", examples: ["2", "3"] },
      { name: "event_name", type: "string", gstBasis: "NA", description: "Event, if any.", examples: ["", "Wedding"] },
    ],
  },
  {
    key: "business_events",
    title: "Business events",
    description: "Closures, promotions and one-offs so the model does not learn from an unexplained day.",
    naturalKey: ["company_code", "venue_code", "date_from", "event_type"],
    targetTable: "fc_business_events",
    columns: [
      company,
      venue,
      { name: "date_from", type: "date", required: true, gstBasis: "NA", description: "First affected date.", examples: ["2026-12-25", "2026-08-10"] },
      { name: "date_to", type: "date", required: true, gstBasis: "NA", description: "Last affected date.", examples: ["2026-12-25", "2026-08-14"] },
      { name: "event_type", type: "enum", required: true, values: ["CLOSURE", "REDUCED_HOURS", "PROMOTION", "EVENT", "MENU_PRICE_CHANGE", "ABNORMAL"], gstBasis: "NA", description: "Event type.", examples: ["CLOSURE", "REDUCED_HOURS"] },
      { name: "expected_sales_impact_percent", type: "percent", gstBasis: "NA", description: "Expected sales impact, percent.", examples: ["-100", "-35"] },
      { name: "expected_cost_impact", type: "money", gstBasis: "EXCLUSIVE", description: "Expected cost impact in dollars.", examples: ["0.00", "-4200.00"] },
      { name: "description", type: "string", gstBasis: "NA", description: "What happened.", examples: ["Christmas Day closure", "Kitchen exhaust replacement"] },
    ],
  },
] as const;

export function datasetByKey(key: string): DatasetSpec | undefined {
  return DATASETS.find((dataset) => dataset.key === key);
}

/** CSV text for the downloadable template: headers plus two example rows. */
export function buildSampleCsv(dataset: DatasetSpec): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const header = dataset.columns.map((column) => column.name).join(",");
  const rows = [0, 1].map((index) =>
    dataset.columns.map((column) => escape(column.examples[index as 0 | 1] ?? "")).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

/** Human-readable column reference shipped alongside the sample files. */
export function buildDataDictionary(dataset: DatasetSpec): string {
  const lines = [
    `# ${dataset.title} (${dataset.key})`,
    "",
    dataset.description,
    "",
    `Target: ${dataset.targetTable}`,
    `Duplicate detection key: ${dataset.naturalKey.join(" + ")}`,
    "",
    "| Column | Type | Required | GST basis | Description |",
    "| --- | --- | --- | --- | --- |",
    ...dataset.columns.map(
      (column) =>
        `| \`${column.name}\` | ${column.type} | ${column.required ? "yes" : "no"} | ${column.gstBasis ?? "NA"} | ${column.description} |`,
    ),
    "",
    "Money columns are entered in DOLLARS and stored as integer cents.",
  ];
  return lines.join("\n") + "\n";
}

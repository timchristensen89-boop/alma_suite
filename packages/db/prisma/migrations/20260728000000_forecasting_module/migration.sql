-- Forecasting module: additive only.
--
-- Deliberately filtered. `prisma migrate diff --from-migrations` also wanted to
-- DROP RecipeSalePrice, StockSupplierOrder and StockSupplierOrderItem, because
-- schema.prisma has drifted from the migration history for those models. That
-- drift predates this module and is NOT resolved here — dropping live
-- supplier-order tables is not this migration's business. See
-- docs/forecasting-module.md.
--
-- Every object below is namespaced fc_* / Fc* and touches nothing existing.

-- CreateEnum
CREATE TYPE "FcProvenance" AS ENUM ('ACTUAL', 'ACCOUNTING_ESTIMATE', 'MANAGEMENT_ASSUMPTION', 'MODEL_FORECAST', 'MANUAL_OVERRIDE', 'PROPOSAL_TERM');

-- CreateEnum
CREATE TYPE "FcSourceSystem" AS ENUM ('SQUARE', 'XERO', 'LIGHTSPEED', 'MANUAL', 'CSV_IMPORT', 'BANK', 'DERIVED');

-- CreateEnum
CREATE TYPE "FcNormalisationStatus" AS ENUM ('PENDING', 'NORMALISED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "FcSeverity" AS ENUM ('INFORMATIONAL', 'WARNING', 'BLOCKING');

-- CreateEnum
CREATE TYPE "FcOperationalGroup" AS ENUM ('SALES', 'FOOD_COGS', 'BEVERAGE_COGS', 'WAGES', 'SUPER', 'RENT', 'CLEANING', 'SOFTWARE', 'UTILITIES', 'MERCHANT_FEES', 'INSURANCE', 'REPAIRS', 'MAINTENANCE', 'FINANCE_REPAYMENTS', 'INTEREST', 'TAX_PAYMENTS', 'CREDITOR_DISTRIBUTIONS', 'CAPITAL_EXPENDITURE', 'DIRECTOR_TRANSACTIONS', 'INTERCOMPANY', 'EXCLUDED', 'UNMAPPED');

-- CreateEnum
CREATE TYPE "FcCreditorClass" AS ENUM ('EXTERNAL_TRADE', 'DIRECTOR_LOAN', 'INTERCOMPANY', 'SECURED', 'PRIORITY_EMPLOYEE', 'RELATED_PARTY', 'CONTINGENT', 'STATUTORY');

-- CreateTable
CREATE TABLE "fc_companies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT NOT NULL,
    "abn" TEXT,
    "xeroTenantId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_venues" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legacyVenueName" TEXT,
    "squareLocationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fc_venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_raw_source_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "sourceSystem" "FcSourceSystem" NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceTimestamp" TIMESTAMP(3),
    "businessDate" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "normalisationStatus" "FcNormalisationStatus" NOT NULL DEFAULT 'PENDING',
    "normalisationError" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_raw_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_import_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "mappingProfile" JSONB,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "allOrNothing" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByLabel" TEXT,

    CONSTRAINT "fc_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_import_rows" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalised" JSONB,
    "targetTable" TEXT,
    "targetRecordId" TEXT,
    "duplicateOf" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fc_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_import_errors" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "column" TEXT,
    "severity" "FcSeverity" NOT NULL DEFAULT 'BLOCKING',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "fc_import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_account_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "operationalGroup" "FcOperationalGroup" NOT NULL DEFAULT 'UNMAPPED',
    "isCashflowItem" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByLabel" TEXT,

    CONSTRAINT "fc_account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_supplier_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "normalisedName" TEXT NOT NULL,
    "operationalGroup" "FcOperationalGroup" NOT NULL DEFAULT 'UNMAPPED',
    "relatedParty" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_supplier_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_category_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceCategory" TEXT NOT NULL,
    "operationalGroup" "FcOperationalGroup" NOT NULL DEFAULT 'UNMAPPED',
    "isBeverage" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_category_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_sales_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "sourceSystem" "FcSourceSystem" NOT NULL DEFAULT 'SQUARE',
    "sourceId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "grossSalesCents" INTEGER NOT NULL DEFAULT 0,
    "netSalesExGstCents" INTEGER NOT NULL DEFAULT 0,
    "gstCents" INTEGER NOT NULL DEFAULT 0,
    "discountsCents" INTEGER NOT NULL DEFAULT 0,
    "serviceChargeCents" INTEGER NOT NULL DEFAULT 0,
    "tipsCents" INTEGER NOT NULL DEFAULT 0,
    "refundsCents" INTEGER NOT NULL DEFAULT 0,
    "covers" INTEGER,
    "transactionCount" INTEGER NOT NULL DEFAULT 1,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_sales_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "itemSourceId" TEXT,
    "itemName" TEXT NOT NULL,
    "category" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "grossSalesCents" INTEGER NOT NULL DEFAULT 0,
    "netSalesExGstCents" INTEGER NOT NULL DEFAULT 0,
    "discountsCents" INTEGER NOT NULL DEFAULT 0,
    "refundsCents" INTEGER NOT NULL DEFAULT 0,
    "menuPriceCents" INTEGER,
    "unitCogsCents" INTEGER,

    CONSTRAINT "fc_sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_sales_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "sourceSystem" "FcSourceSystem" NOT NULL DEFAULT 'SQUARE',
    "sourceId" TEXT NOT NULL,
    "orderSourceId" TEXT,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "amountCents" INTEGER NOT NULL,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "tenderType" TEXT,
    "status" TEXT,
    "payoutId" TEXT,

    CONSTRAINT "fc_sales_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_sales_refunds" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "sourceSystem" "FcSourceSystem" NOT NULL DEFAULT 'SQUARE',
    "sourceId" TEXT NOT NULL,
    "paymentSourceId" TEXT,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT,

    CONSTRAINT "fc_sales_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_square_payouts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "sourceId" TEXT NOT NULL,
    "payoutDate" TIMESTAMP(3) NOT NULL,
    "arrivalDate" TIMESTAMP(3),
    "grossAmountCents" INTEGER NOT NULL DEFAULT 0,
    "feesCents" INTEGER NOT NULL DEFAULT 0,
    "refundsCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentsCents" INTEGER NOT NULL DEFAULT 0,
    "netPayoutCents" INTEGER NOT NULL,
    "destinationAccount" TEXT,
    "status" TEXT,
    "matchedBankTxnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_square_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_square_payout_entries" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" TEXT,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "effectiveAt" TIMESTAMP(3),
    "paymentSourceId" TEXT,

    CONSTRAINT "fc_square_payout_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_xero_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "taxType" TEXT,
    "isBank" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_xero_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_xero_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "contactName" TEXT,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "netAmountCents" INTEGER NOT NULL DEFAULT 0,
    "taxAmountCents" INTEGER NOT NULL DEFAULT 0,
    "grossAmountCents" INTEGER NOT NULL DEFAULT 0,
    "amountDueCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_xero_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_xero_bills" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "supplierName" TEXT,
    "operationalGroup" "FcOperationalGroup" NOT NULL DEFAULT 'UNMAPPED',
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "netAmountCents" INTEGER NOT NULL DEFAULT 0,
    "taxAmountCents" INTEGER NOT NULL DEFAULT 0,
    "grossAmountCents" INTEGER NOT NULL DEFAULT 0,
    "amountDueCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT,
    "paymentTermsDays" INTEGER,
    "priority" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_xero_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_xero_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "paidDate" TIMESTAMP(3),
    "amountCents" INTEGER NOT NULL,
    "invoiceSourceId" TEXT,
    "billSourceId" TEXT,
    "bankAccountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_xero_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_xero_bank_transactions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "bankAccountName" TEXT,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "type" TEXT,
    "contactName" TEXT,
    "reference" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_xero_bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_bank_balance_snapshots" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asAt" TIMESTAMP(3) NOT NULL,
    "bankAccount" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "sourceSystem" "FcSourceSystem" NOT NULL DEFAULT 'XERO',
    "provenance" "FcProvenance" NOT NULL DEFAULT 'ACTUAL',
    "enteredByLabel" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_bank_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_payroll_periods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "grossWagesCents" INTEGER NOT NULL,
    "superCents" INTEGER NOT NULL DEFAULT 0,
    "paygWithheldCents" INTEGER NOT NULL DEFAULT 0,
    "hours" DECIMAL(10,2),
    "headcount" INTEGER,
    "overtimeHours" DECIMAL(10,2),
    "kitchenWagesCents" INTEGER,
    "fohWagesCents" INTEGER,
    "managementWagesCents" INTEGER,
    "provenance" "FcProvenance" NOT NULL DEFAULT 'ACTUAL',
    "notes" TEXT,

    CONSTRAINT "fc_payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_stocktakes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "stocktakeDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "openingStockCents" INTEGER NOT NULL DEFAULT 0,
    "purchasesCents" INTEGER NOT NULL DEFAULT 0,
    "transfersInCents" INTEGER NOT NULL DEFAULT 0,
    "transfersOutCents" INTEGER NOT NULL DEFAULT 0,
    "wastageCents" INTEGER NOT NULL DEFAULT 0,
    "staffMealsCents" INTEGER NOT NULL DEFAULT 0,
    "closingStockCents" INTEGER NOT NULL DEFAULT 0,
    "provenance" "FcProvenance" NOT NULL DEFAULT 'ACTUAL',

    CONSTRAINT "fc_stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_inventory_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,

    CONSTRAINT "fc_inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_bookings_snapshots" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "lunchCovers" INTEGER NOT NULL DEFAULT 0,
    "dinnerCovers" INTEGER NOT NULL DEFAULT 0,
    "totalCovers" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "cancellations" INTEGER NOT NULL DEFAULT 0,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "eventName" TEXT,

    CONSTRAINT "fc_bookings_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_business_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "eventType" TEXT NOT NULL,
    "expectedSalesImpactPercent" DECIMAL(6,3),
    "expectedCostImpactCents" INTEGER,
    "excludeFromTraining" BOOLEAN NOT NULL DEFAULT false,
    "approvedForLearning" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_business_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_recurring_commitments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "description" TEXT NOT NULL,
    "category" "FcOperationalGroup" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "frequency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "gstTreatment" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "paymentDay" INTEGER,
    "priority" TEXT,
    "scenarioId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "provenance" "FcProvenance" NOT NULL DEFAULT 'MANAGEMENT_ASSUMPTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_recurring_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_tax_obligations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "obligationType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "accountingBasis" TEXT NOT NULL DEFAULT 'CASH',
    "g1GrossSalesCents" INTEGER,
    "gst1ACents" INTEGER,
    "gst1BCents" INTEGER,
    "netGstCents" INTEGER,
    "paygCents" INTEGER,
    "totalStatementCents" INTEGER,
    "dueDate" TIMESTAMP(3),
    "paidDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "provenance" "FcProvenance" NOT NULL DEFAULT 'MODEL_FORECAST',

    CONSTRAINT "fc_tax_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_creditor_claims" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditorName" TEXT NOT NULL,
    "creditorClass" "FcCreditorClass" NOT NULL DEFAULT 'EXTERNAL_TRADE',
    "relatedParty" BOOLEAN NOT NULL DEFAULT false,
    "secured" BOOLEAN NOT NULL DEFAULT false,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "claimedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "admittedAmountCents" INTEGER,
    "excludedFromDistribution" BOOLEAN NOT NULL DEFAULT false,
    "proofOfDebtStatus" TEXT NOT NULL DEFAULT 'CLAIMED',
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_creditor_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_creditor_proposals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fixedTotalCents" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL DEFAULT 36,
    "performanceSharePercent" DECIMAL(6,3) NOT NULL DEFAULT 25,
    "performanceCapCents" INTEGER NOT NULL,
    "deedCostsCents" INTEGER NOT NULL DEFAULT 0,
    "includeDirectorLoans" BOOLEAN NOT NULL DEFAULT false,
    "includeIntercompany" BOOLEAN NOT NULL DEFAULT false,
    "includeSecuredShortfall" BOOLEAN NOT NULL DEFAULT false,
    "includePriorityClaims" BOOLEAN NOT NULL DEFAULT false,
    "includeContingentClaims" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "provenance" "FcProvenance" NOT NULL DEFAULT 'PROPOSAL_TERM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_creditor_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_creditor_payment_schedules" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "yearNumber" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "fixedCents" INTEGER NOT NULL DEFAULT 0,
    "performanceCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "paidDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "fc_creditor_payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_assumptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "valueNumeric" DECIMAL(18,4),
    "valueText" TEXT,
    "unit" TEXT,
    "provenance" "FcProvenance" NOT NULL DEFAULT 'MANAGEMENT_ASSUMPTION',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "sourceNote" TEXT,
    "authorLabel" TEXT,
    "supersededById" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_overrides" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "metric" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "adjustmentValue" DECIMAL(18,4) NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "reason" TEXT NOT NULL,
    "authorLabel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "provenance" "FcProvenance" NOT NULL DEFAULT 'MANUAL_OVERRIDE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_scenarios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "adjustments" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fc_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_model_versions" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "algorithm" TEXT NOT NULL,
    "hyperparams" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '[]',
    "isChampion" BOOLEAN NOT NULL DEFAULT false,
    "promotedAt" TIMESTAMP(3),
    "promotedByLabel" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_forecast_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "modelVersionId" TEXT,
    "family" TEXT NOT NULL,
    "horizonStart" TIMESTAMP(3) NOT NULL,
    "horizonEnd" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "assumptionSnapshot" JSONB NOT NULL DEFAULT '{}',
    "overrideSnapshot" JSONB NOT NULL DEFAULT '[]',
    "featureSet" JSONB NOT NULL DEFAULT '[]',
    "sourceDataCutoff" TIMESTAMP(3) NOT NULL,
    "trainingStart" TIMESTAMP(3),
    "trainingEnd" TIMESTAMP(3),
    "selectionReason" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByLabel" TEXT,

    CONSTRAINT "fc_forecast_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_forecast_points" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "venueId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "centralCents" INTEGER NOT NULL,
    "lower80Cents" INTEGER,
    "upper80Cents" INTEGER,
    "lower95Cents" INTEGER,
    "upper95Cents" INTEGER,
    "provenance" "FcProvenance" NOT NULL DEFAULT 'MODEL_FORECAST',
    "overrideId" TEXT,

    CONSTRAINT "fc_forecast_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_model_accuracy_results" (
    "id" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "wape" DECIMAL(10,4),
    "mae" DECIMAL(18,4),
    "rmse" DECIMAL(18,4),
    "bias" DECIMAL(18,4),
    "mape" DECIMAL(10,4),
    "directionalAccuracy" DECIMAL(10,4),
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_model_accuracy_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_data_quality_issues" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "severity" "FcSeverity" NOT NULL DEFAULT 'WARNING',
    "entityType" TEXT,
    "entityId" TEXT,
    "businessDate" TIMESTAMP(3),
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByLabel" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_data_quality_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fc_audit_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fc_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fc_companies_code_key" ON "fc_companies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fc_venues_code_key" ON "fc_venues"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fc_venues_legacyVenueName_key" ON "fc_venues"("legacyVenueName");

-- CreateIndex
CREATE INDEX "fc_venues_companyId_idx" ON "fc_venues"("companyId");

-- CreateIndex
CREATE INDEX "fc_raw_source_records_companyId_businessDate_idx" ON "fc_raw_source_records"("companyId", "businessDate");

-- CreateIndex
CREATE INDEX "fc_raw_source_records_sourceSystem_sourceEntity_sourceId_idx" ON "fc_raw_source_records"("sourceSystem", "sourceEntity", "sourceId");

-- CreateIndex
CREATE INDEX "fc_raw_source_records_normalisationStatus_idx" ON "fc_raw_source_records"("normalisationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "fc_raw_source_records_sourceSystem_idempotencyKey_key" ON "fc_raw_source_records"("sourceSystem", "idempotencyKey");

-- CreateIndex
CREATE INDEX "fc_import_jobs_companyId_datasetKey_startedAt_idx" ON "fc_import_jobs"("companyId", "datasetKey", "startedAt");

-- CreateIndex
CREATE INDEX "fc_import_rows_importJobId_rowNumber_idx" ON "fc_import_rows"("importJobId", "rowNumber");

-- CreateIndex
CREATE INDEX "fc_import_errors_importJobId_idx" ON "fc_import_errors"("importJobId");

-- CreateIndex
CREATE INDEX "fc_account_mappings_companyId_operationalGroup_idx" ON "fc_account_mappings"("companyId", "operationalGroup");

-- CreateIndex
CREATE UNIQUE INDEX "fc_account_mappings_companyId_accountCode_key" ON "fc_account_mappings"("companyId", "accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "fc_supplier_mappings_companyId_normalisedName_key" ON "fc_supplier_mappings"("companyId", "normalisedName");

-- CreateIndex
CREATE UNIQUE INDEX "fc_category_mappings_companyId_sourceCategory_key" ON "fc_category_mappings"("companyId", "sourceCategory");

-- CreateIndex
CREATE INDEX "fc_sales_orders_companyId_businessDate_idx" ON "fc_sales_orders"("companyId", "businessDate");

-- CreateIndex
CREATE INDEX "fc_sales_orders_venueId_businessDate_idx" ON "fc_sales_orders"("venueId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_sales_orders_sourceSystem_sourceId_key" ON "fc_sales_orders"("sourceSystem", "sourceId");

-- CreateIndex
CREATE INDEX "fc_sales_order_lines_companyId_businessDate_idx" ON "fc_sales_order_lines"("companyId", "businessDate");

-- CreateIndex
CREATE INDEX "fc_sales_order_lines_orderId_idx" ON "fc_sales_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "fc_sales_payments_companyId_businessDate_idx" ON "fc_sales_payments"("companyId", "businessDate");

-- CreateIndex
CREATE INDEX "fc_sales_payments_payoutId_idx" ON "fc_sales_payments"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "fc_sales_payments_sourceSystem_sourceId_key" ON "fc_sales_payments"("sourceSystem", "sourceId");

-- CreateIndex
CREATE INDEX "fc_sales_refunds_companyId_businessDate_idx" ON "fc_sales_refunds"("companyId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_sales_refunds_sourceSystem_sourceId_key" ON "fc_sales_refunds"("sourceSystem", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "fc_square_payouts_sourceId_key" ON "fc_square_payouts"("sourceId");

-- CreateIndex
CREATE INDEX "fc_square_payouts_companyId_arrivalDate_idx" ON "fc_square_payouts"("companyId", "arrivalDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_square_payout_entries_sourceId_key" ON "fc_square_payout_entries"("sourceId");

-- CreateIndex
CREATE INDEX "fc_square_payout_entries_payoutId_idx" ON "fc_square_payout_entries"("payoutId");

-- CreateIndex
CREATE INDEX "fc_xero_accounts_companyId_code_idx" ON "fc_xero_accounts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fc_xero_accounts_companyId_sourceId_key" ON "fc_xero_accounts"("companyId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "fc_xero_invoices_sourceId_key" ON "fc_xero_invoices"("sourceId");

-- CreateIndex
CREATE INDEX "fc_xero_invoices_companyId_dueDate_idx" ON "fc_xero_invoices"("companyId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_xero_bills_sourceId_key" ON "fc_xero_bills"("sourceId");

-- CreateIndex
CREATE INDEX "fc_xero_bills_companyId_dueDate_idx" ON "fc_xero_bills"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "fc_xero_bills_companyId_status_idx" ON "fc_xero_bills"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fc_xero_payments_sourceId_key" ON "fc_xero_payments"("sourceId");

-- CreateIndex
CREATE INDEX "fc_xero_payments_companyId_paidDate_idx" ON "fc_xero_payments"("companyId", "paidDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_xero_bank_transactions_sourceId_key" ON "fc_xero_bank_transactions"("sourceId");

-- CreateIndex
CREATE INDEX "fc_xero_bank_transactions_companyId_txnDate_idx" ON "fc_xero_bank_transactions"("companyId", "txnDate");

-- CreateIndex
CREATE INDEX "fc_bank_balance_snapshots_companyId_asAt_idx" ON "fc_bank_balance_snapshots"("companyId", "asAt");

-- CreateIndex
CREATE UNIQUE INDEX "fc_bank_balance_snapshots_companyId_bankAccount_asAt_key" ON "fc_bank_balance_snapshots"("companyId", "bankAccount", "asAt");

-- CreateIndex
CREATE INDEX "fc_payroll_periods_companyId_weekStart_idx" ON "fc_payroll_periods"("companyId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "fc_payroll_periods_companyId_venueId_weekStart_key" ON "fc_payroll_periods"("companyId", "venueId", "weekStart");

-- CreateIndex
CREATE INDEX "fc_stocktakes_companyId_stocktakeDate_idx" ON "fc_stocktakes"("companyId", "stocktakeDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_stocktakes_companyId_venueId_stocktakeDate_category_key" ON "fc_stocktakes"("companyId", "venueId", "stocktakeDate", "category");

-- CreateIndex
CREATE INDEX "fc_inventory_movements_companyId_movementDate_idx" ON "fc_inventory_movements"("companyId", "movementDate");

-- CreateIndex
CREATE INDEX "fc_bookings_snapshots_companyId_serviceDate_idx" ON "fc_bookings_snapshots"("companyId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_bookings_snapshots_companyId_venueId_serviceDate_snapsho_key" ON "fc_bookings_snapshots"("companyId", "venueId", "serviceDate", "snapshotDate");

-- CreateIndex
CREATE INDEX "fc_business_events_companyId_dateFrom_idx" ON "fc_business_events"("companyId", "dateFrom");

-- CreateIndex
CREATE INDEX "fc_recurring_commitments_companyId_active_idx" ON "fc_recurring_commitments"("companyId", "active");

-- CreateIndex
CREATE INDEX "fc_tax_obligations_companyId_dueDate_idx" ON "fc_tax_obligations"("companyId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fc_tax_obligations_companyId_obligationType_periodStart_key" ON "fc_tax_obligations"("companyId", "obligationType", "periodStart");

-- CreateIndex
CREATE INDEX "fc_creditor_claims_companyId_creditorClass_idx" ON "fc_creditor_claims"("companyId", "creditorClass");

-- CreateIndex
CREATE INDEX "fc_creditor_proposals_companyId_idx" ON "fc_creditor_proposals"("companyId");

-- CreateIndex
CREATE INDEX "fc_creditor_payment_schedules_proposalId_idx" ON "fc_creditor_payment_schedules"("proposalId");

-- CreateIndex
CREATE INDEX "fc_assumptions_companyId_key_active_idx" ON "fc_assumptions"("companyId", "key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "fc_assumptions_companyId_venueId_key_version_key" ON "fc_assumptions"("companyId", "venueId", "key", "version");

-- CreateIndex
CREATE INDEX "fc_overrides_companyId_metric_active_idx" ON "fc_overrides"("companyId", "metric", "active");

-- CreateIndex
CREATE UNIQUE INDEX "fc_scenarios_companyId_key_key" ON "fc_scenarios"("companyId", "key");

-- CreateIndex
CREATE INDEX "fc_model_versions_family_isChampion_idx" ON "fc_model_versions"("family", "isChampion");

-- CreateIndex
CREATE UNIQUE INDEX "fc_model_versions_family_version_key" ON "fc_model_versions"("family", "version");

-- CreateIndex
CREATE INDEX "fc_forecast_runs_companyId_family_generatedAt_idx" ON "fc_forecast_runs"("companyId", "family", "generatedAt");

-- CreateIndex
CREATE INDEX "fc_forecast_points_runId_metric_periodStart_idx" ON "fc_forecast_points"("runId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "fc_forecast_points_companyId_metric_periodStart_idx" ON "fc_forecast_points"("companyId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "fc_model_accuracy_results_companyId_family_windowStart_idx" ON "fc_model_accuracy_results"("companyId", "family", "windowStart");

-- CreateIndex
CREATE INDEX "fc_data_quality_issues_companyId_severity_resolved_idx" ON "fc_data_quality_issues"("companyId", "severity", "resolved");

-- CreateIndex
CREATE INDEX "fc_data_quality_issues_checkKey_idx" ON "fc_data_quality_issues"("checkKey");

-- CreateIndex
CREATE INDEX "fc_audit_events_companyId_entityType_createdAt_idx" ON "fc_audit_events"("companyId", "entityType", "createdAt");

-- AddForeignKey
ALTER TABLE "fc_venues" ADD CONSTRAINT "fc_venues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_import_jobs" ADD CONSTRAINT "fc_import_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_import_rows" ADD CONSTRAINT "fc_import_rows_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "fc_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_import_errors" ADD CONSTRAINT "fc_import_errors_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "fc_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_sales_order_lines" ADD CONSTRAINT "fc_sales_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "fc_sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_square_payout_entries" ADD CONSTRAINT "fc_square_payout_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "fc_square_payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_bank_balance_snapshots" ADD CONSTRAINT "fc_bank_balance_snapshots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_recurring_commitments" ADD CONSTRAINT "fc_recurring_commitments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_tax_obligations" ADD CONSTRAINT "fc_tax_obligations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_creditor_claims" ADD CONSTRAINT "fc_creditor_claims_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_creditor_proposals" ADD CONSTRAINT "fc_creditor_proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_creditor_payment_schedules" ADD CONSTRAINT "fc_creditor_payment_schedules_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "fc_creditor_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_assumptions" ADD CONSTRAINT "fc_assumptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_overrides" ADD CONSTRAINT "fc_overrides_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_scenarios" ADD CONSTRAINT "fc_scenarios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_forecast_runs" ADD CONSTRAINT "fc_forecast_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_forecast_runs" ADD CONSTRAINT "fc_forecast_runs_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "fc_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_forecast_points" ADD CONSTRAINT "fc_forecast_points_runId_fkey" FOREIGN KEY ("runId") REFERENCES "fc_forecast_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_model_accuracy_results" ADD CONSTRAINT "fc_model_accuracy_results_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "fc_model_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_data_quality_issues" ADD CONSTRAINT "fc_data_quality_issues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fc_audit_events" ADD CONSTRAINT "fc_audit_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "fc_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

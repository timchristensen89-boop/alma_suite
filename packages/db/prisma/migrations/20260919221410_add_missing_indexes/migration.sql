-- Indexes for the columns the compliance, incident and stock list queries
-- filter on and the child rows their includes load by parent id. Postgres
-- does not index a foreign-key column on its own, so every Issue detail read
-- was scanning IssueActivity and IssueEvidence in full, every checklist run
-- list was scanning ChecklistItem, and deleting a parent row walked the whole
-- child table for the FK check. Only CREATE INDEX statements here: the
-- schema/migration drift Prisma also reported (dropped tables, defaults) is
-- deliberately left out of this migration.

-- CreateIndex
CREATE INDEX "AuditFinding_auditRunId_idx" ON "AuditFinding"("auditRunId");
-- CreateIndex
CREATE INDEX "AuditFinding_linkedIssueId_idx" ON "AuditFinding"("linkedIssueId");
-- CreateIndex
CREATE INDEX "AuditRun_templateId_idx" ON "AuditRun"("templateId");
-- CreateIndex
CREATE INDEX "AuditRun_runDate_idx" ON "AuditRun"("runDate");
-- CreateIndex
CREATE INDEX "AuditTemplateSection_templateId_idx" ON "AuditTemplateSection"("templateId");
-- CreateIndex
CREATE INDEX "ChecklistItem_runId_idx" ON "ChecklistItem"("runId");
-- CreateIndex
CREATE INDEX "ChecklistItem_linkedIssueId_idx" ON "ChecklistItem"("linkedIssueId");
-- CreateIndex
CREATE INDEX "ChecklistItemTemplate_templateId_idx" ON "ChecklistItemTemplate"("templateId");
-- CreateIndex
CREATE INDEX "ChecklistRun_templateId_idx" ON "ChecklistRun"("templateId");
-- CreateIndex
CREATE INDEX "ChecklistRun_runDate_idx" ON "ChecklistRun"("runDate");
-- CreateIndex
CREATE INDEX "ChecklistRun_status_runDate_idx" ON "ChecklistRun"("status", "runDate");
-- CreateIndex
CREATE INDEX "CommsAlertEvent_ruleId_idx" ON "CommsAlertEvent"("ruleId");
-- CreateIndex
CREATE INDEX "CommsAlertEvent_threadId_idx" ON "CommsAlertEvent"("threadId");
-- CreateIndex
CREATE INDEX "IncidentPerson_incidentReportId_idx" ON "IncidentPerson"("incidentReportId");
-- CreateIndex
CREATE INDEX "IncidentReport_linkedIssueId_idx" ON "IncidentReport"("linkedIssueId");
-- CreateIndex
CREATE INDEX "IntegrationWebhookEvent_connectionId_idx" ON "IntegrationWebhookEvent"("connectionId");
-- CreateIndex
CREATE INDEX "Issue_status_idx" ON "Issue"("status");
-- CreateIndex
CREATE INDEX "Issue_createdAt_idx" ON "Issue"("createdAt");
-- CreateIndex
CREATE INDEX "Issue_dueDate_idx" ON "Issue"("dueDate");
-- CreateIndex
CREATE INDEX "IssueActivity_issueId_createdAt_idx" ON "IssueActivity"("issueId", "createdAt");
-- CreateIndex
CREATE INDEX "IssueEvidence_issueId_idx" ON "IssueEvidence"("issueId");
-- CreateIndex
CREATE INDEX "PurchaseOrder_matchedInvoiceId_idx" ON "PurchaseOrder"("matchedInvoiceId");
-- CreateIndex
CREATE INDEX "ReserveEnquiry_guestId_idx" ON "ReserveEnquiry"("guestId");
-- CreateIndex
CREATE INDEX "RosterShift_offeredByStaffProfileId_idx" ON "RosterShift"("offeredByStaffProfileId");
-- CreateIndex
CREATE INDEX "SupplierInvoice_triagedByStaffProfileId_idx" ON "SupplierInvoice"("triagedByStaffProfileId");
-- CreateIndex
CREATE INDEX "TemperatureSensor_assetId_idx" ON "TemperatureSensor"("assetId");
-- CreateIndex
CREATE INDEX "stock_item_aliases_supplierId_idx" ON "stock_item_aliases"("supplierId");

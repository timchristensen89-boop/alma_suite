import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  StockCategory,
  StockInvoiceAssignee,
  StockInvoiceAssigneesPayload,
  StockInvoiceImportResult,
  StockInvoiceRipResult,
  StockInvoiceTriageStatus,
  StockInvoicesPayload,
  StockInvoicesSummary,
  StockItem,
  StockItemsPayload,
  StockSupplierInvoice,
  StockSupplierInvoiceLine
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { IconInvoices } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

type FeedbackTone = 'success' | 'error' | 'info';

type CreateItemFields = {
  name: string;
  unit: string;
  cost: string;
  categoryId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatCurrency(cents: number | null | undefined, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format((cents ?? 0) / 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(value));
}

function itemLabel(item: StockItem) {
  const unit = item.countUnit ?? item.unit;
  return `${item.name} (${unit})${item.sku ? ` - ${item.sku}` : ''}`;
}

function extractJsonInvoices(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  const invoices = value.Invoices ?? value.invoices;
  if (Array.isArray(invoices)) return invoices.filter(isRecord);
  return [value];
}

function mergeInvoices(
  current: StockInvoicesPayload | null,
  imported: StockSupplierInvoice[]
): StockInvoicesPayload {
  const existing = current?.invoices ?? [];
  const byId = new Map(existing.map((invoice) => [invoice.id, invoice]));
  for (const invoice of imported) byId.set(invoice.id, invoice);
  const invoices = Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a.invoiceDate ?? a.importedAt).getTime();
    const bTime = new Date(b.invoiceDate ?? b.importedAt).getTime();
    return bTime - aTime;
  });
  return { invoices };
}

function replaceLine(
  invoice: StockSupplierInvoice,
  nextLine: StockSupplierInvoiceLine
): StockSupplierInvoice {
  const lines = (invoice.lines ?? []).map((line) =>
    line.id === nextLine.id ? nextLine : line
  );
  return {
    ...invoice,
    lines,
    matchedLineCount: lines.filter((line) => line.itemId).length,
    needsReviewLineCount: lines.filter((line) => line.matchingStatus === 'NEEDS_REVIEW').length,
    lineCount: lines.length
  };
}

function assigneeName(assignee: StockInvoiceAssignee | null | undefined) {
  if (!assignee) return null;
  const name = `${assignee.firstName} ${assignee.lastName}`.trim();
  return name || assignee.email || 'Unnamed';
}

const TRIAGE_LABEL: Record<StockInvoiceTriageStatus, string> = {
  PENDING: 'Awaiting triage',
  NEEDS_REVIEW: 'Needs review',
  NO_ITEM: 'No item'
};

function triageBadgeTone(status: StockInvoiceTriageStatus): 'positive' | 'warning' | 'neutral' {
  if (status === 'NEEDS_REVIEW') return 'warning';
  if (status === 'NO_ITEM') return 'neutral';
  return 'neutral';
}

export function InvoicesPage() {
  useDocumentTitle('Invoices');
  const { user } = useAuth();
  const canManage = canManageStock(user);
  const [payload, setPayload] = useState<StockInvoicesPayload | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [summary, setSummary] = useState<StockInvoicesSummary | null>(null);
  const [assignees, setAssignees] = useState<StockInvoiceAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyingRules, setApplyingRules] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [venue, setVenue] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('success');
  const [lineDrafts, setLineDrafts] = useState<Record<string, string>>({});
  const [assigneeDraft, setAssigneeDraft] = useState<string>('');
  const [includeNoItem, setIncludeNoItem] = useState(false);
  const [creatingLineId, setCreatingLineId] = useState<string | null>(null);

  async function loadInvoices(options?: { showNoItem?: boolean }) {
    const showNoItem = options?.showNoItem ?? includeNoItem;
    try {
      const [invoicePayload, itemPayload, invoiceSummary, assigneePayload] = await Promise.all([
        api<StockInvoicesPayload>(`/api/invoices${showNoItem ? '?includeNoItem=1' : ''}`),
        api<StockItemsPayload>('/api/items'),
        api<StockInvoicesSummary>('/api/invoices/summary'),
        api<StockInvoiceAssigneesPayload>('/api/invoices/assignees')
      ]);
      setPayload(invoicePayload);
      setItems(itemPayload.items.filter((item) => item.status === 'ACTIVE'));
      setCategories(itemPayload.categories ?? []);
      setSummary(invoiceSummary);
      setAssignees(assigneePayload.assignees);
      setError(null);
      setSelectedInvoiceId((current) => {
        if (current && invoicePayload.invoices.some((invoice) => invoice.id === current)) {
          return current;
        }
        return invoicePayload.invoices[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load invoices');
    } finally {
      setLoading(false);
    }
  }

  async function applyExclusionRules() {
    setApplyingRules(true);
    setError(null);
    try {
      const result = await api<{ excluded: number; rules: number; sample: string[] }>(
        '/api/invoices/exclusion-rules/apply',
        { method: 'POST' }
      );
      await loadInvoices({ showNoItem: includeNoItem });
      showFeedback(
        'apply-rules',
        result.rules === 0
          ? 'No enabled exclusion rules to apply.'
          : `${result.excluded} waiting invoice${result.excluded === 1 ? '' : 's'} removed by ${result.rules} rule${result.rules === 1 ? '' : 's'}.`,
        result.excluded > 0 ? 'success' : 'info'
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply exclusion rules');
    } finally {
      setApplyingRules(false);
    }
  }

  useEffect(() => {
    void loadInvoices({ showNoItem: includeNoItem });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeNoItem]);

  const selectedInvoice = useMemo(
    () => payload?.invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [payload, selectedInvoiceId]
  );

  const assigneeOptions = useMemo(
    () => [
      { label: 'Pick a manager...', value: '' },
      ...assignees.map((assignee) => ({
        label: `${assignee.firstName} ${assignee.lastName}${assignee.roleTitle ? ` - ${assignee.roleTitle}` : ''}`,
        value: assignee.id
      }))
    ],
    [assignees]
  );

  useEffect(() => {
    setAssigneeDraft(selectedInvoice?.assignedTo?.id ?? '');
  }, [selectedInvoice?.id, selectedInvoice?.assignedTo?.id]);

  const invoiceStats = useMemo(() => {
    const invoices = payload?.invoices ?? [];
    return {
      total: summary?.totalInvoices ?? invoices.length,
      pendingTriage:
        summary?.pendingTriageInvoices ??
        invoices.filter((invoice) => invoice.triageStatus === 'PENDING').length,
      needsReview:
        summary?.needsReviewTriageInvoices ??
        invoices.filter((invoice) => invoice.triageStatus === 'NEEDS_REVIEW').length,
      matched:
        summary?.matchedLines ??
        invoices.reduce((total, invoice) => total + invoice.matchedLineCount, 0),
      week: summary?.importedThisWeek ?? 0
    };
  }, [payload, summary]);

  function showFeedback(target: string, message: string, tone: FeedbackTone = 'success') {
    setFeedbackTarget(target);
    setFeedbackMessage(message);
    setFeedbackTone(tone);
  }

  function updateLineDraft(lineId: string, itemId: string) {
    setLineDrafts((current) => ({ ...current, [lineId]: itemId }));
  }

  function applyRematchedLine(updated: StockSupplierInvoiceLine) {
    setPayload((current) => {
      if (!current) return current;
      return {
        invoices: current.invoices.map((invoice) =>
          invoice.id === updated.supplierInvoiceId ? replaceLine(invoice, updated) : invoice
        )
      };
    });
  }

  async function importPaste() {
    const text = pasteText.trim();
    const target = 'invoice-import';
    if (!canManage) {
      showFeedback(target, 'Manager access is required to import invoices.', 'error');
      return;
    }
    if (!text) {
      showFeedback(target, 'Paste Xero invoice JSON or invoice text first.', 'error');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: 'Import supplier invoices?',
      message:
        'This creates or updates supplier invoices and may create missing supplier records. It does not change stock balances.',
      confirmationText: 'IMPORT INVOICES'
    });
    if (!confirmed) return;

    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      let invoices: Record<string, unknown>[];
      let source = 'XERO';
      let ripWarnings: string[] = [];

      try {
        invoices = extractJsonInvoices(JSON.parse(text));
      } catch {
        const ripped = await api<StockInvoiceRipResult>('/api/invoices/rip', {
          method: 'POST',
          body: JSON.stringify({ text, venue, sourceFileName })
        });
        invoices = ripped.invoices;
        ripWarnings = ripped.warnings;
        source = 'RIPPED';
      }

      if (invoices.length === 0) {
        throw new Error('No invoices were found in that payload.');
      }

      const result = await api<StockInvoiceImportResult>('/api/invoices/import', {
        method: 'POST',
        body: JSON.stringify({
          source,
          venue,
          sourceFileName: sourceFileName || (source === 'XERO' ? 'Xero invoice paste' : 'Ripped invoice text'),
          sourceFileType: source === 'XERO' ? 'application/json' : 'text/plain',
          sourceMetadata: { ripWarnings },
          confirmationText: 'IMPORT INVOICES',
          invoices
        })
      });

      setPayload((current) => mergeInvoices(current, result.invoices));
      setSelectedInvoiceId(result.invoices[0]?.id ?? selectedInvoiceId);
      setSummary((current) =>
        current
          ? {
              ...current,
              totalInvoices: current.totalInvoices + result.createdCount,
              needsReviewLines: current.needsReviewLines + result.needsReviewLineCount,
              matchedLines: current.matchedLines + result.matchedLineCount,
              importedThisWeek: current.importedThisWeek + result.createdCount
            }
          : current
      );
      setPasteText('');
      const warningText = result.needsReviewLineCount
        ? ` ${result.needsReviewLineCount} line${result.needsReviewLineCount === 1 ? '' : 's'} need review.`
        : '';
      const skippedText = result.skippedCount
        ? ` ${result.skippedCount} document${result.skippedCount === 1 ? '' : 's'} skipped by exclusion rules.`
        : '';
      showFeedback(
        target,
        `Imported ${result.importedCount} invoice${result.importedCount === 1 ? '' : 's'} with ${result.matchedLineCount} matched line${result.matchedLineCount === 1 ? '' : 's'}.${warningText}${skippedText}`,
        result.needsReviewLineCount ? 'info' : 'success'
      );
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError || err instanceof Error ? err.message : 'Could not import invoices',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  async function saveLineMatch(line: StockSupplierInvoiceLine) {
    const target = `match:${line.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to save invoice matches.', 'error');
      return;
    }
    const itemId = lineDrafts[line.id] ?? line.itemId ?? '';
    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      const updated = await api<StockSupplierInvoiceLine>(`/api/invoices/lines/${line.id}/rematch`, {
        method: 'POST',
        body: JSON.stringify({ itemId })
      });
      applyRematchedLine(updated);
      setLineDrafts((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      showFeedback(target, updated.itemId ? 'Match saved.' : 'Line marked for review.');
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not save match',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  function applyInvoiceUpdate(updated: StockSupplierInvoice) {
    setPayload((current) => {
      const existing = current?.invoices ?? [];
      const exists = existing.some((invoice) => invoice.id === updated.id);
      const visible = includeNoItem || updated.triageStatus !== 'NO_ITEM';
      const next = visible
        ? exists
          ? existing.map((invoice) => (invoice.id === updated.id ? updated : invoice))
          : [updated, ...existing]
        : existing.filter((invoice) => invoice.id !== updated.id);
      return { invoices: next };
    });
    if (!includeNoItem && updated.triageStatus === 'NO_ITEM' && selectedInvoiceId === updated.id) {
      setSelectedInvoiceId(null);
    }
  }

  async function markNoItem(invoice: StockSupplierInvoice) {
    const target = `triage:${invoice.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to triage invoices.', 'error');
      return;
    }
    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      const updated = await api<StockSupplierInvoice>(
        `/api/invoices/${invoice.id}/mark-no-item`,
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      );
      applyInvoiceUpdate(updated);
      void refreshSummary();
      showFeedback(target, 'Marked as no item. Hidden from the workstation.');
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not mark as no item',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  async function markNeedsReview(invoice: StockSupplierInvoice, assigneeStaffProfileId: string) {
    const target = `triage:${invoice.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to assign invoices.', 'error');
      return;
    }
    if (!assigneeStaffProfileId) {
      showFeedback(target, 'Pick a manager to review this invoice.', 'error');
      return;
    }
    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      const updated = await api<StockSupplierInvoice>(
        `/api/invoices/${invoice.id}/mark-needs-review`,
        {
          method: 'POST',
          body: JSON.stringify({ assigneeStaffProfileId })
        }
      );
      applyInvoiceUpdate(updated);
      void refreshSummary();
      showFeedback(
        target,
        `Assigned to ${assigneeName(updated.assignedTo) ?? 'manager'} for review.`
      );
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not assign for review',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  async function resetTriage(invoice: StockSupplierInvoice) {
    const target = `triage:${invoice.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to reset triage.', 'error');
      return;
    }
    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      const updated = await api<StockSupplierInvoice>(
        `/api/invoices/${invoice.id}/reset-triage`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      applyInvoiceUpdate(updated);
      void refreshSummary();
      showFeedback(target, 'Triage decision cleared.');
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not reset triage',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  async function deleteInvoice(invoice: StockSupplierInvoice) {
    const target = `triage:${invoice.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to delete invoices.', 'error');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: `Delete invoice ${invoice.invoiceNumber ?? ''}?`.trim(),
      message:
        'This permanently removes the supplier invoice and its lines from the workstation. Only allowed for invoices marked "no item".',
      confirmationText: 'DELETE INVOICE'
    });
    if (!confirmed) return;

    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      await api<{ id: string }>(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmationText: 'DELETE INVOICE' })
      });
      setPayload((current) => {
        if (!current) return current;
        return { invoices: current.invoices.filter((row) => row.id !== invoice.id) };
      });
      if (selectedInvoiceId === invoice.id) setSelectedInvoiceId(null);
      void refreshSummary();
      showFeedback(target, 'Invoice deleted.');
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not delete invoice',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  async function refreshSummary() {
    try {
      const next = await api<StockInvoicesSummary>('/api/invoices/summary');
      setSummary(next);
    } catch {
      // Stat refresh is best-effort.
    }
  }

  async function applyCost(line: StockSupplierInvoiceLine) {
    const target = `cost:${line.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to apply invoice costs.', 'error');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: 'Apply supplier invoice cost?',
      message:
        'This updates the matched stock item average cost from this invoice line. It does not change on-hand balances.',
      confirmationText: 'APPLY COST'
    });
    if (!confirmed) return;

    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      const updated = await api<StockSupplierInvoiceLine>(`/api/invoices/lines/${line.id}/apply-cost`, {
        method: 'POST',
        body: JSON.stringify({ confirmationText: 'APPLY COST' })
      });
      setPayload((current) => {
        if (!current) return current;
        return {
          invoices: current.invoices.map((invoice) =>
            invoice.id === updated.supplierInvoiceId ? replaceLine(invoice, updated) : invoice
          )
        };
      });
      setItems((current) =>
        current.map((item) =>
          updated.itemId && item.id === updated.itemId
            ? {
                ...item,
                avgCostCents: updated.item?.avgCostCents ?? item.avgCostCents,
                latestCostCents: updated.item?.latestCostCents ?? updated.unitAmountCents,
                latestCostAt: updated.item?.latestCostAt ?? new Date().toISOString()
              }
            : item
        )
      );
      showFeedback(target, 'Cost updated.');
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not apply cost',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  function startCreateFromLine(lineId: string) {
    setCreatingLineId(lineId);
  }

  function cancelCreateFromLine() {
    setCreatingLineId(null);
  }

  async function createItemFromLine(line: StockSupplierInvoiceLine, fields: CreateItemFields) {
    const target = `match:${line.id}`;
    if (!canManage) {
      showFeedback(target, 'Manager access is required to create stock items.', 'error');
      return;
    }
    const name = fields.name.trim();
    const unit = fields.unit.trim();
    const costDollars = Number(fields.cost);
    if (name.length < 2) {
      showFeedback(target, 'Item name must be at least 2 characters.', 'error');
      return;
    }
    if (!unit) {
      showFeedback(target, 'Unit is required.', 'error');
      return;
    }
    if (!Number.isFinite(costDollars) || costDollars < 0) {
      showFeedback(target, 'Cost must be a number of zero or more.', 'error');
      return;
    }

    setBusyTarget(target);
    setFeedbackTarget(target);
    setFeedbackMessage(null);
    try {
      const created = await api<StockItem>('/api/items', {
        method: 'POST',
        body: JSON.stringify({
          name,
          unit,
          avgCostCents: Math.round(costDollars * 100),
          categoryId: fields.categoryId || undefined
        })
      });
      setItems((current) =>
        [created, ...current.filter((item) => item.id !== created.id)].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      updateLineDraft(line.id, created.id);

      const updated = await api<StockSupplierInvoiceLine>(`/api/invoices/lines/${line.id}/rematch`, {
        method: 'POST',
        body: JSON.stringify({ itemId: created.id })
      });
      applyRematchedLine(updated);
      setLineDrafts((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      setCreatingLineId(null);
      showFeedback(target, 'Item created and matched.');
    } catch (err) {
      showFeedback(
        target,
        err instanceof ApiError ? err.message : 'Could not create item',
        'error'
      );
    } finally {
      setBusyTarget(null);
    }
  }

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard
          icon={<IconInvoices size={18} />}
          label="Invoices"
          value={loading ? '-' : String(invoiceStats.total)}
          hint="Imported supplier bills"
        />
        <StatCard
          label="Awaiting triage"
          value={loading ? '-' : String(invoiceStats.pendingTriage)}
          hint="Mark each as needs review or no item"
          tone={invoiceStats.pendingTriage > 0 ? 'warning' : 'positive'}
        />
        <StatCard
          label="Needs review"
          value={loading ? '-' : String(invoiceStats.needsReview)}
          hint="Assigned to a manager"
          tone={invoiceStats.needsReview > 0 ? 'warning' : 'positive'}
        />
        <StatCard
          label="This week"
          value={loading ? '-' : String(invoiceStats.week)}
          hint="Fresh invoice imports"
        />
      </div>

      <Card
        title="Invoice ripper"
        subtitle="Paste Xero invoice JSON, or plain invoice text, then review item matches before costs are applied."
      >
        <div className="stock-invoice-import-grid">
          <Textarea
            label="Invoice payload"
            rows={10}
            value={pasteText}
            onChange={(event) => setPasteText(event.currentTarget.value)}
            placeholder="Paste Xero Invoices JSON or copied invoice text..."
          />
          <div className="stock-invoice-import-side">
            <Select
              label="Venue"
              value={venue}
              onChange={(event) => setVenue(event.currentTarget.value)}
              options={[
                { label: 'No venue set', value: '' },
                { label: 'Alma Avalon', value: 'Alma Avalon' },
                { label: 'St Alma', value: 'St Alma' }
              ]}
            />
            <Input
              label="Source name"
              value={sourceFileName}
              onChange={(event) => setSourceFileName(event.currentTarget.value)}
              placeholder="Xero export, PDF name, supplier email..."
            />
            <div className="stock-invoice-import-action">
              <Button
                type="button"
                onClick={() => void importPaste()}
                disabled={busyTarget === 'invoice-import' || !canManage}
                title={canManage ? undefined : 'Manager access required'}
              >
                {busyTarget === 'invoice-import'
                  ? 'Importing...'
                  : canManage
                    ? 'Rip / import'
                    : 'Manager required'}
              </Button>
              <ActionFeedback
                message={feedbackTarget === 'invoice-import' ? feedbackMessage : null}
                tone={feedbackTone}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="stock-invoice-layout">
        <Card
          title="Imported invoices"
          subtitle="Xero bills and ripped supplier invoices."
          action={
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {canManage ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={applyingRules}
                  title="Remove any waiting invoices that match your exclusion rules (e.g. Square fees from the Xero sync)"
                  onClick={() => void applyExclusionRules()}
                >
                  {applyingRules ? 'Applying…' : 'Apply exclusion rules'}
                </Button>
              ) : null}
              <label className="stock-invoice-filter-toggle">
                <input
                  type="checkbox"
                  checked={includeNoItem}
                  onChange={(event) => setIncludeNoItem(event.currentTarget.checked)}
                />
                Show no-item invoices
              </label>
            </div>
          }
        >
          {loading ? (
            <Spinner label="Loading invoices" />
          ) : error ? (
            <EmptyState
              icon={<IconInvoices size={24} />}
              title="Invoices unavailable"
              description={error}
            />
          ) : payload && payload.invoices.length > 0 ? (
            <div className="table-card stock-invoice-table">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Supplier</th>
                    <th>Date</th>
                    <th>Total</th>
                    <th>Triage</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.invoices.map((invoice) => {
                    const assignee = assigneeName(invoice.assignedTo);
                    return (
                      <tr
                        key={invoice.id}
                        className={`row-interactive ${invoice.id === selectedInvoiceId ? 'stock-selected-row' : ''}`}
                        onClick={() => setSelectedInvoiceId(invoice.id)}
                      >
                        <td>
                          <span className="cell-stack">
                            <strong>{invoice.invoiceNumber ?? invoice.invoiceKey.slice(0, 8)}</strong>
                            <span className="subtle">{invoice.sourceFileName ?? invoice.source}</span>
                          </span>
                        </td>
                        <td>{invoice.supplierName}</td>
                        <td>{formatDate(invoice.invoiceDate)}</td>
                        <td>{formatCurrency(invoice.totalCents, invoice.currencyCode)}</td>
                        <td>
                          <span className="cell-stack">
                            <Badge tone={triageBadgeTone(invoice.triageStatus)} dot>
                              {TRIAGE_LABEL[invoice.triageStatus]}
                            </Badge>
                            {assignee ? (
                              <span className="subtle">Assigned: {assignee}</span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<IconInvoices size={24} />}
              title={includeNoItem ? 'No invoices found' : 'No active invoices'}
              description={
                includeNoItem
                  ? 'Paste a Xero export or invoice text to start matching supplier bills to stock items.'
                  : 'Everything imported has been triaged as "no item". Toggle "Show no-item invoices" to see them.'
              }
            />
          )}
        </Card>

        <Card
          title={selectedInvoice ? selectedInvoice.invoiceNumber ?? 'Invoice lines' : 'Invoice lines'}
          subtitle={
            selectedInvoice
              ? `${selectedInvoice.supplierName} - ${formatCurrency(selectedInvoice.totalCents, selectedInvoice.currencyCode)}`
              : 'Choose an invoice to review line mappings.'
          }
        >
          {selectedInvoice ? (
            <>
              <InvoiceTriagePanel
                invoice={selectedInvoice}
                assigneeOptions={assigneeOptions}
                assigneeDraft={assigneeDraft}
                onAssigneeChange={setAssigneeDraft}
                onMarkNoItem={() => void markNoItem(selectedInvoice)}
                onMarkNeedsReview={() => void markNeedsReview(selectedInvoice, assigneeDraft)}
                onResetTriage={() => void resetTriage(selectedInvoice)}
                onDelete={() => void deleteInvoice(selectedInvoice)}
                feedbackTarget={feedbackTarget}
                feedbackMessage={feedbackMessage}
                feedbackTone={feedbackTone}
                busyTarget={busyTarget}
                canManage={canManage}
              />
              <InvoiceLineReview
                invoice={selectedInvoice}
                items={items}
                categories={categories}
                lineDrafts={lineDrafts}
                creatingLineId={creatingLineId}
                feedbackTarget={feedbackTarget}
                feedbackMessage={feedbackMessage}
                feedbackTone={feedbackTone}
                busyTarget={busyTarget}
                onDraftChange={updateLineDraft}
                onSaveMatch={saveLineMatch}
                onApplyCost={applyCost}
                onStartCreate={startCreateFromLine}
                onCancelCreate={cancelCreateFromLine}
                onSubmitCreate={createItemFromLine}
                canManage={canManage}
              />
            </>
          ) : (
            <EmptyState
              icon={<IconInvoices size={24} />}
              title="Nothing selected"
              description="Import or select an invoice to review its lines."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

type InvoiceTriagePanelProps = {
  invoice: StockSupplierInvoice;
  assigneeOptions: Array<{ label: string; value: string }>;
  assigneeDraft: string;
  onAssigneeChange: (next: string) => void;
  onMarkNoItem: () => void;
  onMarkNeedsReview: () => void;
  onResetTriage: () => void;
  onDelete: () => void;
  feedbackTarget: string | null;
  feedbackMessage: string | null;
  feedbackTone: FeedbackTone;
  busyTarget: string | null;
  canManage: boolean;
};

function InvoiceTriagePanel({
  invoice,
  assigneeOptions,
  assigneeDraft,
  onAssigneeChange,
  onMarkNoItem,
  onMarkNeedsReview,
  onResetTriage,
  onDelete,
  feedbackTarget,
  feedbackMessage,
  feedbackTone,
  busyTarget,
  canManage
}: InvoiceTriagePanelProps) {
  const target = `triage:${invoice.id}`;
  const busy = busyTarget === target;
  const assignee = assigneeName(invoice.assignedTo);
  const triagedBy = assigneeName(invoice.triagedBy);
  const showAssignee = invoice.triageStatus !== 'NO_ITEM';

  return (
    <section className="stock-invoice-triage">
      <div className="stock-invoice-triage__header">
        <div>
          <Badge tone={triageBadgeTone(invoice.triageStatus)} dot>
            {TRIAGE_LABEL[invoice.triageStatus]}
          </Badge>
          {showAssignee && assignee ? (
            <p className="subtle">Assigned to {assignee}</p>
          ) : null}
          {triagedBy ? (
            <p className="subtle">Triaged by {triagedBy}</p>
          ) : null}
        </div>
      </div>
      <div className="stock-invoice-triage__actions">
        {showAssignee ? (
          <Select
            label="Assign manager"
            value={assigneeDraft}
            onChange={(event) => onAssigneeChange(event.currentTarget.value)}
            options={assigneeOptions}
            disabled={!canManage}
          />
        ) : null}
        <div className="stock-invoice-triage__buttons">
          {invoice.triageStatus !== 'NEEDS_REVIEW' ? (
            <Button
              type="button"
              size="sm"
              onClick={onMarkNeedsReview}
              disabled={busy || !canManage || !assigneeDraft}
              title={
                !canManage
                  ? 'Manager access required'
                  : !assigneeDraft
                    ? 'Pick a manager first'
                    : undefined
              }
            >
              {busy ? 'Saving...' : 'Needs review'}
            </Button>
          ) : null}
          {invoice.triageStatus !== 'NO_ITEM' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onMarkNoItem}
              disabled={busy || !canManage}
              title={canManage ? undefined : 'Manager access required'}
            >
              {busy ? 'Saving...' : 'No item'}
            </Button>
          ) : null}
          {invoice.triageStatus !== 'PENDING' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onResetTriage}
              disabled={busy || !canManage}
            >
              Reset triage
            </Button>
          ) : null}
          {invoice.triageStatus === 'NO_ITEM' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={busy || !canManage}
              title={canManage ? undefined : 'Manager access required'}
            >
              Delete invoice
            </Button>
          ) : null}
        </div>
        <ActionFeedback
          message={feedbackTarget === target ? feedbackMessage : null}
          tone={feedbackTone}
        />
      </div>
    </section>
  );
}

type ItemSearchSelectProps = {
  items: StockItem[];
  value: string;
  onChange: (itemId: string) => void;
  onCreateNew: () => void;
  disabled?: boolean;
};

function ItemSearchSelect({ items, value, onChange, onCreateNew, disabled }: ItemSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === value) ?? null,
    [items, value]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? items.filter((item) => {
          const name = item.name.toLowerCase();
          const sku = (item.sku ?? '').toLowerCase();
          return name.includes(term) || sku.includes(term);
        })
      : items;
    return matches.slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function handleSelect(itemId: string) {
    onChange(itemId);
    close();
  }

  // When closed, show the matched item's label; when open, show what the user types.
  const inputValue = open ? query : selectedItem ? itemLabel(selectedItem) : '';

  return (
    <div className="item-search field" ref={containerRef}>
      <span className="field-label">Stock item</span>
      <input
        className="field-control item-search-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder={selectedItem ? undefined : 'Search stock items...'}
        value={inputValue}
        onFocus={() => {
          if (disabled) return;
          setQuery('');
          setOpen(true);
        }}
        onChange={(event) => {
          if (disabled) return;
          setQuery(event.currentTarget.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            close();
          }
        }}
      />
      {open ? (
        <ul className="item-search-panel" role="listbox">
          <li
            className="item-search-option is-action"
            role="option"
            aria-selected={value === ''}
            onMouseDown={(event) => {
              event.preventDefault();
              handleSelect('');
            }}
          >
            No item / needs review
          </li>
          {filtered.length > 0 ? (
            filtered.map((item) => (
              <li
                key={item.id}
                className="item-search-option"
                role="option"
                aria-selected={item.id === value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(item.id);
                }}
              >
                {itemLabel(item)}
              </li>
            ))
          ) : (
            <li className="item-search-empty" role="presentation">
              No matching items
            </li>
          )}
          <li
            className="item-search-option is-action"
            role="option"
            aria-selected={false}
            onMouseDown={(event) => {
              event.preventDefault();
              onCreateNew();
              close();
            }}
          >
            + Create new item from this line
          </li>
        </ul>
      ) : null}
    </div>
  );
}

type CreateItemFormProps = {
  line: StockSupplierInvoiceLine;
  categories: StockCategory[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fields: CreateItemFields) => void;
};

function CreateItemForm({ line, categories, busy, onCancel, onSubmit }: CreateItemFormProps) {
  const [name, setName] = useState(line.description);
  const [unit, setUnit] = useState(line.unit ?? '');
  const [cost, setCost] = useState(String((line.unitAmountCents ?? 0) / 100));
  const [categoryId, setCategoryId] = useState('');

  const categoryOptions = useMemo(
    () => [
      { label: 'Uncategorised', value: '' },
      ...categories.map((category) => ({ label: category.name, value: category.id }))
    ],
    [categories]
  );

  return (
    <div className="invoice-create-item-form">
      <p className="subtle">Create a new stock item from this line, match it, and set its average cost.</p>
      <div className="invoice-create-item-fields">
        <Input
          label="Item name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Input
          label="Unit"
          value={unit}
          onChange={(event) => setUnit(event.currentTarget.value)}
        />
        <Input
          label="Cost (each)"
          type="number"
          min="0"
          step="0.01"
          value={cost}
          onChange={(event) => setCost(event.currentTarget.value)}
        />
        <Select
          label="Category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.currentTarget.value)}
          options={categoryOptions}
        />
      </div>
      <div className="invoice-create-item-actions">
        <Button
          type="button"
          size="sm"
          onClick={() => onSubmit({ name, unit, cost, categoryId })}
          disabled={busy}
        >
          {busy ? 'Creating...' : 'Create & match'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type InvoiceLineReviewProps = {
  invoice: StockSupplierInvoice;
  items: StockItem[];
  categories: StockCategory[];
  lineDrafts: Record<string, string>;
  creatingLineId: string | null;
  feedbackTarget: string | null;
  feedbackMessage: string | null;
  feedbackTone: FeedbackTone;
  busyTarget: string | null;
  onDraftChange: (lineId: string, itemId: string) => void;
  onSaveMatch: (line: StockSupplierInvoiceLine) => Promise<void>;
  onApplyCost: (line: StockSupplierInvoiceLine) => Promise<void>;
  onStartCreate: (lineId: string) => void;
  onCancelCreate: () => void;
  onSubmitCreate: (line: StockSupplierInvoiceLine, fields: CreateItemFields) => Promise<void>;
  canManage: boolean;
};

function InvoiceLineReview({
  invoice,
  items,
  categories,
  lineDrafts,
  creatingLineId,
  feedbackTarget,
  feedbackMessage,
  feedbackTone,
  busyTarget,
  onDraftChange,
  onSaveMatch,
  onApplyCost,
  onStartCreate,
  onCancelCreate,
  onSubmitCreate,
  canManage
}: InvoiceLineReviewProps) {
  const lines = invoice.lines ?? [];
  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<IconInvoices size={24} />}
        title="No lines found"
        description="This invoice header imported, but no line items were parsed."
      />
    );
  }

  return (
    <div className="stock-invoice-lines">
      {lines.map((line) => {
        const matchTarget = `match:${line.id}`;
        const costTarget = `cost:${line.id}`;
        const draftValue = lineDrafts[line.id] ?? line.itemId ?? '';
        const costDisabled = !line.itemId || line.unitAmountCents <= 0;

        return (
          <section key={line.id} className="stock-invoice-line-card">
            <div className="stock-invoice-line-main">
              <div>
                <strong>{line.description}</strong>
                <p className="subtle">
                  Qty {line.quantity} {line.unit ?? ''} - unit {formatCurrency(line.unitAmountCents, invoice.currencyCode)} - line {formatCurrency(line.lineAmountCents, invoice.currencyCode)}
                </p>
              </div>
              <Badge tone={line.matchingStatus === 'NEEDS_REVIEW' ? 'warning' : 'positive'} dot>
                {line.matchingStatus === 'NEEDS_REVIEW' ? 'Needs review' : 'Matched'}
              </Badge>
            </div>
            <div className="stock-invoice-line-actions">
              <ItemSearchSelect
                items={items}
                value={draftValue}
                onChange={(itemId) => onDraftChange(line.id, itemId)}
                onCreateNew={() => onStartCreate(line.id)}
                disabled={!canManage}
              />
              <div className="stock-invoice-button-stack">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onSaveMatch(line)}
                  disabled={busyTarget === matchTarget || !canManage}
                  title={canManage ? undefined : 'Manager access required'}
                >
                  {busyTarget === matchTarget
                    ? 'Saving...'
                    : canManage
                      ? 'Save match'
                      : 'Manager required'}
                </Button>
                <ActionFeedback
                  message={feedbackTarget === matchTarget ? feedbackMessage : null}
                  tone={feedbackTone}
                />
              </div>
              <div className="stock-invoice-button-stack">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void onApplyCost(line)}
                  disabled={busyTarget === costTarget || costDisabled || !canManage}
                  title={
                    !canManage
                      ? 'Manager access required'
                      : costDisabled
                        ? 'Match a stock item with a positive unit cost first'
                        : undefined
                  }
                >
                  {busyTarget === costTarget
                    ? 'Updating...'
                    : canManage
                      ? 'Apply cost'
                      : 'Manager required'}
                </Button>
                <ActionFeedback
                  message={feedbackTarget === costTarget ? feedbackMessage : null}
                  tone={feedbackTone}
                />
              </div>
            </div>
            {canManage && creatingLineId === line.id ? (
              <CreateItemForm
                line={line}
                categories={categories}
                busy={busyTarget === matchTarget}
                onCancel={onCancelCreate}
                onSubmit={(fields) => onSubmitCreate(line, fields)}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

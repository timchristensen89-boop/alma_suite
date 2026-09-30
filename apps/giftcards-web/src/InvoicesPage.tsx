import { Fragment, type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import {
  DOCUMENT_PREFIX_PATTERN,
  FINANCIAL_DOCUMENT_TYPES,
  GST_TREATMENT_LABELS,
  formatAbn,
  isCreditDocument,
  isValidAbn,
  normaliseAbn,
  type CreditNoteInput,
  type FinancialDocumentDetail,
  type FinancialDocumentIssueSource,
  type FinancialDocumentListResponse,
  type FinancialDocumentSummary,
  type FinancialDocumentType,
  type InvoiceSettings,
  type InvoiceSettingsResponse,
  type LegalEntity,
  type PaymentProvider
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { ApiError, api } from './lib/api';
import { openDocumentPdf } from './lib/openPdf';

/**
 * Invoices & receipts.
 *
 * Stripe (or the till) is the record that a payment happened. The documents
 * here are the accounting record of it: which company sold what, and how much
 * of it carried GST. They are issued once and never edited — a mistake is put
 * right with a credit note, or by voiding the document and issuing again.
 *
 * Every manager who can open the page sees the register and can send a PDF
 * again. The companies, the issuing settings, credit notes and voids are
 * Tim's: the API refuses anyone else, and this page keeps those controls out
 * of their way rather than letting them walk into a 403.
 */

/* ------------------------------------------------------------------ */
/* Shared with GiftCardDocumentControls                                */
/* ------------------------------------------------------------------ */

const moneyFormat = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

/** Always two decimals: a document total reads $100.00, never $100. */
export function money(cents: number) {
  return moneyFormat.format(cents / 100);
}

/** Documents are dated in Sydney, whatever timezone the browser is in. */
export function documentDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Sydney'
  });
}

function documentDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Sydney'
  });
}

export const DOCUMENT_TYPE_LABELS: Record<FinancialDocumentType, string> = {
  TAX_INVOICE: 'Tax invoice',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit note',
  ADJUSTMENT_NOTE: 'Adjustment note'
};

const DOCUMENT_TYPE_TONES: Record<FinancialDocumentType, 'info' | 'neutral' | 'warning'> = {
  TAX_INVOICE: 'info',
  RECEIPT: 'neutral',
  CREDIT_NOTE: 'warning',
  ADJUSTMENT_NOTE: 'warning'
};

const PAYMENT_LABELS: Record<PaymentProvider, string> = {
  STRIPE: 'Stripe',
  CARD: 'Card (at the counter)',
  CASH: 'Cash',
  EFTPOS: 'EFTPOS',
  GIFTUP: 'GiftUp',
  OTHER: 'Other'
};

const ISSUE_SOURCE_LABELS: Record<FinancialDocumentIssueSource, string> = {
  AUTO_STRIPE: 'automatically when Stripe confirmed payment',
  MANUAL: 'by hand',
  STRIPE_REFUND: 'automatically from a refund in Stripe',
  CATCH_UP: 'by the catch-up job'
};

type RefundMethod = CreditNoteInput['refundMethod'];

const REFUND_METHODS: Array<{ value: RefundMethod; label: string }> = [
  { value: 'STRIPE', label: 'Refunded in Stripe' },
  { value: 'CARD', label: 'Card (at the counter)' },
  { value: 'CASH', label: 'Cash' },
  { value: 'EFTPOS', label: 'EFTPOS' },
  { value: 'OTHER', label: 'Other' }
];

/** Credit notes are stored positive (the type says the money went back); lists show them as minus. */
export function signedTotalCents(doc: Pick<FinancialDocumentSummary, 'type' | 'totalCents'>) {
  return isCreditDocument(doc.type) ? -doc.totalCents : doc.totalCents;
}

/** Plain-English ABN check for under an ABN field. Blank is not a problem here. */
export function abnProblem(raw: string): string | null {
  const digits = normaliseAbn(raw);
  if (!digits) return null;
  if (digits.length !== 11) return 'An ABN is 11 digits.';
  return isValidAbn(digits) ? null : 'That ABN fails the ABR checksum — check the digits.';
}

export function DocumentBadges({
  doc,
  showStatus = true
}: {
  doc: Pick<FinancialDocumentSummary, 'type' | 'status' | 'testMode'>;
  showStatus?: boolean;
}) {
  return (
    <>
      <Badge tone={DOCUMENT_TYPE_TONES[doc.type]}>{DOCUMENT_TYPE_LABELS[doc.type]}</Badge>
      {showStatus && doc.status === 'VOID' ? <Badge tone="danger">VOID</Badge> : null}
      {doc.testMode ? <Badge tone="warning">TEST</Badge> : null}
    </>
  );
}

export type DocumentAction = 'pdf' | 'email' | 'credit' | 'void';
export type DocumentFeedback = { tone: 'success' | 'error' | 'info'; text: string };

/**
 * Busy and result state, per document id. One shared "saving" flag would let
 * a slow email on one document grey out — or report into — another the
 * manager has since moved on to.
 */
export function useDocumentActions() {
  const [busy, setBusy] = useState<Record<string, DocumentAction | undefined>>({});
  const [feedback, setFeedback] = useState<Record<string, DocumentFeedback | undefined>>({});

  const run = useCallback(
    async (id: string, action: DocumentAction, work: () => Promise<DocumentFeedback | null>): Promise<boolean> => {
      setBusy((current) => ({ ...current, [id]: action }));
      setFeedback((current) => ({ ...current, [id]: undefined }));
      try {
        const result = await work();
        setFeedback((current) => ({ ...current, [id]: result ?? undefined }));
        return true;
      } catch (error) {
        const text = error instanceof Error ? error.message : 'That did not work. Try again.';
        setFeedback((current) => ({ ...current, [id]: { tone: 'error', text } }));
        return false;
      } finally {
        setBusy((current) => ({ ...current, [id]: undefined }));
      }
    },
    []
  );

  const clear = useCallback((id: string) => {
    setFeedback((current) => ({ ...current, [id]: undefined }));
  }, []);

  const viewPdf = useCallback(
    (doc: Pick<FinancialDocumentSummary, 'id' | 'number'>) =>
      run(doc.id, 'pdf', async () => {
        const outcome = await openDocumentPdf(doc);
        return outcome === 'downloaded'
          ? { tone: 'info', text: `The browser blocked a new tab, so ${doc.number}.pdf was downloaded instead.` }
          : null;
      }),
    [run]
  );

  const email = useCallback(
    (doc: Pick<FinancialDocumentSummary, 'id' | 'number'>, to: string, refresh: () => void) =>
      run(doc.id, 'email', async () => {
        try {
          const updated = await api<FinancialDocumentSummary>(`/api/invoices/${encodeURIComponent(doc.id)}/email`, {
            method: 'POST',
            body: JSON.stringify({ to })
          });
          return { tone: 'success', text: `${doc.number} emailed to ${updated.emailedTo ?? to}.` };
        } finally {
          // A failed send is recorded on the document too, so refresh either way.
          refresh();
        }
      }),
    [run]
  );

  return { busy, feedback, run, clear, viewPdf, email };
}

export function EmailDocumentForm({
  doc,
  sending,
  onSend,
  onCancel
}: {
  doc: Pick<FinancialDocumentSummary, 'number' | 'customerEmail'>;
  sending: boolean;
  onSend: (to: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [to, setTo] = useState(doc.customerEmail ?? '');
  const send = () => {
    if (to.trim() && !sending) onSend(to.trim());
  };

  return (
    <div className="giftcards-invoice-email">
      <Input
        id={`${id}-to`}
        label={`Email ${doc.number} to`}
        type="email"
        value={to}
        onChange={(event) => setTo(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter sends this — and must never submit a form the controls sit inside.
          if (event.key === 'Enter') {
            event.preventDefault();
            send();
          }
        }}
        placeholder="name@example.com"
      />
      <span className="giftcards-inline-actions">
        <Button type="button" size="sm" disabled={sending || !to.trim()} onClick={send}>
          {sending ? 'Sending…' : 'Send PDF'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

type LoadError = { status: number; message: string };

function loadError(error: unknown, fallback: string): LoadError {
  return {
    status: error instanceof ApiError ? error.status : 0,
    message: error instanceof Error ? error.message : fallback
  };
}

export function InvoicesPage({ isOwner }: { isOwner: boolean }) {
  const [setup, setSetup] = useState<InvoiceSettingsResponse | null>(null);
  const [setupError, setSetupError] = useState<LoadError | null>(null);

  const loadSetup = useCallback(async () => {
    try {
      setSetup(await api<InvoiceSettingsResponse>('/api/invoices/settings'));
      setSetupError(null);
    } catch (error) {
      setSetupError(loadError(error, 'Could not load invoice settings.'));
    }
  }, []);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  // The client check and the server's must agree, as on the promo codes
  // screen: a mismatch hides the controls rather than showing ones that 403.
  const canManage = isOwner && Boolean(setup?.canManage);

  if (setupError?.status === 403) {
    return (
      <Card title="Invoices" subtitle="Receipts, tax invoices and credit notes.">
        <p className="subtle">
          Receipts and tax invoices are looked after by the managers. If a guest needs one, give a manager their gift card
          code.
        </p>
      </Card>
    );
  }

  const ownerCards =
    canManage && setup ? (
      <>
        <CompaniesCard entities={setup.entities} issuerId={setup.settings.giftCardIssuingEntityId} onChanged={loadSetup} />
        <InvoiceSettingsCard setup={setup} onSaved={setSetup} />
      </>
    ) : null;

  return (
    <>
      {setupError ? <p className="error-text">{setupError.message}</p> : null}
      {setup?.setupIssue ? <SetupCard issue={setup.setupIssue} canManage={canManage} /> : null}
      {/* Unfinished setup is the job at hand, so its controls come first; once
          done they drop below the register, which is what the page is for. */}
      {setup?.setupIssue ? ownerCards : null}
      <DocumentRegister canManage={canManage} />
      {setup && !setup.setupIssue ? ownerCards : null}
    </>
  );
}

function SetupCard({ issue, canManage }: { issue: string; canManage: boolean }) {
  return (
    <Card title="Invoice setup isn't finished" subtitle="Nothing is issued — automatically or by hand — until it is.">
      <p className="giftcards-invoice-setup-issue">{issue}</p>
      {canManage ? (
        <ol className="giftcards-invoice-steps">
          <li>Add the company that sells the gift cards under Companies — its legal name and ABN go on every document.</li>
          <li>Choose it as the gift card issuing company under Settings.</li>
          <li>Switch on automatic issuing if every Stripe payment should get its receipt straight away.</li>
        </ol>
      ) : (
        <p className="subtle">Ask Tim to finish invoice setup.</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Companies (owner)                                                   */
/* ------------------------------------------------------------------ */

type EntityDraft = {
  code: string;
  legalName: string;
  tradingName: string;
  abn: string;
  gstRegistered: boolean;
  address: string;
  email: string;
  phone: string;
  website: string;
  documentPrefix: string;
  active: boolean;
};

const EMPTY_ENTITY: EntityDraft = {
  code: '',
  legalName: '',
  tradingName: '',
  abn: '',
  gstRegistered: true,
  address: '',
  email: '',
  phone: '',
  website: '',
  documentPrefix: 'ALMA',
  active: true
};

function entityDraft(entity: LegalEntity): EntityDraft {
  return {
    code: entity.code,
    legalName: entity.legalName,
    tradingName: entity.tradingName ?? '',
    abn: formatAbn(entity.abn),
    gstRegistered: entity.gstRegistered,
    address: entity.address ?? '',
    email: entity.email ?? '',
    phone: entity.phone ?? '',
    website: entity.website ?? '',
    documentPrefix: entity.documentPrefix,
    active: entity.active
  };
}

/** The API's rules in plain English, checked before the round trip. */
function entityDraftProblem(draft: EntityDraft): string | null {
  if (!/^[A-Za-z0-9-]{2,12}$/.test(draft.code.trim())) return 'The code is 2–12 letters, numbers or dashes, e.g. STALMA.';
  if (draft.legalName.trim().length < 3) return 'Enter the legal name exactly as it appears on the ABN register.';
  if (!normaliseAbn(draft.abn)) return 'Enter the company’s ABN.';
  const abn = abnProblem(draft.abn);
  if (abn) return abn;
  if (!DOCUMENT_PREFIX_PATTERN.test(draft.documentPrefix.trim().toUpperCase())) {
    return 'The number prefix is 2–8 capital letters or digits, e.g. ALMA.';
  }
  return null;
}

function CompaniesCard({
  entities,
  issuerId,
  onChanged
}: {
  entities: LegalEntity[];
  issuerId: string | null;
  onChanged: () => Promise<void>;
}) {
  // null = form closed, 'new' = adding a company, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntityDraft>(EMPTY_ENTITY);
  const [abnTouched, setAbnTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<DocumentFeedback | null>(null);

  function startEditing(entity: LegalEntity | null) {
    setEditing(entity ? entity.id : 'new');
    setDraft(entity ? entityDraft(entity) : EMPTY_ENTITY);
    setAbnTouched(Boolean(entity));
    setMessage(null);
  }

  function update<K extends keyof EntityDraft>(key: K, value: EntityDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Checked as it is typed once all eleven digits are in, or on leaving the field.
  const abnError =
    abnTouched || normaliseAbn(draft.abn).length >= 11
      ? normaliseAbn(draft.abn)
        ? abnProblem(draft.abn)
        : 'Enter the company’s ABN.'
      : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setAbnTouched(true);
    const problem = entityDraftProblem(draft);
    if (problem) {
      setMessage({ tone: 'error', text: problem });
      return;
    }
    if (editing === issuerId && !draft.active) {
      setMessage({
        tone: 'error',
        text: 'This company issues the gift card documents. Choose a different issuing company under Settings before deactivating it.'
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api<LegalEntity>(
        editing === 'new' ? '/api/invoices/entities' : `/api/invoices/entities/${encodeURIComponent(editing)}`,
        {
          method: editing === 'new' ? 'POST' : 'PATCH',
          body: JSON.stringify({
            ...draft,
            code: draft.code.trim().toUpperCase(),
            abn: normaliseAbn(draft.abn),
            documentPrefix: draft.documentPrefix.trim().toUpperCase()
          })
        }
      );
      await onChanged();
      setEditing(null);
      setMessage({ tone: 'success', text: `${draft.legalName.trim()} saved.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save the company.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Companies"
      subtitle="The legal entities that issue documents. The legal name and ABN are copied onto each document when it is issued, so editing a company changes new documents only."
      action={
        editing ? null : (
          <Button type="button" size="sm" variant="secondary" onClick={() => startEditing(null)}>
            Add a company
          </Button>
        )
      }
    >
      {entities.length === 0 ? (
        <EmptyState
          title="No companies yet"
          description="Add the company that sells the gift cards. Its legal name and ABN go on every receipt and tax invoice."
        />
      ) : (
        <div className="giftcards-invoice-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Legal name</th>
                <th>Trading as</th>
                <th>ABN</th>
                <th>GST</th>
                <th>Prefix</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.id}>
                  <td className="giftcards-invoice-mono">{entity.code}</td>
                  <td>
                    {entity.legalName}
                    {entity.id === issuerId ? (
                      <span className="giftcards-invoice-block">
                        <Badge tone="positive">Gift card issuer</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td>{entity.tradingName ?? '—'}</td>
                  <td className="giftcards-invoice-nowrap">{formatAbn(entity.abn)}</td>
                  <td>{entity.gstRegistered ? 'Registered' : 'Not registered'}</td>
                  <td className="giftcards-invoice-mono">{entity.documentPrefix}</td>
                  <td>
                    <Badge tone={entity.active ? 'positive' : 'muted'}>{entity.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td>
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => startEditing(entity)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <form className="giftcards-form giftcards-invoice-subform" onSubmit={(event) => void save(event)}>
          <h4 className="giftcards-invoice-subhead">{editing === 'new' ? 'Add a company' : `Edit ${draft.code || 'company'}`}</h4>
          <div className="form-grid two">
            <Input
              label="Legal name"
              required
              value={draft.legalName}
              onChange={(event) => update('legalName', event.currentTarget.value)}
              placeholder="As on the ABN register, e.g. St Alma Pty Ltd"
              maxLength={160}
            />
            <Input
              label="Trading as"
              value={draft.tradingName}
              onChange={(event) => update('tradingName', event.currentTarget.value)}
              placeholder="Optional, e.g. St Alma"
              maxLength={160}
            />
          </div>
          <div className="form-grid two">
            <div className="giftcards-invoice-field">
              <Input
                label="ABN"
                required
                inputMode="numeric"
                value={draft.abn}
                onChange={(event) => update('abn', event.currentTarget.value)}
                onBlur={() => setAbnTouched(true)}
                placeholder="11 digits"
              />
              {abnError ? (
                <span className="error-text giftcards-invoice-field-error" role="alert">
                  {abnError}
                </span>
              ) : null}
            </div>
            <Input
              label="Code"
              required
              value={draft.code}
              onChange={(event) => update('code', event.currentTarget.value.toUpperCase())}
              placeholder="e.g. STALMA"
              hint="A short name for this company inside Alma Suite."
              maxLength={12}
            />
          </div>
          <Textarea
            label="Address"
            rows={2}
            value={draft.address}
            onChange={(event) => update('address', event.currentTarget.value)}
            placeholder="Printed under the company name"
            maxLength={300}
          />
          <div className="form-grid three">
            <Input
              label="Email"
              type="email"
              value={draft.email}
              onChange={(event) => update('email', event.currentTarget.value)}
              placeholder="accounts@…"
            />
            <Input
              label="Phone"
              value={draft.phone}
              onChange={(event) => update('phone', event.currentTarget.value)}
              maxLength={40}
            />
            <Input
              label="Website"
              value={draft.website}
              onChange={(event) => update('website', event.currentTarget.value)}
              placeholder="almagroup.com.au"
              maxLength={160}
            />
          </div>
          <div className="form-grid two">
            <Input
              label="Number prefix"
              required
              value={draft.documentPrefix}
              onChange={(event) => update('documentPrefix', event.currentTarget.value.toUpperCase())}
              hint="Numbers read ALMA-INV-000184. A new prefix starts a new sequence."
              maxLength={8}
            />
          </div>
          <div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.gstRegistered}
                onChange={(event) => update('gstRegistered', event.currentTarget.checked)}
              />
              <span className="toggle-row-body">
                <strong>Registered for GST</strong>
                <span>Unticked, this company can only issue receipts — never a tax invoice.</span>
              </span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={draft.active} onChange={(event) => update('active', event.currentTarget.checked)} />
              <span className="toggle-row-body">
                <strong>Active</strong>
                <span>An inactive company stays on the documents it issued but cannot issue new ones.</span>
              </span>
            </label>
          </div>
          <div className="toolbar-right">
            <ActionFeedback message={message?.text} tone={message?.tone} />
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setEditing(null);
                setMessage(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add company' : 'Save company'}
            </Button>
          </div>
        </form>
      ) : message ? (
        <div className="toolbar-right">
          <ActionFeedback message={message.text} tone={message.tone} />
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Settings (owner)                                                    */
/* ------------------------------------------------------------------ */

type SettingsDraft = { issuerId: string; autoIssue: boolean; autoEmail: boolean; footerNote: string };

function settingsDraft(settings: InvoiceSettings): SettingsDraft {
  return {
    issuerId: settings.giftCardIssuingEntityId ?? '',
    autoIssue: settings.autoIssueGiftCards,
    autoEmail: settings.autoEmail,
    footerNote: settings.footerNote ?? ''
  };
}

function InvoiceSettingsCard({
  setup,
  onSaved
}: {
  setup: InvoiceSettingsResponse;
  onSaved: (next: InvoiceSettingsResponse) => void;
}) {
  const stored = setup.settings;
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(stored));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<DocumentFeedback | null>(null);

  // Re-seed only when the SAVED settings change. Reloading after a company is
  // added hands down a new object with the same values, and must not throw
  // away an edit in progress here.
  const storedKey = JSON.stringify(stored);
  const [seededFrom, setSeededFrom] = useState(storedKey);
  if (seededFrom !== storedKey) {
    setSeededFrom(storedKey);
    setDraft(settingsDraft(stored));
  }

  // The configured issuer stays in the list even if it has since gone
  // inactive, so the select never silently shows a different company.
  const issuerOptions = setup.entities
    .filter((entity) => entity.active || entity.id === stored.giftCardIssuingEntityId)
    .map((entity) => ({
      value: entity.id,
      label: `${entity.legalName} · ABN ${formatAbn(entity.abn)}${entity.active ? '' : ' (inactive)'}`
    }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const next = await api<InvoiceSettingsResponse>('/api/invoices/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          giftCardIssuingEntityId: draft.issuerId || null,
          autoIssueGiftCards: draft.autoIssue,
          autoEmail: draft.autoEmail,
          footerNote: draft.footerNote.trim() || null
        })
      });
      onSaved(next);
      setMessage({ tone: 'success', text: 'Invoice settings saved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save invoice settings.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Settings" subtitle="Which company sells the gift cards, and whether documents go out on their own.">
      <form className="giftcards-form" onSubmit={(event) => void save(event)}>
        <Select
          label="Gift card issuing company"
          value={draft.issuerId}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDraft((current) => ({ ...current, issuerId: value }));
          }}
          options={[{ label: issuerOptions.length ? 'Choose a company…' : 'Add a company first', value: '' }, ...issuerOptions]}
          hint="The merchant of record for gift cards. Group cards redeem at either venue, so this is a decision rather than something Alma can work out."
        />
        <div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.autoIssue}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setDraft((current) => ({ ...current, autoIssue: checked }));
              }}
            />
            <span className="toggle-row-body">
              <strong>Issue automatically</strong>
              <span>Issue a receipt or tax invoice as soon as Stripe confirms payment</span>
            </span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.autoEmail}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setDraft((current) => ({ ...current, autoEmail: checked }));
              }}
            />
            <span className="toggle-row-body">
              <strong>Email it to the purchaser</strong>
              <span>Documents issued automatically go straight to the purchaser as a PDF.</span>
            </span>
          </label>
        </div>
        <p className="subtle">
          {stored.autoIssueFrom
            ? `Automatic issuing covers cards paid from ${documentDate(stored.autoIssueFrom)}. Earlier cards can be issued by hand from the card.`
            : 'Automatic issuing covers cards paid from the moment it is switched on — it never goes back and emails earlier buyers.'}
        </p>
        <Textarea
          label="Footer note"
          rows={2}
          maxLength={400}
          value={draft.footerNote}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDraft((current) => ({ ...current, footerNote: value }));
          }}
          placeholder="Optional, e.g. Thank you for supporting a local business."
          hint="Printed in the notes of every new document."
        />
        <div className="toolbar-right">
          <ActionFeedback message={message?.text} tone={message?.tone} />
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The register                                                        */
/* ------------------------------------------------------------------ */

type DetailState = { detail: FinancialDocumentDetail | null; loading: boolean; error: string | null };
type CreditNoteRequest = {
  amountCents: number;
  reason: string;
  refundMethod: RefundMethod;
  refundReference: string;
  email: boolean;
};

function DocumentRegister({ canManage }: { canManage: boolean }) {
  // ?q= arrives from a gift card's receipt controls ("See it on the Invoices page").
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [debounced, setDebounced] = useState(() => query.trim());
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [register, setRegister] = useState<FinancialDocumentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState | undefined>>({});
  const actions = useDocumentActions();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const rangeBackwards = Boolean(from && to && from > to);

  useEffect(() => {
    if (rangeBackwards) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (debounced) params.set('query', debounced);
    if (type) params.set('type', type);
    // Plain YYYY-MM-DD: the API turns them into Sydney days, the same days the
    // documents are dated with, whatever timezone this browser is in.
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const search = params.toString();
    api<FinancialDocumentListResponse>(`/api/invoices${search ? `?${search}` : ''}`)
      .then((next) => {
        if (!cancelled) setRegister(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the documents.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, type, from, to, reloadKey, rangeBackwards]);

  const loadDetail = useCallback(async (id: string) => {
    setDetails((current) => ({ ...current, [id]: { detail: current[id]?.detail ?? null, loading: true, error: null } }));
    try {
      const detail = await api<FinancialDocumentDetail>(`/api/invoices/${encodeURIComponent(id)}`);
      setDetails((current) => ({ ...current, [id]: { detail, loading: false, error: null } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load this document.';
      setDetails((current) => ({ ...current, [id]: { detail: current[id]?.detail ?? null, loading: false, error: message } }));
    }
  }, []);

  function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    actions.clear(id);
    // Fetched fresh every time: an email or a credit note since the last look changes it.
    void loadDetail(id);
  }

  /** After an action the row, its detail and the totals may all have moved. */
  function refresh(id: string) {
    setReloadKey((key) => key + 1);
    void loadDetail(id);
  }

  function creditNote(doc: FinancialDocumentSummary, input: CreditNoteRequest) {
    return actions.run(doc.id, 'credit', async () => {
      try {
        const created = await api<FinancialDocumentSummary>(`/api/invoices/${encodeURIComponent(doc.id)}/credit-notes`, {
          method: 'POST',
          body: JSON.stringify(input)
        });
        return {
          tone: 'success',
          text: `${DOCUMENT_TYPE_LABELS[created.type]} ${created.number} issued for ${money(created.totalCents)}${input.email ? ' and emailed' : ''}.`
        };
      } finally {
        // Also after a failure: a 502 means the note exists and only the email failed.
        refresh(doc.id);
      }
    });
  }

  function voidDocument(doc: FinancialDocumentSummary, reason: string) {
    return actions.run(doc.id, 'void', async () => {
      try {
        await api(`/api/invoices/${encodeURIComponent(doc.id)}/void`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        return { tone: 'success', text: `${doc.number} is void. Its number stays used and its PDF is marked VOID.` };
      } finally {
        refresh(doc.id);
      }
    });
  }

  const documents = register?.documents ?? [];

  return (
    <>
      <Card
        title="Documents"
        subtitle="Every receipt, tax invoice and credit note, newest first. Tap a row for the detail, the PDF and what can be done with it."
      >
        <div className="giftcards-invoice-filters">
          <Input
            label="Search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Number, customer, email or card code"
          />
          <Select
            label="Type"
            value={type}
            onChange={(event) => setType(event.currentTarget.value)}
            options={[
              { label: 'All types', value: '' },
              ...FINANCIAL_DOCUMENT_TYPES.map((item) => ({ label: DOCUMENT_TYPE_LABELS[item], value: item }))
            ]}
          />
          <Input label="From" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.currentTarget.value)} />
          <Input label="To" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.currentTarget.value)} />
        </div>
        {rangeBackwards ? <p className="error-text">The From date is after the To date.</p> : null}
      </Card>

      {register ? (
        <div className="stats-grid">
          <StatCard label="Documents" value={String(register.totals.count)} hint="matching the filters" loading={loading} />
          <StatCard
            label="Net total"
            value={money(register.totals.netTotalCents)}
            hint="sales less credit notes, void excluded"
            loading={loading}
          />
          <StatCard label="Net GST" value={money(register.totals.netGstCents)} hint="GST charged less GST credited" loading={loading} />
        </div>
      ) : null}

      <Card title="Register" subtitle="Dates are Sydney dates. Credit notes show as minus.">
        {error ? <p className="error-text">{error}</p> : null}
        {loading && !register ? <Spinner label="Loading documents…" /> : null}
        {register && documents.length === 0 && !loading ? (
          <EmptyState
            title="No documents match"
            description="Documents appear here as they are issued. Change the search, type or dates above."
          />
        ) : null}
        {documents.length > 0 ? (
          <div className="giftcards-invoice-table-scroll">
            <table className="giftcards-invoice-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Issued</th>
                  <th>Customer</th>
                  <th>Card</th>
                  <th className="giftcards-invoice-num">Total</th>
                  <th className="giftcards-invoice-num">GST</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const isOpen = openId === doc.id;
                  const credit = isCreditDocument(doc.type);
                  return (
                    <Fragment key={doc.id}>
                      <tr className={`giftcards-invoice-row${isOpen ? ' is-open' : ''}`} onClick={() => toggle(doc.id)}>
                        <td>
                          {/* The row takes the click; the button is here so a keyboard can too. */}
                          <button type="button" className="giftcards-invoice-rowtoggle giftcards-invoice-mono" aria-expanded={isOpen}>
                            {doc.number}
                          </button>
                          {doc.creditsDocumentNumber ? (
                            <small className="subtle giftcards-invoice-block">credits {doc.creditsDocumentNumber}</small>
                          ) : null}
                        </td>
                        <td>
                          <span className="giftcards-invoice-badges">
                            <DocumentBadges doc={doc} showStatus={false} />
                          </span>
                        </td>
                        <td className="giftcards-invoice-nowrap">{documentDate(doc.issuedAt)}</td>
                        <td>{doc.customerOrganisation || doc.customerName}</td>
                        <td className="giftcards-invoice-mono">{doc.sourceReference ?? '—'}</td>
                        <td className="giftcards-invoice-num">{money(signedTotalCents(doc))}</td>
                        <td className="giftcards-invoice-num">{money(credit ? -doc.gstCents : doc.gstCents)}</td>
                        <td>
                          {doc.status === 'VOID' ? <Badge tone="danger">VOID</Badge> : <span>Issued</span>}
                          {doc.emailError ? (
                            <small className="error-text giftcards-invoice-block" title={doc.emailError}>
                              Email failed
                            </small>
                          ) : doc.emailedAt ? (
                            <small className="subtle giftcards-invoice-block" title={doc.emailedTo ? `to ${doc.emailedTo}` : undefined}>
                              Emailed {documentDate(doc.emailedAt)}
                            </small>
                          ) : null}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="giftcards-invoice-detail-row">
                          <td colSpan={8} className="giftcards-invoice-detail-cell">
                            <DocumentDetailPanel
                              state={details[doc.id]}
                              canManage={canManage}
                              busy={actions.busy[doc.id]}
                              feedback={actions.feedback[doc.id]}
                              onRetry={() => void loadDetail(doc.id)}
                              onViewPdf={() => void actions.viewPdf(doc)}
                              onEmail={(address) => actions.email(doc, address, () => refresh(doc.id))}
                              onCreditNote={(input) => creditNote(doc, input)}
                              onVoid={(reason) => voidDocument(doc, reason)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {register?.capped ? (
          <p className="subtle">
            Showing the newest {documents.length} — the totals above cover every match. Narrow the search or dates to see older
            documents.
          </p>
        ) : null}
      </Card>
    </>
  );
}

function DocumentDetailPanel({
  state,
  canManage,
  busy,
  feedback,
  onRetry,
  onViewPdf,
  onEmail,
  onCreditNote,
  onVoid
}: {
  state: DetailState | undefined;
  canManage: boolean;
  busy: DocumentAction | undefined;
  feedback: DocumentFeedback | undefined;
  onRetry: () => void;
  onViewPdf: () => void;
  onEmail: (to: string) => Promise<boolean>;
  onCreditNote: (input: CreditNoteRequest) => Promise<boolean>;
  onVoid: (reason: string) => Promise<boolean>;
}) {
  const [form, setForm] = useState<'email' | 'credit' | 'void' | null>(null);

  if (!state?.detail) {
    return (
      <div className="giftcards-invoice-detail">
        {!state || state.loading ? (
          <Spinner label="Loading the document…" />
        ) : (
          <>
            <p className="error-text">{state.error ?? 'Could not load this document.'}</p>
            <div>
              <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  const doc = state.detail;
  const credit = isCreditDocument(doc.type);
  const liveCredits = doc.credits.filter((item) => item.status === 'ISSUED');
  const canCredit = canManage && !credit && doc.status === 'ISSUED' && doc.remainingCreditableCents > 0;
  const canVoid = canManage && doc.status === 'ISSUED';
  const working = Boolean(busy);
  const issuerContact = [doc.issuerEmail, doc.issuerPhone, doc.issuerWebsite].filter(Boolean).join(' · ');
  const closeOnSuccess = (pending: Promise<boolean>) => {
    void pending.then((ok) => {
      if (ok) setForm(null);
    });
  };
  const toggleForm = (next: 'email' | 'credit' | 'void') => setForm((current) => (current === next ? null : next));

  return (
    <div className="giftcards-invoice-detail">
      {state.error ? <p className="error-text">{state.error}</p> : null}
      {doc.status === 'VOID' ? (
        <p className="error-text">
          Void since {documentDate(doc.voidedAt)}
          {doc.voidReason ? ` — ${doc.voidReason}` : ''}. The number stays used; the document no longer counts.
        </p>
      ) : null}
      {doc.testMode ? <p className="error-text">Test document — not real money.</p> : null}

      <div className="giftcards-invoice-parties">
        <section>
          <h4>From</h4>
          <strong>{doc.issuerLegalName}</strong>
          {doc.issuerTradingName ? <span>Trading as {doc.issuerTradingName}</span> : null}
          <span>
            ABN {formatAbn(doc.issuerAbn)}
            {doc.issuerGstRegistered ? '' : ' · not registered for GST'}
          </span>
          {doc.issuerAddress ? <span>{doc.issuerAddress}</span> : null}
          {issuerContact ? <span className="subtle">{issuerContact}</span> : null}
        </section>
        <section>
          <h4>Bill to</h4>
          {doc.customerOrganisation ? <strong>{doc.customerOrganisation}</strong> : null}
          <span>{doc.customerName}</span>
          {doc.customerAbn ? <span>ABN {formatAbn(doc.customerAbn)}</span> : null}
          {doc.customerEmail ? <span>{doc.customerEmail}</span> : null}
          {doc.customerReference ? <span>Your reference: {doc.customerReference}</span> : null}
        </section>
        <section>
          <h4>{credit ? 'Refund' : 'Payment'}</h4>
          <span>{doc.paymentMethodSummary ?? PAYMENT_LABELS[doc.paymentProvider]}</span>
          <span>
            {credit ? 'Refunded' : 'Paid'} {documentDate(doc.paidAt)}
          </span>
          {doc.paymentReference ? <span>Reference {doc.paymentReference}</span> : null}
          {doc.sourceReference ? (
            <span>
              Gift card <span className="giftcards-invoice-mono">{doc.sourceReference}</span>
            </span>
          ) : null}
          {doc.stripePaymentIntentId ? <span className="subtle giftcards-invoice-mono">{doc.stripePaymentIntentId}</span> : null}
          <span className="subtle">
            Issued {documentDate(doc.issuedAt)} {doc.issuedByName ? `by ${doc.issuedByName}` : ISSUE_SOURCE_LABELS[doc.issueSource]}
          </span>
        </section>
      </div>

      {credit ? (
        <p>
          Credits <span className="giftcards-invoice-mono">{doc.creditsDocumentNumber ?? '—'}</span>
          {doc.reason ? ` · Reason: ${doc.reason}` : ''}
        </p>
      ) : null}

      <div className="giftcards-invoice-lines-scroll">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>GST treatment</th>
              <th className="giftcards-invoice-num">GST</th>
              <th className="giftcards-invoice-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.description}</strong>
                  {line.detail ? <small className="subtle giftcards-invoice-block">{line.detail}</small> : null}
                </td>
                <td>
                  {GST_TREATMENT_LABELS[line.gstTreatment]}
                  {line.gstTreatment === 'MIXED' ? (
                    <small className="subtle giftcards-invoice-block">taxable part {money(line.taxableAmountCents)}</small>
                  ) : null}
                </td>
                <td className="giftcards-invoice-num">{money(line.gstCents)}</td>
                <td className="giftcards-invoice-num">{money(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="giftcards-invoice-totals">
        <dt>{credit ? 'Total credited' : 'Total'}</dt>
        <dd>{money(doc.totalCents)}</dd>
        <dt>{credit ? 'GST adjustment' : 'GST included'}</dt>
        <dd>{money(doc.gstCents)}</dd>
        {doc.taxableCents > 0 ? (
          <>
            <dt>Taxable supplies</dt>
            <dd>{money(doc.taxableCents)}</dd>
          </>
        ) : null}
        {!credit && doc.status === 'ISSUED' && doc.remainingCreditableCents < doc.totalCents ? (
          <>
            <dt>Left to credit</dt>
            <dd>{money(doc.remainingCreditableCents)}</dd>
          </>
        ) : null}
      </dl>

      {doc.note ? <p className="subtle giftcards-invoice-note">{doc.note}</p> : null}
      {doc.emailError ? (
        <p className="error-text">Last email failed: {doc.emailError}</p>
      ) : doc.emailedAt ? (
        <p className="subtle">
          Emailed to {doc.emailedTo} · {documentDateTime(doc.emailedAt)}
          {doc.emailCount > 1 ? ` · sent ${doc.emailCount} times` : ''}
        </p>
      ) : null}

      {doc.credits.length > 0 ? (
        <section className="giftcards-invoice-credits">
          <h4>Credit notes against this document</h4>
          {doc.credits.map((item) => (
            <div key={item.id} className="giftcards-invoice-credit">
              <span className="giftcards-invoice-mono">{item.number}</span>
              <DocumentBadges doc={item} />
              <span className="subtle">{documentDate(item.issuedAt)}</span>
              <strong className="giftcards-invoice-num">{money(signedTotalCents(item))}</strong>
            </div>
          ))}
        </section>
      ) : null}

      <div className="giftcards-inline-actions giftcards-invoice-actions">
        <Button type="button" size="sm" variant="secondary" disabled={working} onClick={onViewPdf}>
          {busy === 'pdf' ? 'Opening…' : 'View PDF'}
        </Button>
        {doc.status === 'ISSUED' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={working}
            aria-expanded={form === 'email'}
            onClick={() => toggleForm('email')}
          >
            Email
          </Button>
        ) : null}
        {canCredit ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={working}
            aria-expanded={form === 'credit'}
            onClick={() => toggleForm('credit')}
          >
            Credit note
          </Button>
        ) : null}
        {canVoid ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={working}
            aria-expanded={form === 'void'}
            onClick={() => toggleForm('void')}
          >
            Void
          </Button>
        ) : null}
        <ActionFeedback message={feedback?.text} tone={feedback?.tone} />
      </div>

      {form === 'email' ? (
        <EmailDocumentForm
          doc={doc}
          sending={busy === 'email'}
          onSend={(address) => closeOnSuccess(onEmail(address))}
          onCancel={() => setForm(null)}
        />
      ) : null}
      {form === 'credit' && canCredit ? (
        <CreditNoteForm
          doc={doc}
          busy={busy === 'credit'}
          onSubmit={(input) => closeOnSuccess(onCreditNote(input))}
          onCancel={() => setForm(null)}
        />
      ) : null}
      {form === 'void' && canVoid ? (
        <VoidForm
          doc={doc}
          blockedBy={credit ? [] : liveCredits}
          busy={busy === 'void'}
          onSubmit={(reason) => closeOnSuccess(onVoid(reason))}
          onCancel={() => setForm(null)}
        />
      ) : null}
    </div>
  );
}

function defaultRefundMethod(provider: PaymentProvider): RefundMethod {
  return provider === 'STRIPE' || provider === 'CARD' || provider === 'CASH' || provider === 'EFTPOS' ? provider : 'OTHER';
}

function CreditNoteForm({
  doc,
  busy,
  onSubmit,
  onCancel
}: {
  doc: FinancialDocumentDetail;
  busy: boolean;
  onSubmit: (input: CreditNoteRequest) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState((doc.remainingCreditableCents / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(defaultRefundMethod(doc.paymentProvider));
  const [reference, setReference] = useState('');
  const [emailIt, setEmailIt] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const noteName = doc.type === 'TAX_INVOICE' ? 'adjustment note' : 'credit note';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setProblem('Enter the amount that went back to the customer.');
      return;
    }
    if (amountCents > doc.remainingCreditableCents) {
      setProblem(`Only ${money(doc.remainingCreditableCents)} is left to credit on ${doc.number}.`);
      return;
    }
    if (reason.trim().length < 3) {
      setProblem(`Say why the money went back — it is printed on the ${noteName}.`);
      return;
    }
    if (emailIt && !doc.customerEmail) {
      setProblem('There is no customer email on this document to send it to. Untick the email and send it from the new note instead.');
      return;
    }
    setProblem(null);
    if (
      !window.confirm(
        `Issue ${noteName === 'adjustment note' ? 'an' : 'a'} ${noteName} for ${money(amountCents)} against ${doc.number}?\n\n` +
          'It records money already given back — it does not refund anything in Stripe or at the till. Once issued it cannot be edited, only voided.'
      )
    ) {
      return;
    }
    onSubmit({ amountCents, reason: reason.trim(), refundMethod, refundReference: reference.trim(), email: emailIt });
  }

  return (
    <form className="giftcards-form giftcards-invoice-subform" onSubmit={submit}>
      <p className="subtle">
        Records money already given back against {doc.number}. It moves no money — refund in Stripe or at the till first.
        The gift card is not touched: cancel it from Redeem if it should stop working.
      </p>
      <div className="form-grid two">
        <Input
          id={`${id}-amount`}
          label="Amount given back (AUD)"
          type="number"
          min="0.01"
          step="0.01"
          max={(doc.remainingCreditableCents / 100).toFixed(2)}
          required
          value={amount}
          onChange={(event) => setAmount(event.currentTarget.value)}
          hint={`Up to ${money(doc.remainingCreditableCents)}`}
        />
        <Select
          id={`${id}-method`}
          label="How it went back"
          value={refundMethod}
          onChange={(event) => setRefundMethod(event.currentTarget.value as RefundMethod)}
          options={REFUND_METHODS}
        />
      </div>
      {refundMethod === 'STRIPE' ? (
        <p className="subtle">
          A refund made in Stripe raises its own credit note here automatically. Check the credit notes above before adding one,
          or the refund will be counted twice.
        </p>
      ) : null}
      <div className="form-grid two">
        <Input
          id={`${id}-reason`}
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          placeholder="e.g. Bought twice by mistake"
          maxLength={300}
        />
        <Input
          id={`${id}-reference`}
          label="Refund reference"
          value={reference}
          onChange={(event) => setReference(event.currentTarget.value)}
          placeholder="Optional, e.g. the till receipt number"
          maxLength={80}
        />
      </div>
      <label className="giftcards-invoice-check">
        <input type="checkbox" checked={emailIt} onChange={(event) => setEmailIt(event.currentTarget.checked)} />
        <span>Email it to the customer{doc.customerEmail ? ` (${doc.customerEmail})` : ''}</span>
      </label>
      <div className="toolbar-right">
        <ActionFeedback message={problem} tone="error" />
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Issuing…' : `Issue ${noteName}`}
        </Button>
      </div>
    </form>
  );
}

function VoidForm({
  doc,
  blockedBy,
  busy,
  onSubmit,
  onCancel
}: {
  doc: FinancialDocumentDetail;
  blockedBy: FinancialDocumentSummary[];
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  if (blockedBy.length > 0) {
    const numbers = blockedBy.map((item) => item.number).join(', ');
    return (
      <p className="subtle giftcards-invoice-subform">
        {blockedBy.length === 1
          ? `${doc.number} has a credit note against it (${numbers}). Void that first.`
          : `${doc.number} has credit notes against it (${numbers}). Void those first.`}
      </p>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setProblem('Say why it is being voided — the reason stays on the record.');
      return;
    }
    setProblem(null);
    if (
      !window.confirm(
        `Void ${doc.number}? This cannot be undone.\n\nThe number stays used, the PDF is marked VOID, and it no longer counts in the totals.`
      )
    ) {
      return;
    }
    onSubmit(reason.trim());
  }

  return (
    <form className="giftcards-form giftcards-invoice-subform" onSubmit={submit}>
      <p className="subtle">
        {isCreditDocument(doc.type)
          ? `For a note raised in error. Its amount becomes creditable again on ${doc.creditsDocumentNumber ?? 'the original document'}.`
          : 'For a document issued in error — the wrong customer, say. Once it is void, a corrected one can be issued from the gift card. If money went back, raise a credit note instead.'}
      </p>
      <Input
        id={`${id}-reason`}
        label="Reason for voiding"
        required
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        placeholder="e.g. Made out to the wrong company"
        maxLength={300}
      />
      <div className="toolbar-right">
        <ActionFeedback message={problem} tone="error" />
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? 'Voiding…' : `Void ${doc.number}`}
        </Button>
      </div>
    </form>
  );
}

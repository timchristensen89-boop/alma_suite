import { useEffect, useId, useState } from 'react';
import {
  isCreditDocument,
  normaliseAbn,
  type FinancialDocumentDetail,
  type GiftCardDocumentsResponse
} from '@alma/shared';
import { ActionFeedback, Button, Input, Spinner } from '@alma/ui';
import { ApiError, api } from './lib/api';
import {
  DOCUMENT_TYPE_LABELS,
  DocumentBadges,
  EmailDocumentForm,
  abnProblem,
  documentDate,
  money,
  signedTotalCents,
  useDocumentActions,
  type DocumentFeedback
} from './InvoicesPage';

/**
 * A gift card's receipt, tax invoice and credit notes, inside the card's own
 * record — the purchases log and the Redeem screen.
 *
 * Compact on purpose: it sits in a <dd>. There is no <form> and every button
 * is type="button", because these controls are dropped into other screens'
 * records and must never submit a form they happen to sit inside.
 */

type IssueDraft = {
  organisation: string;
  abn: string;
  name: string;
  email: string;
  reference: string;
  note: string;
  emailNow: boolean;
};

type IssueTextField = Exclude<keyof IssueDraft, 'emailNow'>;

const EMPTY_ISSUE: IssueDraft = { organisation: '', abn: '', name: '', email: '', reference: '', note: '', emailNow: false };

type LoadError = { status: number; message: string };

export function GiftCardDocumentControls({ code, isOwner }: { code: string; isOwner: boolean }) {
  const id = useId();
  // Keyed by the code it was loaded for, so one card's documents never show
  // under another while the next card loads.
  const [loaded, setLoaded] = useState<{ code: string; data: GiftCardDocumentsResponse } | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [draft, setDraft] = useState<IssueDraft>(EMPTY_ISSUE);
  const [abnTouched, setAbnTouched] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueFeedback, setIssueFeedback] = useState<DocumentFeedback | null>(null);
  const actions = useDocumentActions();

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api<GiftCardDocumentsResponse>(`/api/invoices/gift-cards/${encodeURIComponent(code)}`)
      .then((data) => {
        if (!cancelled) setLoaded({ code, data });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError({
          status: error instanceof ApiError ? error.status : 0,
          message: error instanceof Error ? error.message : 'Could not load this card’s receipts.'
        });
      });
    return () => {
      cancelled = true;
    };
  }, [code, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);

  const current = loaded?.code === code ? loaded.data : null;

  const field = (key: IssueTextField) => (event: { currentTarget: HTMLInputElement }) => {
    const value = event.currentTarget.value;
    setDraft((existing) => ({ ...existing, [key]: value }));
  };

  // Checked once all eleven digits are in, or on leaving the field.
  const abnError = abnTouched || normaliseAbn(draft.abn).length >= 11 ? abnProblem(draft.abn) : null;

  async function issue() {
    const abn = abnProblem(draft.abn);
    if (abn) {
      setAbnTouched(true);
      setIssueFeedback({ tone: 'error', text: abn });
      return;
    }
    setIssuing(true);
    setIssueFeedback(null);
    try {
      const issued = await api<FinancialDocumentDetail>(`/api/invoices/gift-cards/${encodeURIComponent(code)}/issue`, {
        method: 'POST',
        body: JSON.stringify({
          customerOrganisation: draft.organisation.trim(),
          customerAbn: normaliseAbn(draft.abn),
          customerName: draft.name.trim(),
          customerEmail: draft.email.trim(),
          customerReference: draft.reference.trim(),
          note: draft.note.trim(),
          email: draft.emailNow
        })
      });
      setIssueFeedback({
        tone: 'success',
        text: `${DOCUMENT_TYPE_LABELS[issued.type]} ${issued.number} issued${
          draft.emailNow ? ` and emailed to ${issued.customerEmail ?? 'the purchaser'}` : ''
        }.`
      });
      setIssueOpen(false);
      setDraft(EMPTY_ISSUE);
      setAbnTouched(false);
    } catch (error) {
      // The server's sentence says which case it is — 409 no issuing company
      // chosen yet, 422 a card that cannot have one, 502 a document that WAS
      // issued but whose email failed — so it is shown as written.
      setIssueFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Could not issue the receipt.' });
    } finally {
      setIssuing(false);
      reload();
    }
  }

  if (!current) {
    if (!loadError) return <Spinner label="Loading receipts…" />;
    // Staff at the counter can look a card up but not its receipts. That is a
    // rule, not a fault, so it reads as a note rather than an error.
    if (loadError.status === 403) return <span className="subtle">{loadError.message}</span>;
    return (
      <span className="giftcards-invoice-controls-line">
        <span className="error-text">{loadError.message}</span>
        <Button type="button" size="sm" variant="ghost" onClick={reload}>
          Try again
        </Button>
      </span>
    );
  }

  const documents = current.documents;
  const hasLiveSale = documents.some((doc) => doc.status === 'ISSUED' && !isCreditDocument(doc.type));

  return (
    <div className="giftcards-invoice-controls">
      {documents.map((doc) => {
        const busy = actions.busy[doc.id];
        const feedback = actions.feedback[doc.id];
        return (
          <div key={doc.id} className="giftcards-invoice-controls-doc">
            <div className="giftcards-invoice-controls-line">
              <span className="giftcards-invoice-mono">{doc.number}</span>
              <DocumentBadges doc={doc} />
              <strong className="giftcards-invoice-num">{money(signedTotalCents(doc))}</strong>
              <span className="subtle">{documentDate(doc.issuedAt)}</span>
              <span className="giftcards-inline-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void actions.viewPdf(doc)}
                >
                  {busy === 'pdf' ? 'Opening…' : 'View PDF'}
                </Button>
                {doc.status === 'ISSUED' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    aria-expanded={emailingId === doc.id}
                    onClick={() => setEmailingId(emailingId === doc.id ? null : doc.id)}
                  >
                    Email
                  </Button>
                ) : null}
              </span>
            </div>
            {doc.emailError ? (
              <small className="error-text">Last email failed: {doc.emailError}</small>
            ) : doc.emailedAt ? (
              <small className="subtle">
                Emailed to {doc.emailedTo} · {documentDate(doc.emailedAt)}
              </small>
            ) : null}
            {emailingId === doc.id ? (
              <EmailDocumentForm
                doc={doc}
                sending={busy === 'email'}
                onSend={(to) =>
                  void actions.email(doc, to, reload).then((sent) => {
                    if (sent) setEmailingId(null);
                  })
                }
                onCancel={() => setEmailingId(null)}
              />
            ) : null}
            <ActionFeedback message={feedback?.text} tone={feedback?.tone} />
          </div>
        );
      })}

      {hasLiveSale ? null : current.ineligibleReason ? (
        <span className="subtle">{current.ineligibleReason}</span>
      ) : issueOpen ? (
        <div className="giftcards-invoice-issue" role="group" aria-label={`Issue a receipt for ${current.code}`}>
          <p className="subtle">
            All optional — left blank, it is made out to the purchaser. It is a tax invoice when part of the price was taxable
            (the online service fee), otherwise a receipt.
          </p>
          <div className="form-grid two">
            <Input
              id={`${id}-organisation`}
              label="Organisation"
              value={draft.organisation}
              onChange={field('organisation')}
              placeholder="The company or council paying, if any"
              maxLength={160}
            />
            <div className="giftcards-invoice-field">
              <Input
                id={`${id}-abn`}
                label="Customer ABN"
                inputMode="numeric"
                value={draft.abn}
                onChange={field('abn')}
                onBlur={() => setAbnTouched(true)}
                placeholder="Only if they ask for it"
              />
              {abnError ? (
                <span className="error-text giftcards-invoice-field-error" role="alert">
                  {abnError}
                </span>
              ) : null}
            </div>
            <Input
              id={`${id}-name`}
              label="Name"
              value={draft.name}
              onChange={field('name')}
              placeholder="Defaults to the purchaser"
              maxLength={160}
            />
            <Input
              id={`${id}-email`}
              label="Email"
              type="email"
              value={draft.email}
              onChange={field('email')}
              placeholder="Defaults to the purchaser’s email"
            />
            <Input
              id={`${id}-reference`}
              label="Their reference"
              value={draft.reference}
              onChange={field('reference')}
              placeholder="e.g. a purchase order number"
              maxLength={80}
            />
            <Input
              id={`${id}-note`}
              label="Note"
              value={draft.note}
              onChange={field('note')}
              placeholder="Printed on the document"
              maxLength={400}
            />
          </div>
          <label className="giftcards-invoice-check">
            <input
              type="checkbox"
              checked={draft.emailNow}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setDraft((existing) => ({ ...existing, emailNow: checked }));
              }}
            />
            <span>Email it now</span>
          </label>
          <span className="giftcards-inline-actions">
            <Button type="button" size="sm" disabled={issuing} onClick={() => void issue()}>
              {issuing ? 'Issuing…' : 'Issue'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={issuing} onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
          </span>
        </div>
      ) : (
        <span className="giftcards-invoice-controls-line">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setIssueOpen(true);
              setIssueFeedback(null);
            }}
          >
            Issue receipt
          </Button>
          {documents.length === 0 ? <span className="subtle">No receipt issued yet.</span> : null}
        </span>
      )}
      <ActionFeedback message={issueFeedback?.text} tone={issueFeedback?.tone} />

      {documents.length > 0 ? (
        <a className="giftcards-invoice-link" href={`/invoices?q=${encodeURIComponent(current.code)}#invoices`}>
          {isOwner ? 'Credit notes and voids are on the Invoices page' : 'See it on the Invoices page'}
        </a>
      ) : null}
    </div>
  );
}

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

type ApiClient = <T>(path: string, init?: RequestInit) => Promise<T>;

type Props = {
  // Which app the feedback is coming from — so it lands tagged properly.
  appId: string;
  api: ApiClient;
  userName?: string | null;
};

type FeedbackType = 'bug' | 'idea' | 'praise';

// Suite-wide Feedback button (#56) — appears in every app's top-right
// next to Comms / Notifications. Opens a small panel where the user
// can quickly flag a bug, idea, or note praise. Submits to /api/issues
// with category=PRODUCT_FEEDBACK so the team has a single inbox.
export function SuiteFeedbackWidget({ appId, api, userName }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click / escape — same hook the other widgets use so
  // the dismiss behaviour is consistent across the suite.
  useDismissibleLayer(containerRef, open, () => setOpen(false), 'suite-feedback');

  const close = useCallback(() => {
    setOpen(false);
    // Clear the panel state on close so the next open starts fresh, but
    // keep the success message visible for a moment so the user sees it.
    setTimeout(() => {
      setTitle('');
      setDetail('');
      setType('bug');
    }, 200);
  }, []);

  useEffect(() => {
    // When the message becomes a success, auto-close after a beat.
    if (message && messageTone === 'success') {
      const id = window.setTimeout(() => {
        setMessage(null);
        close();
      }, 1400);
      return () => window.clearTimeout(id);
    }
  }, [message, messageTone, close]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setMessageTone('error');
      setMessage('Add a short title.');
      return;
    }
    if (!detail.trim()) {
      setMessageTone('error');
      setMessage('Add a one-line description.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const path = typeof window !== 'undefined' ? window.location.pathname + window.location.hash : '';
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const description = [
        `Type: ${type === 'bug' ? 'Bug' : type === 'idea' ? 'Idea / improvement' : 'Praise'}`,
        `From: ${userName || 'Unknown user'}`,
        `App: ${appId}`,
        `Page: ${path || '—'}`,
        '',
        detail.trim(),
        '',
        '---',
        `User agent: ${ua}`
      ].join('\n');
      const severity = type === 'bug' ? 'MEDIUM' : 'LOW';
      await api<unknown>(`/api/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[${type === 'bug' ? 'Bug' : type === 'idea' ? 'Idea' : 'Praise'}] ${title.trim()}`,
          description,
          severity,
          category: 'PRODUCT_FEEDBACK',
          status: 'OPEN'
        })
      });
      setMessageTone('success');
      setMessage('Thanks — we saw it.');
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not file feedback.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="suite-feedback-widget" ref={containerRef}>
      <button
        type="button"
        className="suite-feedback-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Send feedback"
        title="Send feedback"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="suite-feedback-trigger-icon" aria-hidden="true">
          {/* Speech-bubble glyph */}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </span>
        <span className="suite-feedback-trigger-label">Feedback</span>
      </button>
      {open ? (
        <div className="suite-feedback-panel" role="dialog" aria-label="Send feedback">
          <header className="suite-feedback-head">
            <span className="suite-feedback-eyebrow">Send feedback</span>
            <h3 className="suite-feedback-title">Tell us what to fix or build</h3>
            <p className="suite-feedback-sub">It lands in the team inbox with the page you were on.</p>
          </header>
          <form className="suite-feedback-form" onSubmit={submit}>
            <div className="suite-feedback-types">
              <label className={`suite-feedback-type ${type === 'bug' ? 'is-active' : ''}`}>
                <input type="radio" name="feedback-type" value="bug" checked={type === 'bug'} onChange={() => setType('bug')} />
                <span>Bug</span>
              </label>
              <label className={`suite-feedback-type ${type === 'idea' ? 'is-active' : ''}`}>
                <input type="radio" name="feedback-type" value="idea" checked={type === 'idea'} onChange={() => setType('idea')} />
                <span>Idea</span>
              </label>
              <label className={`suite-feedback-type ${type === 'praise' ? 'is-active' : ''}`}>
                <input type="radio" name="feedback-type" value="praise" checked={type === 'praise'} onChange={() => setType('praise')} />
                <span>Praise</span>
              </label>
            </div>
            <label className="suite-feedback-label">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={type === 'bug' ? 'e.g. Roster board not loading on iPad' : 'e.g. Add a print button to stocktake'}
                maxLength={120}
                autoFocus
              />
            </label>
            <label className="suite-feedback-label">
              What happened / what you want
              <textarea
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Tell us what to fix, build, or what you liked. Be specific — page, step, what you expected."
                rows={4}
                maxLength={1500}
              />
            </label>
            {message ? (
              <p className={`suite-feedback-message is-${messageTone}`}>{message}</p>
            ) : null}
            <div className="suite-feedback-actions">
              <button type="button" className="suite-feedback-cancel" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" className="suite-feedback-submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

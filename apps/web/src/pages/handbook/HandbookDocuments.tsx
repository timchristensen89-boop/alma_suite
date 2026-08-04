import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Input, Select } from '@alma/ui';
import { api, apiBlob, ApiError } from '../../lib/api';

/**
 * Files that hang off the staff handbook.
 *
 * Everything else in the handbook is text typed into this app. The things a
 * new starter actually has to be given — the signed policy, the allergen
 * matrix, a photo of how the pass is set up — are files, and until now there
 * was nowhere to put them.
 */

export type HandbookDocument = {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  venue: string | null;
  sendOnOnboarding: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/** Anything larger is rejected by the API; catching it here saves the upload. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/heic,image/gif';

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(mimeType: string) {
  return mimeType.startsWith('image/');
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Open a document.
 *
 * The endpoint needs the bearer token, so the bytes come back as a blob and go
 * to the browser as an object URL. The URL is revoked on a timer rather than
 * immediately — revoking it straight away closes the tab that was just opened.
 */
export async function openHandbookDocument(doc: Pick<HandbookDocument, 'id' | 'fileName'>) {
  const blob = await apiBlob(`/api/handbook-documents/${doc.id}/file`);
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) {
    // Popup blocked — fall back to a download, which is never blocked.
    const link = document.createElement('a');
    link.href = url;
    link.download = doc.fileName;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Read-only list, for staff and for the reading view. */
export function HandbookDocumentList({ documents }: { documents: HandbookDocument[] }) {
  const [error, setError] = useState<string | null>(null);

  if (documents.length === 0) return null;

  return (
    <div className="page-stack">
      {error ? <p className="small" style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p> : null}
      <div className="handbook-doc-list">
        {documents.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className="handbook-doc-row"
            onClick={() => {
              setError(null);
              openHandbookDocument(doc).catch((err) =>
                setError(err instanceof Error ? err.message : 'Could not open that document.')
              );
            }}
          >
            <span className="handbook-doc-kind">{isImage(doc.mimeType) ? 'IMG' : 'PDF'}</span>
            <span className="handbook-doc-body">
              <span className="handbook-doc-title">{doc.title}</span>
              {doc.description ? <span className="subtle small">{doc.description}</span> : null}
              <span className="subtle small">
                {doc.fileName} · {formatBytes(doc.sizeBytes)}
                {doc.venue ? ` · ${doc.venue}` : ''}
              </span>
            </span>
            <span className="subtle small">Open ↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function HandbookDocumentsEditor({ venues }: { venues: string[] }) {
  const [documents, setDocuments] = useState<HandbookDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('all');
  const [sendOnOnboarding, setSendOnOnboarding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // 'all' so the editor shows every venue's documents, not just the
      // manager's own — a manager editing the handbook is editing all of it.
      setDocuments(await api<HandbookDocument[]>('/api/handbook-documents?venue=all'));
    } catch (err) {
      setFeedback({ text: err instanceof Error ? err.message : 'Could not load documents.', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function pickFile(next: File | null) {
    setFeedback(null);
    if (next && next.size > MAX_FILE_BYTES) {
      setFeedback({
        text: `${next.name} is ${formatBytes(next.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} — try compressing it.`,
        tone: 'error'
      });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFile(next);
    // Save the manager typing the name out again; they can still change it.
    if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ''));
  }

  async function upload() {
    if (!file) {
      setFeedback({ text: 'Choose a PDF or an image first.', tone: 'error' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      await api('/api/handbook-documents', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim() || file.name,
          description: description.trim() || null,
          fileName: file.name,
          venue,
          sendOnOnboarding,
          file: dataUrl
        })
      });
      setTitle('');
      setDescription('');
      setSendOnOnboarding(false);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await reload();
      setFeedback({ text: 'Uploaded.', tone: 'success' });
    } catch (err) {
      setFeedback({
        text: err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed.',
        tone: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setFeedback(null);
    try {
      await api(`/api/handbook-documents/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setFeedback({ text: err instanceof Error ? err.message : 'Could not save.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: HandbookDocument) {
    if (!window.confirm(`Delete "${doc.title}"? New starters will stop receiving it.`)) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api(`/api/handbook-documents/${doc.id}`, { method: 'DELETE' });
      await reload();
      setFeedback({ text: `Deleted ${doc.title}.`, tone: 'success' });
    } catch (err) {
      setFeedback({ text: err instanceof Error ? err.message : 'Could not delete.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const onboardingCount = documents.filter((doc) => doc.sendOnOnboarding).length;

  return (
    <div className="page-stack">
      {feedback ? (
        <div className={`handbook-editor-feedback handbook-editor-feedback-${feedback.tone}`}>{feedback.text}</div>
      ) : null}

      <div className="handbook-doc-upload">
        <h4 style={{ margin: '0 0 4px' }}>Add a document</h4>
        <p className="subtle small" style={{ margin: '0 0 14px' }}>
          PDFs and images up to {formatBytes(MAX_FILE_BYTES)}. Tick “send with onboarding” and every new starter
          gets it attached to their invite email.
        </p>
        <div className="handbook-doc-upload-grid">
          <Input
            label="Title"
            value={title}
            placeholder="e.g. Food safety policy"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <Input
            label="Description (optional)"
            value={description}
            placeholder="What is it, in one line"
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <Select
            label="Venue"
            value={venue}
            onChange={(event) => setVenue(event.currentTarget.value)}
            options={[{ label: 'All venues', value: 'all' }, ...venues.map((name) => ({ label: name, value: name }))]}
          />
          <label className="handbook-doc-file">
            <span className="small subtle">File</span>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              onChange={(event) => pickFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
        </div>
        <label className="handbook-doc-check">
          <input
            type="checkbox"
            checked={sendOnOnboarding}
            onChange={(event) => setSendOnOnboarding(event.currentTarget.checked)}
          />
          <span>Send with onboarding invites</span>
        </label>
        <div style={{ marginTop: 12 }}>
          <Button type="button" onClick={() => void upload()} disabled={busy || !file}>
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
          {file ? (
            <span className="subtle small" style={{ marginLeft: 10 }}>
              {file.name} · {formatBytes(file.size)}
            </span>
          ) : null}
        </div>
      </div>

      <div>
        <div className="handbook-doc-list-header">
          <h4 style={{ margin: 0 }}>Documents ({documents.length})</h4>
          <span className="subtle small">
            {onboardingCount === 0
              ? 'None are attached to onboarding invites yet.'
              : `${onboardingCount} attached to every onboarding invite.`}
          </span>
        </div>

        {loading ? (
          <p className="subtle small">Loading…</p>
        ) : documents.length === 0 ? (
          <EmptyState title="No documents yet" description="Upload the policies and photos new staff need to see." />
        ) : (
          <div className="handbook-doc-list">
            {documents.map((doc) => (
              <div key={doc.id} className="handbook-doc-row is-static">
                <span className="handbook-doc-kind">{isImage(doc.mimeType) ? 'IMG' : 'PDF'}</span>
                <span className="handbook-doc-body">
                  <span className="handbook-doc-title">
                    {doc.title}
                    {doc.sendOnOnboarding ? (
                      <Badge tone="positive" className="handbook-doc-badge">
                        Onboarding
                      </Badge>
                    ) : null}
                  </span>
                  {doc.description ? <span className="subtle small">{doc.description}</span> : null}
                  <span className="subtle small">
                    {doc.fileName} · {formatBytes(doc.sizeBytes)} · {doc.venue ?? 'All venues'}
                  </span>
                </span>
                <span className="handbook-doc-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      openHandbookDocument(doc).catch((err) =>
                        setFeedback({
                          text: err instanceof Error ? err.message : 'Could not open that document.',
                          tone: 'error'
                        })
                      );
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void patch(doc.id, { sendOnOnboarding: !doc.sendOnOnboarding })}
                  >
                    {doc.sendOnOnboarding ? 'Stop sending' : 'Send with invites'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove(doc)}>
                    Delete
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

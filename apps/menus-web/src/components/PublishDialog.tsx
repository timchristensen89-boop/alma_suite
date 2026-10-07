import { useEffect, useRef } from 'react';
import type { MenuPublishPreview, MenuVersionSummary } from '@alma/shared';
import { Badge, Button, Spinner } from '@alma/ui';
import { DiffView } from './DiffView';

type Props = {
  open: boolean;
  preview: MenuPublishPreview | null;
  loading: boolean;
  publishing: boolean;
  error: string | null;
  publishedVersion: MenuVersionSummary | null;
  draftVersionNumber: number;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Publish confirmation: the server's view of the draft — validation, page
 * fill, and what changed since the version the venue is printing now.
 */
export function PublishDialog({ open, preview, loading, publishing, error, publishedVersion, draftVersionNumber, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const errors = preview?.validation.errors ?? [];
  const warnings = preview?.validation.warnings ?? [];
  const canPublish = Boolean(preview?.canPublish) && !publishing;

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="publish-title">
      <form method="dialog" className="menu-dialog-body" onSubmit={(event) => event.preventDefault()}>
        <header>
          <span className="menu-dialog-eyebrow">Publish</span>
          <h2 id="publish-title">
            Publish v{draftVersionNumber}
            {publishedVersion ? <span className="subtle"> · replaces v{publishedVersion.versionNumber}</span> : <span className="subtle"> · first published version</span>}
          </h2>
        </header>

        {loading || !preview ? (
          <div className="menu-dialog-loading">
            <Spinner label="Checking the draft" />
            <span className="subtle">Checking tags, measuring the page, comparing with the live menu…</span>
          </div>
        ) : (
          <>
            <div className="menu-dialog-status">
              {errors.length ? <Badge tone="danger" dot>{errors.length} error{errors.length === 1 ? '' : 's'}</Badge> : <Badge tone="positive" dot>No errors</Badge>}
              {warnings.length ? <Badge tone="warning" dot>{warnings.length} warning{warnings.length === 1 ? '' : 's'}</Badge> : null}
              {preview.fill ? (
                <Badge tone={preview.fill.overflow ? 'danger' : 'neutral'}>Page {Math.round(preview.fill.fillRatio * 100)}% full</Badge>
              ) : (
                <Badge tone="danger">{preview.renderer.message}</Badge>
              )}
            </div>
            {errors.length ? (
              <ul className="menu-dialog-issues is-error">
                {errors.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
            {warnings.length ? (
              <>
                <ul className="menu-dialog-issues is-warning">
                  {warnings.map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
                <p className="subtle">Publishing accepts these warnings as they are.</p>
              </>
            ) : null}
            <h3>What changes</h3>
            <p className="menu-dialog-summary">{preview.summary}</p>
            <DiffView diff={preview.diff} emptyText="No content changes since the live menu. Publishing regenerates the PDF." />
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}

        <footer className="menu-dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={publishing}>
            Back to editing
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!canPublish}>
            {publishing ? 'Publishing…' : warnings.length ? 'Publish anyway' : 'Publish'}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}

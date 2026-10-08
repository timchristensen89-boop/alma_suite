import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MENU_TEMPLATES, isMenuTemplateKey, type AuthUser, type MenuAuditEntry, type MenuDiff, type MenuSummary, type MenuVersionSummary } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Spinner } from '@alma/ui';
import { DiffView } from '../components/DiffView';
import { ApiError } from '../lib/api';
import { formatBytes, formatDateTime, formatWhen, pdfFilename, personName } from '../lib/format';
import { isMenuArchivedError, menuApi, openVersionPdf } from '../lib/menuApi';
import { IconArrowLeft } from '../../../web/src/lib/icons';

/**
 * History: every version of this menu, its PDF, a diff against what is current
 * (the draft when there is one, else the live version), restore, and the
 * audit log of who changed what and when.
 */
export function HistoryPage({ user }: { user: AuthUser }) {
  const { menuId = '' } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<MenuSummary | null>(null);
  const [versions, setVersions] = useState<MenuVersionSummary[] | null>(null);
  const [audit, setAudit] = useState<MenuAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ versionId: string; against: string; diff: MenuDiff; summary: string; to: MenuVersionSummary | null } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [menu, list, log] = await Promise.all([menuApi.get(menuId), menuApi.listVersions(menuId), menuApi.listAudit(menuId)]);
      setSummary(menu);
      setVersions(list);
      setAudit(log);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the history.');
      setVersions([]);
      setAudit([]);
    }
  }, [menuId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pdf(version: MenuVersionSummary, mode: 'view' | 'download' | 'print') {
    if (!summary) return;
    setBusy(`${mode}-${version.id}`);
    try {
      await openVersionPdf(version.id, mode, pdfFilename(summary, version.versionNumber));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the PDF.');
    } finally {
      setBusy(null);
    }
  }

  async function showDiff(version: MenuVersionSummary) {
    const against = summary?.draft ? 'draft' : 'published';
    setBusy(`diff-${version.id}`);
    try {
      const result = await menuApi.diffVersion(version.id, against);
      setDiff({ versionId: version.id, against, diff: result.diff, summary: result.summary, to: result.to });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not compare.');
    } finally {
      setBusy(null);
    }
  }

  async function restore(version: MenuVersionSummary) {
    const hasDraft = Boolean(summary?.draft);
    const message = hasDraft
      ? `Restore v${version.versionNumber} as a new draft? The current draft v${summary?.draft?.versionNumber} is discarded. v${version.versionNumber} itself is not changed.`
      : `Restore v${version.versionNumber} as a new draft? Nothing changes for the venue until that draft is published.`;
    if (!window.confirm(message)) return;
    setBusy(`restore-${version.id}`);
    try {
      await menuApi.restore(version.id, hasDraft);
      navigate(`/menus/${menuId}/edit`);
    } catch (caught) {
      if (isMenuArchivedError(caught)) {
        setError(caught instanceof Error ? caught.message : 'This menu is archived.');
        await load();
      } else if (caught instanceof ApiError && caught.status === 409 && window.confirm(`${caught.message}\n\nReplace the draft?`)) {
        try {
          await menuApi.restore(version.id, true);
          navigate(`/menus/${menuId}/edit`);
          return;
        } catch (again) {
          setError(again instanceof Error ? again.message : 'Could not restore.');
        }
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not restore.');
      }
    } finally {
      setBusy(null);
    }
  }

  if (versions === null || audit === null) {
    return (
      <div className="menus-loading">
        <Spinner label="Loading history" />
      </div>
    );
  }
  const archived = summary?.status === 'ARCHIVED';

  return (
    <>
      <div className="editor-head">
        <div className="editor-head-titles">
          <Link to="/" className="editor-back">
            <IconArrowLeft /> <span>All menus</span>
          </Link>
          <h1>
            {summary?.venue.name ?? 'Menu'} <em>{summary?.name ?? ''}</em> <span className="subtle">history</span>
            {archived ? <Badge tone="muted">Archived</Badge> : null}
          </h1>
          <p className="subtle">
            {archived
              ? 'This menu is archived: read-only until a publisher unarchives it from the Menus home. Its PDFs and versions are all still here.'
              : 'Every published version keeps its PDF and a frozen copy of its content. Restoring makes a new draft; it never rewrites a version.'}
          </p>
        </div>
        <div className="editor-head-actions">
          {archived ? null : <Link className="btn btn-secondary btn-md" to={`/menus/${menuId}/edit`}><span>{summary?.draft ? 'Open draft' : 'Editor'}</span></Link>}
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      {versions.length === 0 ? (
        <EmptyState title="No versions yet" description="Start a draft from the editor and publish it to create the first version." />
      ) : (
        <ol className="version-list">
          {versions.map((version) => {
            const tone = version.state === 'PUBLISHED' ? 'positive' : version.state === 'DRAFT' ? 'warning' : 'muted';
            const label = version.state === 'PUBLISHED' ? 'Live' : version.state === 'DRAFT' ? 'Draft' : 'Archived';
            return (
              <li key={version.id} className={`version-row is-${version.state.toLowerCase()}`}>
                <div className="version-row-head">
                  <strong>v{version.versionNumber}</strong>
                  <Badge tone={tone} dot>{label}</Badge>
                  {version.restoredFromVersionId ? <span className="subtle">restored from v{versions.find((v) => v.id === version.restoredFromVersionId)?.versionNumber ?? '?'}</span> : null}
                </div>
                <div className="version-row-meta subtle">
                  {version.state === 'DRAFT'
                    ? `Edited ${formatWhen(version.updatedAt)} by ${personName(version.updatedBy)}`
                    : `Published ${formatDateTime(version.publishedAt)} by ${personName(version.publishedBy)}${version.pdfByteSize ? ` · PDF ${formatBytes(version.pdfByteSize)}` : ''}`}
                </div>
                <div className="version-row-actions">
                  {version.state === 'DRAFT' ? (
                    archived ? (
                      <span className="subtle">Kept with the archived menu. Unarchive the menu to carry on with it.</span>
                    ) : (
                      <Link className="btn btn-primary btn-sm" to={`/menus/${menuId}/edit`}><span>Open in editor</span></Link>
                    )
                  ) : (
                    <>
                      {version.hasPdf ? (
                        <>
                          <Button size="sm" onClick={() => void pdf(version, 'view')} disabled={busy === `view-${version.id}`}>View PDF</Button>
                          <Button size="sm" variant="secondary" onClick={() => void pdf(version, 'download')} disabled={busy === `download-${version.id}`}>Download</Button>
                          <Button size="sm" variant="secondary" onClick={() => void pdf(version, 'print')} disabled={busy === `print-${version.id}`}>Print</Button>
                        </>
                      ) : (
                        <span className="subtle">No PDF stored</span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void showDiff(version)} disabled={busy === `diff-${version.id}`}>
                        Diff against {summary?.draft ? 'draft' : 'live'}
                      </Button>
                      {archived ? null : (
                        <Button size="sm" variant="ghost" onClick={() => void restore(version)} disabled={busy === `restore-${version.id}`}>
                          Restore as new draft
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {diff?.versionId === version.id ? (
                  <div className="version-diff">
                    <div className="version-diff-head">
                      <strong>
                        v{version.versionNumber} → {diff.to ? `v${diff.to.versionNumber} (${diff.against === 'draft' ? 'current draft' : 'live'})` : 'current'}
                      </strong>
                      <span className="subtle">{diff.summary}</span>
                      <button type="button" className="item-action" onClick={() => setDiff(null)}>Close</button>
                    </div>
                    <DiffView diff={diff.diff} emptyText="Identical content." templateTitle={summary && isMenuTemplateKey(summary.templateKey) ? MENU_TEMPLATES[summary.templateKey].title : undefined} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <Card title="Audit log" subtitle="Who changed what, and when. Newest first.">
        {audit.length === 0 ? (
          <p className="subtle">Nothing yet.</p>
        ) : (
          <ul className="audit-list">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="audit-when">{formatDateTime(entry.createdAt)}</span>
                <span className={`audit-action is-${entry.action.replace('.', '-')}`}>{entry.action}</span>
                <span className="audit-summary">{entry.summary}</span>
                <span className="audit-who subtle">{entry.actor.name ?? entry.actor.email ?? 'unknown'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="subtle menus-footnote">Signed in as {user.firstName} {user.lastName}.</p>
    </>
  );
}

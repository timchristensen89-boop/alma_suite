import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthUser, MenuSummary } from '@alma/shared';
import { AlmaHomeBubble, Badge, Button, Card, EmptyState, MenuIcon, Skeleton } from '@alma/ui';
import { ApiError } from '../lib/api';
import { menuApi, openVersionPdf } from '../lib/menuApi';
import { formatWhen, pdfFilename, personName } from '../lib/format';

/**
 * Module home: one card per venue menu — what is live, who last touched it,
 * and whether an unpublished draft is waiting.
 */
export function HomePage({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  const [menus, setMenus] = useState<MenuSummary[] | null>(null);
  const [renderer, setRenderer] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await menuApi.list();
      setMenus(data.menus);
      setRenderer(data.renderer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the menus.');
      setMenus([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startDraft(menu: MenuSummary) {
    setBusy(menu.id);
    try {
      await menuApi.createDraft(menu.id);
      navigate(`/menus/${menu.id}/edit`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        navigate(`/menus/${menu.id}/edit`);
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Could not start a draft.');
    } finally {
      setBusy(null);
    }
  }

  async function openPdf(menu: MenuSummary) {
    if (!menu.published) return;
    setBusy(`pdf-${menu.id}`);
    try {
      await openVersionPdf(menu.published.id, 'view', pdfFilename(menu, menu.published.versionNumber));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the PDF.');
    } finally {
      setBusy(null);
    }
  }

  const drafts = menus?.filter((menu) => menu.draft).length ?? 0;

  return (
    <>
      <AlmaHomeBubble
        app="menus"
        appName="Menus"
        appIcon={<MenuIcon />}
        eyebrow="Printed menus"
        description="Edit the food menus for each venue, see the A4 page as you type, and publish the PDF the venue prints. Layout is locked; content is yours."
        statusLabel={menus === null ? 'Loading…' : drafts > 0 ? `${drafts} unpublished draft${drafts === 1 ? '' : 's'}` : 'Everything published'}
        statusHint={renderer ? (renderer.ok ? 'PDF renderer ready' : renderer.message) : undefined}
        statusDot={renderer && !renderer.ok ? 'amber' : drafts > 0 ? 'amber' : 'forest'}
      />

      {error ? <p className="error-text">{error}</p> : null}
      {renderer && !renderer.ok ? (
        <Card title="Publishing is paused" subtitle="Drafts can still be edited and saved.">
          <p className="subtle">{renderer.message}</p>
        </Card>
      ) : null}

      {menus === null ? (
        <div className="menus-grid">
          <Skeleton height="220px" />
          <Skeleton height="220px" />
        </div>
      ) : menus.length === 0 ? (
        <EmptyState
          title="No menus yet"
          description="Menus are created by the seed (pnpm db:seed:menus) — one per venue, locked to its print template. Nothing to edit until then."
        />
      ) : (
        <div className="menus-grid">
          {menus.map((menu) => (
            <Card key={menu.id} className="menu-card" title={menu.venue.name} subtitle={`${menu.name} · ${menu.templateKey.replace(/_/g, ' ')}`}>
              <dl className="menu-card-facts">
                <div>
                  <dt>Live</dt>
                  <dd>
                    {menu.published ? (
                      <>
                        <Badge tone="positive" dot>v{menu.published.versionNumber}</Badge>
                        <span className="subtle"> published {formatWhen(menu.published.publishedAt)} by {personName(menu.published.publishedBy)}</span>
                      </>
                    ) : (
                      <Badge tone="muted">Nothing published yet</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Draft</dt>
                  <dd>
                    {menu.draft ? (
                      <>
                        <Badge tone="warning" dot>v{menu.draft.versionNumber} in progress</Badge>
                        <span className="subtle"> edited {formatWhen(menu.draft.updatedAt)} by {personName(menu.draft.updatedBy)}</span>
                      </>
                    ) : (
                      <span className="subtle">No unpublished changes</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last edited</dt>
                  <dd className="subtle">{menu.lastEdited ? `${formatWhen(menu.lastEdited.at)} by ${personName(menu.lastEdited.by)}` : '—'}</dd>
                </div>
              </dl>
              <div className="menu-card-actions">
                {menu.draft ? (
                  <Button onClick={() => navigate(`/menus/${menu.id}/edit`)}>Continue draft</Button>
                ) : (
                  <Button onClick={() => void startDraft(menu)} disabled={busy === menu.id}>
                    {busy === menu.id ? 'Starting…' : menu.published ? 'Start a draft' : 'Start the first draft'}
                  </Button>
                )}
                <Link className="btn btn-secondary btn-md" to={`/menus/${menu.id}/history`}>
                  <span>History</span>
                </Link>
                {menu.published ? (
                  <Button variant="ghost" onClick={() => void openPdf(menu)} disabled={busy === `pdf-${menu.id}`}>
                    {busy === `pdf-${menu.id}` ? 'Opening…' : 'Open PDF'}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="subtle menus-footnote">
        Signed in as {user.firstName} {user.lastName}. {user.role === 'STAFF' ? 'You can draft; a manager or the head chef publishes.' : 'You can draft and publish.'}
      </p>
    </>
  );
}

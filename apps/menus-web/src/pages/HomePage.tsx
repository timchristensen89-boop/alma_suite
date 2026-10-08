import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canPublishMenus, type AuthUser, type MenuListPayload, type MenuSummary, type MenuVenueSummary } from '@alma/shared';
import { AlmaHomeBubble, Badge, Button, Card, EmptyState, MenuIcon, Skeleton } from '@alma/ui';
import { ArchiveMenuDialog, NewMenuDialog, RenameMenuDialog } from '../components/MenuManageDialogs';
import { ApiError } from '../lib/api';
import { isMenuArchivedError, menuApi, openVersionPdf } from '../lib/menuApi';
import { formatWhen, pdfFilename, personName } from '../lib/format';
import { IconPlus } from '../../../web/src/lib/icons';

/**
 * Module home: the venues, and under each one a card per menu — the à la
 * carte, a Tuesday menu, an event menu — with what is live, who last touched
 * it, and whether an unpublished draft is waiting. Publishers add, rename and
 * archive menus from here; archived menus sit in a list at the bottom and can
 * be unarchived.
 */

type VenueGroup = { venue: MenuVenueSummary; menus: MenuSummary[] };

/** Under the menu's name: what its page is headed, and the template only when the venue has more than one. */
function cardSubtitle(menu: MenuSummary, venue: MenuVenueSummary | undefined): string {
  const heading = `Headed “${menu.printedHeading}”`;
  if (!venue || venue.templates.length < 2) return heading;
  const label = venue.templates.find((template) => template.key === menu.templateKey)?.label ?? menu.templateKey.replace(/_/g, ' ');
  return `${heading} · ${label}`;
}

export function HomePage({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  const [data, setData] = useState<MenuListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newMenuFor, setNewMenuFor] = useState<{ venueId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<MenuSummary | null>(null);
  const [archiving, setArchiving] = useState<MenuSummary | null>(null);
  const canManage = canPublishMenus(user);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await menuApi.list());
      setLoadFailed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the menus.');
      // Keep what was on screen; with nothing loaded yet, say so plainly rather than "no menus".
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One group per venue that has menus or could have one (a print template exists for it).
  const groups = useMemo<VenueGroup[]>(() => {
    if (!data) return [];
    const byVenue = new Map<string, VenueGroup>();
    // `?? []` so a home built against an API that predates venues/archived still renders its menus.
    for (const venue of data.venues ?? []) byVenue.set(venue.id, { venue, menus: [] });
    for (const menu of data.menus ?? []) {
      const group = byVenue.get(menu.venue.id) ?? { venue: { ...menu.venue, templates: [] }, menus: [] };
      group.menus.push(menu);
      byVenue.set(menu.venue.id, group);
    }
    return [...byVenue.values()].filter((group) => group.menus.length > 0 || group.venue.templates.length > 0);
  }, [data]);
  const venueById = useMemo(() => new Map((data?.venues ?? []).map((venue) => [venue.id, venue])), [data]);
  const anyAddable = (data?.venues ?? []).some((venue) => venue.templates.length > 0);

  async function startDraft(menu: MenuSummary) {
    setBusy(menu.id);
    try {
      await menuApi.createDraft(menu.id);
      navigate(`/menus/${menu.id}/edit`);
    } catch (caught) {
      if (isMenuArchivedError(caught)) {
        // Archived since this page loaded: say so and show the list as it is now.
        setError(caught instanceof Error ? caught.message : 'That menu was archived.');
        await load();
        return;
      }
      if (caught instanceof ApiError && caught.status === 409 && menu.status === 'ACTIVE') {
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

  async function unarchive(menu: MenuSummary) {
    setBusy(`unarchive-${menu.id}`);
    setError(null);
    setNotice(null);
    try {
      await menuApi.unarchive(menu.id);
      setNotice(`${menu.venue.name} · ${menu.name} is back on the home.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not unarchive the menu.');
    } finally {
      setBusy(null);
    }
  }

  const drafts = data?.menus.filter((menu) => menu.draft).length ?? 0;
  const renderer = data?.renderer ?? null;
  const archived = data?.archived ?? [];

  function card(menu: MenuSummary) {
    const venue = venueById.get(menu.venue.id);
    return (
      <Card
        key={menu.id}
        className="menu-card"
        title={menu.name}
        subtitle={cardSubtitle(menu, venue)}
        action={
          canManage ? (
            <div className="menu-card-manage">
              <button type="button" className="item-action" aria-label={`Rename ${menu.venue.name} · ${menu.name}`} onClick={() => { setNotice(null); setRenaming(menu); }}>Rename</button>
              <button type="button" className="item-action" aria-label={`Archive ${menu.venue.name} · ${menu.name}`} onClick={() => { setNotice(null); setArchiving(menu); }}>Archive</button>
            </div>
          ) : undefined
        }
      >
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
    );
  }

  return (
    <>
      <AlmaHomeBubble
        app="menus"
        appName="Menus"
        appIcon={<MenuIcon />}
        eyebrow="Printed menus"
        description="Edit each venue's printed menus — the à la carte, a Tuesday menu, an event menu — see the A4 page as you type, and publish the PDF the venue prints. Layout is locked; content is yours."
        statusLabel={data === null ? 'Loading…' : drafts > 0 ? `${drafts} unpublished draft${drafts === 1 ? '' : 's'}` : 'Everything published'}
        statusHint={renderer ? (renderer.ok ? 'PDF renderer ready' : renderer.message) : undefined}
        statusDot={renderer && !renderer.ok ? 'amber' : drafts > 0 ? 'amber' : 'forest'}
      />

      {error ? <p className="error-text">{error}</p> : null}
      <p className="notice-text" role="status" hidden={!notice}>{notice}</p>
      {renderer && !renderer.ok ? (
        <Card title="Publishing is paused" subtitle="Drafts can still be edited and saved.">
          <p className="subtle">{renderer.message}</p>
        </Card>
      ) : null}

      {data === null && loadFailed ? (
        <EmptyState title="Could not load the menus" description="Nothing has changed on the server. Check the connection and try again." action={<Button onClick={() => void load()}>Try again</Button>} />
      ) : data === null ? (
        <div className="menus-grid">
          <Skeleton height="220px" />
          <Skeleton height="220px" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No menus yet"
          description={
            anyAddable
              ? 'Add the first menu for a venue, or run the seed (pnpm db:seed:menus) for the current printed menus.'
              : 'No venue has a print template yet. Templates are code (packages/shared/src/menu-render.ts); the seed (pnpm db:seed:menus) creates the venues and their menus.'
          }
          action={canManage && anyAddable ? <Button leftIcon={<IconPlus />} onClick={() => { setNotice(null); setNewMenuFor({ venueId: null }); }}>New menu</Button> : undefined}
        />
      ) : (
        groups.map((group) => (
          <section key={group.venue.id} className="menus-venue" aria-labelledby={`venue-${group.venue.id}`}>
            <header className="menus-venue-head">
              <h2 id={`venue-${group.venue.id}`}>{group.venue.name}</h2>
              <span className="subtle menus-venue-count">{group.menus.length === 1 ? '1 menu' : `${group.menus.length} menus`}</span>
              {canManage && group.venue.templates.length > 0 ? (
                <Button size="sm" variant="secondary" className="menus-venue-add" leftIcon={<IconPlus />} onClick={() => { setNotice(null); setNewMenuFor({ venueId: group.venue.id }); }}>
                  New menu
                </Button>
              ) : null}
            </header>
            {group.menus.length === 0 ? (
              <p className="subtle">No menus for {group.venue.name} yet.{canManage ? ' Add one above.' : ' A manager or the head chef can add one.'}</p>
            ) : (
              <div className="menus-grid">{group.menus.map(card)}</div>
            )}
          </section>
        ))
      )}

      {archived.length > 0 ? (
        <Card title={`Archived menus (${archived.length})`} subtitle="Off the home and read-only. History and PDFs stay; a publisher can unarchive one.">
          <ul className="archived-list">
            {archived.map((menu) => (
              <li key={menu.id} className="archived-row">
                <strong>
                  {menu.venue.name} · {menu.name}
                </strong>
                <span className="subtle">
                  {menu.published ? `last live v${menu.published.versionNumber}` : 'never published'}
                  {menu.draft ? ` · draft v${menu.draft.versionNumber} kept` : ''}
                </span>
                <div className="archived-row-actions">
                  <Link className="btn btn-secondary btn-sm" to={`/menus/${menu.id}/history`}>
                    <span>History</span>
                  </Link>
                  {canManage ? (
                    <Button size="sm" variant="ghost" onClick={() => void unarchive(menu)} disabled={busy === `unarchive-${menu.id}`}>
                      {busy === `unarchive-${menu.id}` ? 'Unarchiving…' : 'Unarchive'}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="subtle menus-footnote">
        Signed in as {user.firstName} {user.lastName}. {canManage ? 'You can draft, publish, and add or archive menus.' : 'You can draft; a manager or the head chef publishes and manages the list of menus.'}
      </p>

      {newMenuFor ? (
        <NewMenuDialog
          venues={data?.venues ?? []}
          menus={data?.menus ?? []}
          initialVenueId={newMenuFor.venueId}
          onCreated={(menu) => {
            setNewMenuFor(null);
            navigate(`/menus/${menu.id}/edit`);
          }}
          onClose={() => setNewMenuFor(null)}
        />
      ) : null}
      {renaming ? (
        <RenameMenuDialog
          menu={renaming}
          onDone={(menu) => {
            setRenaming(null);
            setNotice(`Renamed to ${menu.venue.name} · ${menu.name}.`);
            void load();
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {archiving ? (
        <ArchiveMenuDialog
          menu={archiving}
          onDone={(menu) => {
            setArchiving(null);
            setNotice(`${menu.venue.name} · ${menu.name} archived. It is in the list at the bottom if you need it back.`);
            void load();
          }}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}

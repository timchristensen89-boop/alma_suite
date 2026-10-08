import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MENU_KINDS,
  MENU_KIND_LABELS,
  canPublishMenus,
  describeMenuFormat,
  getMenuTemplate,
  isMenuTemplateKey,
  type AuthUser,
  type MenuKind,
  type MenuListPayload,
  type MenuSummary,
  type MenuTemplate,
  type MenuVenueSummary
} from '@alma/shared';
import { AlmaHomeBubble, Badge, Button, Card, EmptyState, MenuIcon, Skeleton } from '@alma/ui';
import { ArchiveMenuDialog, MenuDetailsDialog, NewMenuDialog, menuKindGroupLabel } from '../components/MenuManageDialogs';
import { ApiError } from '../lib/api';
import { isMenuArchivedError, menuApi, openVersionPdf } from '../lib/menuApi';
import { formatEventDate, formatWhen, pdfFilename, personName } from '../lib/format';
import { IconPlus } from '../../../web/src/lib/icons';

/**
 * Module home: the venues, and under each one its menus grouped by kind —
 * food, drinks, functions, promotions, private events — with what is live,
 * who last touched it, and whether an unpublished draft is waiting.
 * Publishers add menus, edit their details and archive them from here;
 * archived menus sit in a list at the bottom and can be unarchived.
 */

type VenueGroup = { venue: MenuVenueSummary; menus: MenuSummary[] };
type KindGroup = { kind: MenuKind; menus: MenuSummary[] };

function menuKind(menu: MenuSummary): MenuKind {
  return menu.kind ?? 'FOOD';
}

function templateOf(menu: MenuSummary): MenuTemplate | null {
  return isMenuTemplateKey(menu.templateKey) ? getMenuTemplate(menu.templateKey) : null;
}

/** The venue's menus in MENU_KINDS order, kinds without a menu left out. */
function byKind(menus: MenuSummary[]): KindGroup[] {
  return MENU_KINDS.map((kind) => ({ kind, menus: menus.filter((menu) => menuKind(menu) === kind) })).filter((group) => group.menus.length > 0);
}

/** Under the menu's name: what its page is headed, and the template only when the venue has more than one for this kind. */
function cardSubtitle(menu: MenuSummary, venue: MenuVenueSummary | undefined): string {
  const heading = `Headed “${menu.printedHeading}”`;
  const kind = menuKind(menu);
  const forKind = (venue?.templates ?? []).filter((template) => (template.kinds?.length ? template.kinds : ['FOOD']).includes(kind));
  if (forKind.length < 2) return heading;
  const label = forKind.find((template) => template.key === menu.templateKey)?.label ?? menu.templateKey.replace(/_/g, ' ');
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
  const [editing, setEditing] = useState<MenuSummary | null>(null);
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
    const kind = menuKind(menu);
    const template = templateOf(menu);
    const pageCount = menu.published?.pageCount ?? menu.draft?.pageCount ?? 1;
    const isPrivate = (menu.visibility ?? 'PUBLIC') === 'PRIVATE';
    const event = menu.event ?? null;
    const eventLine =
      kind === 'PRIVATE_EVENT' && event
        ? [event.eventName, formatEventDate(event.eventDate) || null, event.guestCount ? `${event.guestCount} guests` : null].filter(Boolean).join(' · ')
        : '';
    return (
      <Card
        key={menu.id}
        className={`menu-card is-kind-${kind.toLowerCase()}`}
        title={menu.name}
        subtitle={cardSubtitle(menu, venue)}
        action={
          canManage ? (
            <div className="menu-card-manage">
              <button type="button" className="item-action" aria-label={`Rename ${menu.venue.name} · ${menu.name}`} onClick={() => { setNotice(null); setEditing(menu); }}>Rename</button>
              <button type="button" className="item-action" aria-label={`Archive ${menu.venue.name} · ${menu.name}`} onClick={() => { setNotice(null); setArchiving(menu); }}>Archive</button>
            </div>
          ) : undefined
        }
      >
        <div className="menu-card-meta">
          <Badge tone="neutral">{MENU_KIND_LABELS[kind]}</Badge>
          {template ? <span className="subtle menu-card-format">{describeMenuFormat(template.format, pageCount)}</span> : null}
          {isPrivate ? <Badge tone="muted">Private</Badge> : null}
          {template && template.venueSlug === null ? <Badge tone="info">Both venues</Badge> : null}
        </div>
        <dl className="menu-card-facts">
          {kind === 'PRIVATE_EVENT' ? (
            <div>
              <dt>Event</dt>
              <dd className={eventLine ? '' : 'subtle'}>{eventLine || 'No date yet — add it under Rename.'}</dd>
            </div>
          ) : null}
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
        description="Edit each venue's printed menus — the à la carte, the drinks book, functions packs, promotions and event menus — see every page as you type, and publish the PDF the venue prints. Layout is locked; content is yours."
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
              byKind(group.menus).map((kindGroup) => (
                <div key={kindGroup.kind} className={`menus-kind is-${kindGroup.kind.toLowerCase()}`} aria-labelledby={`venue-${group.venue.id}-${kindGroup.kind}`}>
                  <h3 id={`venue-${group.venue.id}-${kindGroup.kind}`} className="menus-kind-head">
                    {menuKindGroupLabel(kindGroup.kind)}
                    <span className="subtle menus-kind-count">{kindGroup.menus.length}</span>
                  </h3>
                  <div className="menus-grid">{kindGroup.menus.map(card)}</div>
                </div>
              ))
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
                  {MENU_KIND_LABELS[menuKind(menu)].toLowerCase()}
                  {menu.published ? ` · last live v${menu.published.versionNumber}` : ' · never published'}
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
      {editing ? (
        <MenuDetailsDialog
          menu={editing}
          onDone={(menu, changed) => {
            setEditing(null);
            setNotice(changed.renamed ? `Renamed to ${menu.venue.name} · ${menu.name}.` : `${menu.venue.name} · ${menu.name} updated.`);
            void load();
          }}
          onClose={() => setEditing(null)}
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

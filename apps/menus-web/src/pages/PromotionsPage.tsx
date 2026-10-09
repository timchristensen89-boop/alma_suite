import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canPublishMenus, PROMOTION_LIMITS, PROMOTION_STATUS_LABELS, type AuthUser, type MenuSummary, type PromotionListPayload, type PromotionSummary } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton } from '@alma/ui';
import { menuApi } from '../lib/menuApi';
import { promotionApi } from '../lib/promotionApi';
import { formatWhen, personName } from '../lib/format';
import { IconPlus } from '../../../web/src/lib/icons';
import '../promotions.css';

/**
 * What's On: every promotion (happy hour, bottomless, Taco Tuesday…) with
 * what the website shows, whether edits are waiting to be published, and the
 * printed card it belongs with. Publishers add promotions here; everyone with
 * Menus access opens one to edit its listing.
 */

type VenueGroup = { venue: PromotionSummary['venue']; promotions: PromotionSummary[] };

function statusTone(status: PromotionSummary['status']): 'positive' | 'warning' | 'muted' | 'neutral' {
  if (status === 'PUBLISHED') return 'positive';
  if (status === 'HIDDEN') return 'warning';
  if (status === 'ENDED') return 'muted';
  return 'neutral';
}

function cardLine(card: MenuSummary | null): string {
  if (!card) return 'No printed card';
  const live = card.published ? `live v${card.published.versionNumber}` : 'never published';
  const draft = card.draft ? `, draft v${card.draft.versionNumber}` : '';
  return `${card.name} · ${live}${draft}`;
}

export function PromotionsPage({ user }: { user: AuthUser }) {
  const [data, setData] = useState<PromotionListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ venueId: string | null } | null>(null);
  const [venues, setVenues] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const canManage = canPublishMenus(user);
  const canManageVenue = (slug: string) => canPublishMenus(user, slug);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [payload, menus] = await Promise.all([promotionApi.list(), menuApi.list()]);
      setData(payload);
      setVenues((menus.venues ?? []).map((venue) => ({ id: venue.id, name: venue.name, slug: venue.slug })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the promotions.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo<VenueGroup[]>(() => {
    const byVenue = new Map<string, VenueGroup>();
    for (const venue of venues) byVenue.set(venue.id, { venue, promotions: [] });
    for (const promotion of data?.promotions ?? []) {
      const group = byVenue.get(promotion.venue.id) ?? { venue: promotion.venue, promotions: [] };
      group.promotions.push(promotion);
      byVenue.set(promotion.venue.id, group);
    }
    return [...byVenue.values()];
  }, [data, venues]);

  return (
    <>
      <div className="editor-head">
        <div>
          <h1>What’s On</h1>
          <p className="subtle">
            The promotions the website lists — happy hour, bottomless, taco nights. Each one is a listing and, when it prints, a card: the times, price and
            conditions are typed once here and print on the card.
          </p>
        </div>
        {canManage && venues.length ? (
          <Button type="button" onClick={() => setCreating({ venueId: null })}>
            <IconPlus /> New promotion
          </Button>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {notice ? <p className="notice-text">{notice}</p> : null}

      {!data ? (
        <div className="menus-loading">
          <Skeleton height="160px" />
          <Skeleton height="160px" />
        </div>
      ) : groups.every((group) => group.promotions.length === 0) ? (
        <EmptyState
          title="No promotions yet"
          description={canManage ? 'Add the first one: a name, what the website says, when it runs, and whether it prints a card.' : 'A manager or the head chef adds promotions.'}
          action={canManage && venues.length ? <Button type="button" onClick={() => setCreating({ venueId: null })}>New promotion</Button> : undefined}
        />
      ) : (
        groups
          .filter((group) => group.promotions.length > 0 || canManageVenue(group.venue.slug))
          .map((group) => (
            <section key={group.venue.id} className="menus-venue">
              <div className="menus-venue-head">
                <h2>{group.venue.name}</h2>
                <span className="menus-venue-count subtle">{group.promotions.length} promotion{group.promotions.length === 1 ? '' : 's'}</span>
                {canManageVenue(group.venue.slug) ? (
                  <Button type="button" variant="secondary" className="menus-venue-add" onClick={() => setCreating({ venueId: group.venue.id })}>
                    <IconPlus /> New promotion
                  </Button>
                ) : null}
              </div>
              {group.promotions.length === 0 ? (
                <p className="subtle">Nothing yet for {group.venue.name}.</p>
              ) : (
                <div className="promo-grid">
                  {group.promotions.map((promotion) => (
                    <PromotionCard key={promotion.id} promotion={promotion} />
                  ))}
                </div>
              )}
            </section>
          ))
      )}

      {data && data.ended.length ? (
        <section className="archived-list">
          <h2>Ended ({data.ended.length})</h2>
          <ul>
            {data.ended.map((promotion) => (
              <li key={promotion.id} className="archived-row">
                <div>
                  <strong>{promotion.venue.name} · {promotion.name}</strong>
                  <span className="subtle">
                    {' '}
                    {promotion.publication ? `last published ${formatWhen(promotion.publication.publishedAt)} by ${personName(promotion.publication.publishedBy)}` : 'never published'}
                  </span>
                </div>
                <div className="archived-row-actions">
                  <Link to={`/whats-on/${promotion.id}`} className="btn btn-secondary btn-md">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="menus-footnote subtle">
        {canManage ? 'Publishers for the venue publish, hide and end promotions.' : 'You can edit a promotion’s listing; a publisher for the venue publishes it.'}
      </p>

      {creating ? (
        <NewPromotionDialog
          venues={venues}
          unlinkedCards={data?.unlinkedCards ?? []}
          initialVenueId={creating.venueId}
          onCreated={(promotion) => {
            setCreating(null);
            setNotice(`Added ${promotion.venue.name} · ${promotion.name}.`);
            void load();
          }}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </>
  );
}

function PromotionCard({ promotion }: { promotion: PromotionSummary }) {
  const navigate = useNavigate();
  return (
    <Card title={promotion.name} subtitle={promotion.publicTitle && promotion.publicTitle !== promotion.name ? `Listed as “${promotion.publicTitle}”` : undefined} className="promo-card">
      {promotion.image ? <img className="promo-card-photo" src={promotion.image.url} alt={promotion.image.alt} loading="lazy" /> : <div className="promo-card-photo is-empty">No photo</div>}
      <div className="promo-card-meta">
        <Badge tone={statusTone(promotion.status)} dot>
          {PROMOTION_STATUS_LABELS[promotion.status]}
        </Badge>
        {promotion.unpublishedChanges && promotion.status !== 'ENDED' ? <Badge tone="warning">Unpublished changes</Badge> : null}
        {promotion.endsOn ? <Badge tone="neutral">Ends {promotion.endsOn}</Badge> : null}
      </div>
      <p className="promo-card-line">
        <strong>{promotion.dayLabel || '—'}</strong> {promotion.timeLabel ? `· ${promotion.timeLabel}` : ''} · {promotion.priceLabel}
      </p>
      <p className="promo-card-line">Card: {cardLine(promotion.card)}</p>
      <p className="promo-card-line">
        {promotion.publication ? `On the website since ${formatWhen(promotion.publication.publishedAt)} (${personName(promotion.publication.publishedBy)})` : 'Not on the website yet'} · edited{' '}
        {formatWhen(promotion.updatedAt)} by {personName(promotion.updatedBy)}
      </p>
      <div className="promo-card-actions">
        <Button type="button" onClick={() => navigate(`/whats-on/${promotion.id}`)}>
          Open
        </Button>
        {promotion.card ? (
          <Link to={`/menus/${promotion.card.id}/edit`} className="btn btn-secondary btn-md">
            Edit the card
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// New promotion
// ---------------------------------------------------------------------------

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  return ref;
}

type NewPromotionProps = {
  venues: Array<{ id: string; name: string; slug: string }>;
  unlinkedCards: MenuSummary[];
  initialVenueId: string | null;
  onCreated: (promotion: { id: string; name: string; venue: { name: string } }) => void;
  onClose: () => void;
};

function NewPromotionDialog({ venues, unlinkedCards, initialVenueId, onCreated, onClose }: NewPromotionProps) {
  const ref = useModal();
  const navigate = useNavigate();
  const [venueId, setVenueId] = useState(initialVenueId ?? venues[0]?.id ?? '');
  const [name, setName] = useState('');
  const [publicTitle, setPublicTitle] = useState('');
  const [card, setCard] = useState<'new' | 'none' | string>('new');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardsForVenue = unlinkedCards.filter((menu) => menu.venue.id === venueId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !venueId) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await promotionApi.create({
        venueId,
        name: name.trim(),
        publicTitle: publicTitle.trim(),
        createCard: card === 'new',
        menuId: card !== 'new' && card !== 'none' ? card : null
      });
      onCreated(created);
      navigate(`/whats-on/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the promotion.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="new-promotion-heading">
      <form className="menu-dialog-body menu-form" onSubmit={submit}>
        <header>
          <span className="menu-dialog-eyebrow">What’s On</span>
          <h2 id="new-promotion-heading">New promotion</h2>
        </header>
        {venues.length > 1 ? (
          <Select
            id="new-promotion-venue"
            label="Venue"
            value={venueId}
            options={venues.map((venue) => ({ value: venue.id, label: venue.name }))}
            onChange={(event) => {
              setVenueId(event.currentTarget.value);
              setCard('new');
            }}
          />
        ) : null}
        <Input id="new-promotion-name" label="Name" data-autofocus value={name} maxLength={PROMOTION_LIMITS.nameMax} placeholder="Happy hour" hint="What it is called in Menus. The website shows the title below, or this name." onChange={(event) => setName(event.currentTarget.value)} />
        <Input id="new-promotion-title" label="Title on the website" value={publicTitle} maxLength={PROMOTION_LIMITS.titleMax} placeholder={name || 'Happy hour'} onChange={(event) => setPublicTitle(event.currentTarget.value)} />
        <Select
          id="new-promotion-card"
          label="Printed card"
          value={card}
          options={[
            { value: 'new', label: 'Make a new A5 card with the same name' },
            { value: 'none', label: 'No printed card' },
            ...cardsForVenue.map((menu) => ({ value: menu.id, label: `Link the existing card “${menu.name}”` }))
          ]}
          hint="A card prints the promotion’s times, price and conditions; its dishes are edited in the menu editor."
          onChange={(event) => setCard(event.currentTarget.value)}
        />
        {error ? <p className="error-text">{error}</p> : null}
        <footer className="menu-dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !name.trim() || !venueId}>
            {submitting ? 'Adding…' : 'Add and open'}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}

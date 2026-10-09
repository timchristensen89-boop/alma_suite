import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  buildPublicPromotion,
  canPublishMenus,
  formatMenuPrice,
  parseMenuPriceInput,
  PROMOTION_BOOKING_LABELS,
  PROMOTION_BOOKINGS,
  PROMOTION_LIMITS,
  PROMOTION_STATUS_LABELS,
  promotionFieldsSchema,
  validatePromotionFields,
  WEEKDAY_LABELS,
  type AuthUser,
  type MenuAuditEntry,
  type MenuSummary,
  type PromotionDetail,
  type PromotionFields,
  type PromotionPublishPreview,
  type PublicPromotion
} from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Skeleton, Textarea } from '@alma/ui';
import { PromotionPublishDialog } from '../components/PromotionPublishDialog';
import { ApiError } from '../lib/api';
import { menuApi } from '../lib/menuApi';
import { fileToDataUrl, promotionApi } from '../lib/promotionApi';
import { formatWhen, personName } from '../lib/format';
import '../promotions.css';

/**
 * One promotion: the listing the website shows (typed here), its photo, the
 * printed card it belongs with, and publishing. The form is saved on demand
 * (Save), guarded by the server's optimistic lock; the listing preview on the
 * right is built from the form as you type, so what you see is what the
 * website will receive.
 */

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function statusTone(status: PromotionDetail['status']): 'positive' | 'warning' | 'muted' | 'neutral' {
  if (status === 'PUBLISHED') return 'positive';
  if (status === 'HIDDEN') return 'warning';
  if (status === 'ENDED') return 'muted';
  return 'neutral';
}

function sameFields(a: PromotionFields, b: PromotionFields): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function PromotionPage({ user }: { user: AuthUser }) {
  const { promotionId = '' } = useParams();
  const [detail, setDetail] = useState<PromotionDetail | null>(null);
  const canManage = canPublishMenus(user, detail?.venue.slug ?? null);
  const [fields, setFields] = useState<PromotionFields | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinkedCards, setUnlinkedCards] = useState<MenuSummary[]>([]);
  const [audit, setAudit] = useState<MenuAuditEntry[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PromotionPublishPreview | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const adopt = useCallback((next: PromotionDetail) => {
    setDetail(next);
    setFields(next.fields);
    setSaveState('clean');
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [next, list, log] = await Promise.all([promotionApi.get(promotionId), promotionApi.list(), promotionApi.listAudit(promotionId)]);
      adopt(next);
      setUnlinkedCards(list.unlinkedCards);
      setAudit(log.slice(0, 30));
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Could not load the promotion.');
    }
  }, [adopt, promotionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'conflict') return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [saveState]);

  const dirty = Boolean(detail && fields && !sameFields(fields, detail.fields));
  useEffect(() => {
    if (!detail || !fields) return;
    setSaveState((state) => (state === 'saving' || state === 'conflict' ? state : dirty ? 'dirty' : state === 'dirty' ? 'clean' : state));
  }, [detail, fields, dirty]);

  const update = useCallback((mutate: (prev: PromotionFields) => PromotionFields) => {
    setFields((prev) => (prev ? mutate(prev) : prev));
    setNotice(null);
  }, []);

  const issues = useMemo(() => (fields ? validatePromotionFields(fields) : { errors: [], warnings: [] }), [fields]);

  // The listing as the website would receive it, from the form.
  const listing = useMemo<PublicPromotion | null>(() => {
    if (!detail || !fields) return null;
    const parsed = promotionFieldsSchema.safeParse(fields);
    return buildPublicPromotion({
      slug: detail.slug,
      venue: detail.venue,
      fields: parsed.success ? parsed.data : fields,
      image: detail.image ? { url: detail.image.url, width: detail.image.width, height: detail.image.height, alt: detail.image.alt } : null,
      card: detail.listing.card,
      publishedAt: '',
      publicationId: ''
    });
  }, [detail, fields]);

  async function save() {
    if (!detail || !fields || !dirty) return;
    setSaveState('saving');
    setError(null);
    try {
      const parsed = promotionFieldsSchema.safeParse(fields);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Check the highlighted fields.');
        setSaveState('dirty');
        return;
      }
      const next = await promotionApi.update(detail.id, { ...parsed.data, expectedUpdatedAt: detail.updatedAt });
      adopt(next);
      setSaveState('saved');
      setAudit(await promotionApi.listAudit(detail.id).then((log) => log.slice(0, 30)));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && (caught.details as { code?: string } | null)?.code === 'STALE_PROMOTION') {
        setSaveState('conflict');
        setError('Someone else saved this promotion after you opened it. Reload to see their changes; your edits here are kept until you do.');
        return;
      }
      setSaveState('dirty');
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    }
  }

  async function reloadKeepingEdits() {
    if (!detail) return;
    const edits = fields;
    const next = await promotionApi.get(detail.id);
    setDetail(next);
    setFields(edits);
    setSaveState('dirty');
    setError(null);
  }

  async function choosePhoto(file: File | undefined) {
    if (!file || !detail) return;
    if (file.size > PROMOTION_LIMITS.imageBytesMax) {
      setError(`That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. Listing photos are limited to ${PROMOTION_LIMITS.imageBytesMax / 1024 / 1024} MB — export a smaller JPEG.`);
      return;
    }
    setBusy('photo');
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const next = await promotionApi.setImage(detail.id, { dataUrl, fileName: file.name, alt: detail.image?.alt ?? '' });
      setDetail(next);
      setNotice('Photo saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the photo.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function savePhotoAlt(alt: string) {
    if (!detail?.image) return;
    setBusy('photo-alt');
    try {
      // Re-sending the same bytes keeps the same stored photo; only the description changes.
      const response = await fetch(detail.image.url);
      const blob = await response.blob();
      const dataUrl = await fileToDataUrl(new File([blob], detail.image.fileName, { type: detail.image.mimeType }));
      setDetail(await promotionApi.setImage(detail.id, { dataUrl, fileName: detail.image.fileName, alt }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the photo description.');
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    if (!detail) return;
    setBusy('photo');
    try {
      setDetail(await promotionApi.removeImage(detail.id));
      setNotice('Photo removed. It stays on earlier publications.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the photo.');
    } finally {
      setBusy(null);
    }
  }

  async function linkCard(menuId: string | null) {
    if (!detail) return;
    setBusy('card');
    setError(null);
    try {
      const next = await promotionApi.update(detail.id, { menuId, expectedUpdatedAt: dirty ? undefined : detail.updatedAt });
      setDetail(next);
      if (!dirty) setFields(next.fields);
      setUnlinkedCards((await promotionApi.list()).unlinkedCards);
      setNotice(menuId ? `Linked the card “${next.card?.name ?? ''}”. Its times, price and conditions now come from this promotion.` : 'Card unlinked.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the card.');
    } finally {
      setBusy(null);
    }
  }

  async function makeCard() {
    if (!detail) return;
    setBusy('card');
    setError(null);
    try {
      const card = await menuApi.create({ venueId: detail.venue.id, name: detail.name, kind: 'PROMOTION', heading: detail.publicTitle || detail.name });
      await linkCard(card.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not make the card.');
      setBusy(null);
    }
  }

  async function openPublish() {
    if (!detail) return;
    if (dirty) {
      await save();
    }
    setPublishOpen(true);
    setPublishLoading(true);
    setPublishError(null);
    setPublishPreview(null);
    try {
      setPublishPreview(await promotionApi.publishPreview(detail.id));
    } catch (caught) {
      setPublishError(caught instanceof Error ? caught.message : 'Could not check the promotion.');
    } finally {
      setPublishLoading(false);
    }
  }

  async function confirmPublish() {
    if (!detail) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const next = await promotionApi.publish(detail.id, { acknowledgeWarnings: true, expectedUpdatedAt: detail.updatedAt });
      adopt(next);
      setPublishOpen(false);
      setNotice(next.card ? `Published. The website lists it and the card “${next.card.name}” prints the same details.` : 'Published. The website lists it.');
      setAudit(await promotionApi.listAudit(detail.id).then((log) => log.slice(0, 30)));
    } catch (caught) {
      if (caught instanceof ApiError && caught.details && typeof caught.details === 'object' && 'validation' in caught.details) {
        setPublishError(caught.message);
        try {
          setPublishPreview(await promotionApi.publishPreview(detail.id));
        } catch {
          /* the message above already says what failed */
        }
      } else {
        setPublishError(caught instanceof Error ? caught.message : 'Could not publish.');
      }
    } finally {
      setPublishing(false);
    }
  }

  async function setStatus(action: 'hide' | 'show' | 'end') {
    if (!detail) return;
    if (action === 'end' && !window.confirm(`End “${detail.name}”? It comes off the website and moves to the ended list. You can show it again later.`)) return;
    setBusy(action);
    setError(null);
    try {
      const next = await (action === 'hide' ? promotionApi.hide(detail.id) : action === 'show' ? promotionApi.show(detail.id) : promotionApi.end(detail.id));
      setDetail(next);
      if (!dirty) setFields(next.fields);
      setNotice(action === 'hide' ? 'Hidden from the website. The last publication is kept.' : action === 'show' ? 'Back on the website.' : 'Ended.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the status.');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <EmptyState
        title="Could not load this promotion"
        description={loadError}
        action={
          <Link to="/whats-on" className="btn btn-secondary btn-md">
            Back to What’s On
          </Link>
        }
      />
    );
  }
  if (!detail || !fields) {
    return (
      <div className="menus-loading">
        <Skeleton height="48px" />
        <Skeleton height="320px" />
      </div>
    );
  }

  const card = detail.card;
  const cardsForVenue = unlinkedCards.filter((menu) => menu.venue.id === detail.venue.id);
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? `Saved ${formatWhen(detail.updatedAt)}` : saveState === 'conflict' ? 'Not saved — someone else saved first' : dirty ? 'Unsaved changes' : `Saved ${formatWhen(detail.updatedAt)}`;

  return (
    <>
      <div className="editor-head">
        <div>
          <Link to="/whats-on" className="editor-back">
            ← What’s On
          </Link>
          <h1>
            {detail.venue.name} · {detail.name}
          </h1>
          <p className="subtle">
            <Badge tone={statusTone(detail.status)} dot>
              {PROMOTION_STATUS_LABELS[detail.status]}
            </Badge>{' '}
            {detail.publication ? `On the website since ${formatWhen(detail.publication.publishedAt)} (publication #${detail.publication.number}, ${personName(detail.publication.publishedBy)}).` : 'Not on the website yet.'}{' '}
            {detail.unpublishedChanges && detail.status !== 'ENDED' ? 'There are changes the website has not seen.' : ''}
          </p>
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <span className={`editor-save-state is-${saveState}`}>{saveLabel}</span>
          {issues.errors.length ? <Badge tone="danger">{issues.errors.length} to fix</Badge> : null}
        </div>
        <div className="editor-toolbar-right">
          {saveState === 'conflict' ? (
            <Button type="button" variant="secondary" onClick={() => void reloadKeepingEdits()}>
              Reload their changes
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => void save()} disabled={!dirty || saveState === 'saving'}>
            Save
          </Button>
          {canManage ? (
            <>
              {detail.status === 'PUBLISHED' ? (
                <Button type="button" variant="secondary" onClick={() => void setStatus('hide')} disabled={busy !== null}>
                  Hide from website
                </Button>
              ) : detail.publication && detail.status !== 'ENDED' ? (
                <Button type="button" variant="secondary" onClick={() => void setStatus('show')} disabled={busy !== null}>
                  Show on website
                </Button>
              ) : null}
              {detail.status !== 'ENDED' ? (
                <Button type="button" variant="secondary" onClick={() => void setStatus('end')} disabled={busy !== null}>
                  End
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={() => void setStatus('show')} disabled={busy !== null || !detail.publication}>
                  Show again
                </Button>
              )}
              <Button type="button" onClick={() => void openPublish()} disabled={busy !== null || saveState === 'saving' || saveState === 'conflict'}>
                Publish…
              </Button>
            </>
          ) : (
            <span className="subtle">Managers and the head chef publish.</span>
          )}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {notice ? <p className="notice-text">{notice}</p> : null}

      <div className="promo-split">
        <div className="promo-form">
          <Card title="Listing" subtitle="What the website’s What’s On shows. The time line, price and conditions also print on the card.">
            <div className="promo-form-row">
              <Input label="Name in Menus" value={fields.name} maxLength={PROMOTION_LIMITS.nameMax} onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, name: value })); }} />
              <Input label="Title on the website" value={fields.publicTitle} maxLength={PROMOTION_LIMITS.titleMax} placeholder={fields.name} onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, publicTitle: value })); }} />
            </div>
            <Textarea label="Description" rows={3} value={fields.summary} maxLength={PROMOTION_LIMITS.summaryMax} placeholder="Early drinks, snacks and Avalon afternoons that roll into dinner." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, summary: value })); }} />
            <div className="promo-form-row is-three">
              <Input label="Day label" value={fields.dayLabel} maxLength={PROMOTION_LIMITS.dayLabelMax} placeholder="Wed–Sun" hint="Large, in the listing’s date column." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, dayLabel: value })); }} />
              <Input label="Cadence" value={fields.cadenceLabel} maxLength={PROMOTION_LIMITS.cadenceLabelMax} placeholder="Weekly" hint="Small, beside the day label." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, cadenceLabel: value })); }} />
              <Input label="Start time" type="time" value={fields.startTime ?? ''} hint="Pre-filled on the booking link." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, startTime: value || null })); }} />
            </div>
            <Input label="Time line" value={fields.timeLabel} maxLength={PROMOTION_LIMITS.timeLabelMax} placeholder="Wed–Thu · 5–6pm · Fri–Sun · 4–6pm" hint="Shown on the listing and printed as the card’s when-line." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, timeLabel: value })); }} />
            <div className="field">
              <span className="field-label">Weekdays it runs</span>
              <div className="promo-weekdays" role="group" aria-label="Weekdays">
                {WEEK_ORDER.map((day) => {
                  const on = fields.validDays.includes(day);
                  return (
                    <label key={day} className={`promo-weekday ${on ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => update((prev) => ({ ...prev, validDays: on ? prev.validDays.filter((d) => d !== day) : [...prev.validDays, day].sort((a, b) => a - b) }))} />
                      {WEEKDAY_LABELS[day]}
                    </label>
                  );
                })}
              </div>
              <span className="field-hint">The booking button picks the next of these days.</span>
            </div>
            <div className="promo-form-row">
              <Input label="Starts on" type="date" value={fields.startsOn ?? ''} hint="Blank: already running." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, startsOn: value || null })); }} />
              <Input label="Ends on" type="date" value={fields.endsOn ?? ''} hint="Blank: open-ended. The website drops it the day after." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, endsOn: value || null })); }} />
            </div>
          </Card>

          <Card title="Price and conditions" subtitle="Typed once: the listing shows them and the card prints them.">
            <div className="promo-form-row is-three">
              <PriceField cents={fields.heroPriceCents} unit={fields.heroPriceUnit} onChange={(cents, unit) => update((prev) => ({ ...prev, heroPriceCents: cents, heroPriceUnit: unit }))} />
              <Input label="Price label on the website" value={fields.priceLabel} maxLength={PROMOTION_LIMITS.priceLabelMax} placeholder={listing?.priceLabel ?? 'Walk-in'} hint="Blank shows the price above, or “Walk-in” without one." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, priceLabel: value })); }} />
            </div>
            <Textarea label="Conditions" rows={3} value={fields.conditions} maxLength={PROMOTION_LIMITS.conditionsMax} placeholder={'Two hours from your sitting time.\nThe whole table takes part.'} hint="One per line. Printed small at the foot of the card." onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, conditions: value })); }} />
          </Card>

          <Card title="Booking button">
            <Select
              label="Where it goes"
              value={fields.bookDestination}
              options={PROMOTION_BOOKINGS.map((value) => ({ value, label: PROMOTION_BOOKING_LABELS[value] }))}
              onChange={(event) => { const value = event.currentTarget.value as PromotionFields['bookDestination']; update((prev) => ({ ...prev, bookDestination: value })); }}
            />
            {fields.bookDestination !== 'NONE' ? (
              <div className="promo-form-row">
                <Input label="Button label" value={fields.bookLabel} maxLength={PROMOTION_LIMITS.bookLabelMax} placeholder="Reserve" onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, bookLabel: value })); }} />
                {fields.bookDestination === 'URL' ? (
                  <Input label="Link" type="url" value={fields.bookUrl ?? ''} maxLength={PROMOTION_LIMITS.bookUrlMax} placeholder="https://" onChange={(event) => { const value = event.currentTarget.value; update((prev) => ({ ...prev, bookUrl: value || null })); }} />
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card title="Photo" subtitle="The listing’s picture. Landscape, a few hundred KB, JPEG or PNG.">
            <div className="promo-photo">
              {detail.image ? <img src={detail.image.url} alt={detail.image.alt} /> : <div className="promo-listing-photo is-empty">No photo yet</div>}
              <div className="promo-photo-actions">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(event) => void choosePhoto(event.currentTarget.files?.[0])} />
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy === 'photo'}>
                  {busy === 'photo' ? 'Saving…' : detail.image ? 'Replace photo' : 'Choose photo'}
                </Button>
                {detail.image ? (
                  <Button type="button" variant="secondary" onClick={() => void removePhoto()} disabled={busy === 'photo'}>
                    Remove
                  </Button>
                ) : null}
                {detail.image ? (
                  <span className="subtle">
                    {detail.image.fileName}
                    {detail.image.width && detail.image.height ? ` · ${detail.image.width}×${detail.image.height}` : ''}
                  </span>
                ) : null}
              </div>
              {detail.image ? <PhotoAlt key={detail.image.id} alt={detail.image.alt} busy={busy === 'photo-alt'} onSave={(alt) => void savePhotoAlt(alt)} /> : null}
            </div>
          </Card>

          <Card title="Printed card" subtitle="The A5 menu this promotion prints. Its dishes are edited in the menu editor; its times, price and conditions come from here.">
            <div className="promo-card-link">
              {card ? (
                <>
                  <p className="promo-card-line">
                    <strong>{card.name}</strong> · {card.published ? `live v${card.published.versionNumber}` : 'never published'}
                    {card.draft ? ` · draft v${card.draft.versionNumber} in progress` : ''}
                    {card.status === 'ARCHIVED' ? ' · archived' : ''}
                  </p>
                  <div className="promo-card-link-row">
                    <Link to={`/menus/${card.id}/edit`} className="btn btn-secondary btn-md">
                      Edit the card
                    </Link>
                    <Link to={`/menus/${card.id}/history`} className="btn btn-secondary btn-md">
                      History
                    </Link>
                    {canManage ? (
                      <Button type="button" variant="secondary" onClick={() => void linkCard(null)} disabled={busy === 'card'}>
                        Unlink
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="promo-card-line">No card is linked: the listing goes out without a menu PDF.</p>
                  {canManage ? (
                    <div className="promo-card-link-row">
                      <Button type="button" variant="secondary" onClick={() => void makeCard()} disabled={busy === 'card'}>
                        Make a card
                      </Button>
                      {cardsForVenue.length ? (
                        <Select
                          aria-label="Link an existing card"
                          value=""
                          options={[{ value: '', label: 'Link an existing card…' }, ...cardsForVenue.map((menu) => ({ value: menu.id, label: menu.name }))]}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            if (value) void linkCard(value);
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </Card>

          {audit.length ? (
            <Card title="Activity">
              <ul className="audit-list">
                {audit.map((entry) => (
                  <li key={entry.id}>
                    <span className="audit-when">{formatWhen(entry.createdAt)}</span> <span className="audit-action">{personName(entry.actor)}</span> — {entry.summary}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="promo-sticky">
          <Card title="The website listing" subtitle={detail.publishedListing ? 'As you type. The website shows the last published version until you publish again.' : 'As you type. Nothing is on the website until you publish.'}>
            {listing ? <ListingPreview listing={listing} /> : null}
            {issues.errors.length || issues.warnings.length ? (
              <ul className={`menu-dialog-issues ${issues.errors.length ? 'is-error' : 'is-warning'}`}>
                {[...issues.errors, ...issues.warnings].map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
            {detail.publishedListing && listing ? <PublishedDifference published={detail.publishedListing} current={listing} /> : null}
          </Card>
        </aside>
      </div>

      <PromotionPublishDialog
        open={publishOpen}
        preview={publishPreview}
        loading={publishLoading}
        publishing={publishing}
        error={publishError}
        isLive={detail.status === 'PUBLISHED'}
        onConfirm={() => void confirmPublish()}
        onClose={() => {
          setPublishOpen(false);
          setPublishError(null);
        }}
      />
    </>
  );
}

function PriceField({ cents, unit, onChange }: { cents: number | null; unit: string | null; onChange: (cents: number | null, unit: string | null) => void }) {
  const [text, setText] = useState(cents === null ? '' : formatMenuPrice(cents));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(cents === null ? '' : formatMenuPrice(cents));
    setInvalid(false);
  }, [cents]);
  return (
    <div className="field">
      <span className="field-label">Price</span>
      <div className="hero-price">
        <label className="item-price">
          <span aria-hidden="true">$</span>
          <input
            className="field-control"
            inputMode="decimal"
            value={text}
            placeholder="99"
            aria-label="Price in dollars"
            aria-invalid={invalid}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setText(value);
              const parsed = parseMenuPriceInput(value);
              if (parsed === undefined) {
                setInvalid(true);
                return;
              }
              setInvalid(false);
              onChange(parsed, parsed !== null && !unit ? 'pp' : unit);
            }}
          />
          <input className="item-price-unit" value={unit ?? ''} maxLength={8} placeholder="pp" aria-label="Price unit" onChange={(event) => onChange(cents, event.currentTarget.value.trim() || null)} />
        </label>
      </div>
      <span className="field-hint">{invalid ? 'Dollars with at most two decimals.' : cents !== null ? `Prints “${formatMenuPrice(cents, unit)}”.` : 'Blank: no price (the website says “Walk-in”).'}</span>
    </div>
  );
}

function PhotoAlt({ alt, busy, onSave }: { alt: string; busy: boolean; onSave: (alt: string) => void }) {
  const [value, setValue] = useState(alt);
  return (
    <div className="promo-form-row">
      <Input label="Photo description" value={value} maxLength={PROMOTION_LIMITS.altMax} placeholder="A margarita being poured" hint="Read out by screen readers; shown if the photo fails to load." onChange={(event) => setValue(event.currentTarget.value)} />
      <div className="field" style={{ alignSelf: 'end' }}>
        <Button type="button" variant="secondary" onClick={() => onSave(value.trim())} disabled={busy || value.trim() === alt}>
          {busy ? 'Saving…' : 'Save description'}
        </Button>
      </div>
    </div>
  );
}

/** The listing as the website's What's On renders it. */
function ListingPreview({ listing }: { listing: PublicPromotion }) {
  return (
    <div className="promo-listing">
      {listing.image ? <img className="promo-listing-photo" src={listing.image.url} alt={listing.image.alt} /> : <div className="promo-listing-photo is-empty">No photo</div>}
      <div className="promo-listing-body">
        <div className="promo-listing-day">
          <strong>{listing.dayLabel || '—'}</strong>
          {listing.cadenceLabel ? <em>{listing.cadenceLabel}</em> : null}
        </div>
        {listing.timeLabel ? <div className="promo-listing-time">{listing.timeLabel}</div> : null}
        <h3 className="promo-listing-title">{listing.title}</h3>
        {listing.summary ? <p className="promo-listing-text">{listing.summary}</p> : null}
        <div className="promo-listing-price">{listing.priceLabel}</div>
        {listing.conditions ? <p className="promo-listing-conditions">{listing.conditions}</p> : null}
        <div className="promo-listing-foot">
          {listing.booking.destination !== 'NONE' ? <span className="promo-listing-button">{listing.booking.label || 'Reserve'}</span> : null}
          {listing.card ? <span className="promo-listing-pdf">Menu (PDF) · {listing.card.heading}</span> : null}
        </div>
      </div>
    </div>
  );
}

function PublishedDifference({ published, current }: { published: PublicPromotion; current: PublicPromotion }) {
  const changes = useMemo(() => diffForPreview(published, current), [published, current]);
  if (changes.length === 0) return <p className="promo-listing-note">Matches what the website shows.</p>;
  return <p className="promo-listing-note">Not yet on the website: {changes.join(', ')}.</p>;
}

function diffForPreview(published: PublicPromotion, current: PublicPromotion): string[] {
  const out: string[] = [];
  if (published.title !== current.title) out.push('title');
  if (published.summary !== current.summary) out.push('description');
  if (published.dayLabel !== current.dayLabel || published.cadenceLabel !== current.cadenceLabel || published.timeLabel !== current.timeLabel) out.push('day or time');
  if (published.validDays.join() !== current.validDays.join() || published.startTime !== current.startTime) out.push('booking days');
  if (published.startsOn !== current.startsOn || published.endsOn !== current.endsOn) out.push('dates');
  if (published.priceLabel !== current.priceLabel) out.push('price');
  if (published.conditions !== current.conditions) out.push('conditions');
  if (published.booking.destination !== current.booking.destination || published.booking.label !== current.booking.label || published.booking.url !== current.booking.url) out.push('booking button');
  if ((published.image?.url ?? null) !== (current.image?.url ?? null) || (published.image?.alt ?? '') !== (current.image?.alt ?? '')) out.push('photo');
  return out;
}

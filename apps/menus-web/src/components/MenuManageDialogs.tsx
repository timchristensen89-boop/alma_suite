import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MENU_KINDS, MENU_KIND_LABELS, MENU_LIMITS, type MenuKind, type MenuSummary, type MenuVenueSummary, type MenuVisibility } from '@alma/shared';
import { Button, Input, Select } from '@alma/ui';
import { eventDateInputValue } from '../lib/format';
import { menuApi, type MenuCreateRequest, type MenuUpdateRequest } from '../lib/menuApi';

/**
 * The things a publisher does to a menu as a whole — add one, change its
 * details (name, visibility, event), archive it. Content lives in the editor;
 * these only touch the Menu row.
 *
 * Native <dialog> like PublishDialog: the browser handles focus, Escape and the
 * backdrop, and the suite stylesheet already styles `.menu-dialog`. Each dialog
 * is mounted only while it is open, so its form state starts fresh every time
 * and nothing can reset a half-typed name underneath the user.
 */

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // showModal focuses the first control (the Venue picker when there are two
    // venues); the field the user actually types into first is marked instead.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  return ref;
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

type VenueTemplate = MenuVenueSummary['templates'][number];

/** Older API payloads carried no kinds on a template: those are the A4 food sheets. */
function templateKinds(template: VenueTemplate): MenuKind[] {
  return template.kinds?.length ? template.kinds : ['FOOD'];
}

/** The kinds a venue can print, in MENU_KINDS order. */
function kindsForVenue(venue: MenuVenueSummary | null): MenuKind[] {
  if (!venue) return [];
  return MENU_KINDS.filter((kind) => venue.templates.some((template) => templateKinds(template).includes(kind)));
}

function templatesForKind(venue: MenuVenueSummary | null, kind: MenuKind): VenueTemplate[] {
  return (venue?.templates ?? []).filter((template) => templateKinds(template).includes(kind));
}

function menuKind(menu: MenuSummary): MenuKind {
  return menu.kind ?? 'FOOD';
}

/** "Private events" on a heading, "Private event" on a badge. */
export function menuKindGroupLabel(kind: MenuKind): string {
  if (kind === 'PROMOTION') return 'Promotions';
  if (kind === 'PRIVATE_EVENT') return 'Private events';
  return MENU_KIND_LABELS[kind];
}

/** "" → null, "  x " → "x". */
function optionalText(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}

function parseGuests(value: string): number | null | undefined {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{1,4}$/.test(text)) return undefined;
  const count = Number(text);
  return count >= 1 && count <= MENU_LIMITS.guestCountMax ? count : undefined;
}

const PRIVATE_EVENT_NOTE = 'Private-event menus stay private: they are never served to the website unless a publisher makes them public later, from Menu details on the home.';

// ---------------------------------------------------------------------------
// Event fields (shared by New menu and Menu details)
// ---------------------------------------------------------------------------

type EventFormState = { eventName: string; eventDate: string; organiserRef: string; guestCount: string };

function EventFields({ ids, value, onChange }: { ids: { name: string; date: string; organiser: string; guests: string }; value: EventFormState; onChange: (next: EventFormState) => void }) {
  const guests = parseGuests(value.guestCount);
  return (
    <div className="menu-form-event" role="group" aria-label="Event details">
      <Input id={ids.name} label="Event name" value={value.eventName} maxLength={MENU_LIMITS.eventNameMax} placeholder="Smith wedding" onChange={(event) => onChange({ ...value, eventName: event.currentTarget.value })} />
      <div className="menu-form-row">
        <Input id={ids.date} label="Event date" type="date" value={value.eventDate} onChange={(event) => onChange({ ...value, eventDate: event.currentTarget.value })} />
        <Input
          id={ids.guests}
          label="Guest count"
          type="number"
          inputMode="numeric"
          min={1}
          max={MENU_LIMITS.guestCountMax}
          value={value.guestCount}
          placeholder="—"
          hint={guests === undefined ? `1 to ${MENU_LIMITS.guestCountMax} guests.` : undefined}
          onChange={(event) => onChange({ ...value, guestCount: event.currentTarget.value })}
        />
      </div>
      <Input id={ids.organiser} label="Organiser reference" value={value.organiserRef} maxLength={MENU_LIMITS.organiserRefMax} placeholder="Booking ref, contact, deposit…" hint="Internal only — never printed or served." onChange={(event) => onChange({ ...value, organiserRef: event.currentTarget.value })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New menu
// ---------------------------------------------------------------------------

type NewMenuProps = {
  venues: MenuVenueSummary[];
  /** Live menus a new one can start as a copy of. */
  menus: MenuSummary[];
  initialVenueId?: string | null;
  onCreated: (menu: MenuSummary) => void;
  onClose: () => void;
};

export function NewMenuDialog({ venues, menus, initialVenueId, onCreated, onClose }: NewMenuProps) {
  const ref = useModal();
  const addable = useMemo(() => venues.filter((venue) => venue.templates.length > 0), [venues]);
  const first = addable.find((candidate) => candidate.id === initialVenueId) ?? addable[0] ?? null;
  const firstKinds = kindsForVenue(first);
  const firstKind: MenuKind = firstKinds.includes('FOOD') ? 'FOOD' : firstKinds[0] ?? 'FOOD';
  const [venueId, setVenueId] = useState(first?.id ?? '');
  const [kind, setKind] = useState<MenuKind>(firstKind);
  const [templateKey, setTemplateKey] = useState(templatesForKind(first, firstKind)[0]?.key ?? '');
  const [name, setName] = useState('');
  const [heading, setHeading] = useState('');
  const [event, setEvent] = useState<EventFormState>({ eventName: '', eventDate: '', organiserRef: '', guestCount: '' });
  // Default to a copy of the venue's live menu of the same kind: a Tuesday menu usually starts as the à la carte with changes.
  const defaultSource = (forVenueId: string, forKind: MenuKind) => menus.find((menu) => menu.venue.id === forVenueId && menuKind(menu) === forKind && menu.published)?.id ?? '';
  const [copyFrom, setCopyFrom] = useState(() => (first ? defaultSource(first.id, firstKind) : ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const venue = addable.find((candidate) => candidate.id === venueId) ?? null;
  const kinds = kindsForVenue(venue);
  const templates = templatesForKind(venue, kind);
  const template = templates.find((candidate) => candidate.key === templateKey) ?? templates[0] ?? null;
  // Anything with a live version (or at least a draft) can be copied. The same
  // kind at this venue comes first, then the same kind elsewhere, then the rest.
  const sources = useMemo(
    () =>
      [...menus]
        .filter((menu) => menu.published || menu.draft)
        .sort((a, b) => {
          const rank = (menu: MenuSummary) => (menuKind(menu) === kind ? 2 : 0) + (menu.venue.id === venueId ? 1 : 0);
          return rank(b) - rank(a);
        }),
    [menus, venueId, kind]
  );
  const isEvent = kind === 'PRIVATE_EVENT';
  const guests = parseGuests(event.guestCount);

  function chooseVenue(nextVenueId: string) {
    setVenueId(nextVenueId);
    const next = addable.find((candidate) => candidate.id === nextVenueId) ?? null;
    const nextKinds = kindsForVenue(next);
    const nextKind = nextKinds.includes(kind) ? kind : nextKinds.includes('FOOD') ? 'FOOD' : nextKinds[0] ?? 'FOOD';
    setKind(nextKind);
    setTemplateKey(templatesForKind(next, nextKind)[0]?.key ?? '');
    setCopyFrom(defaultSource(nextVenueId, nextKind));
  }

  function chooseKind(nextKind: MenuKind) {
    setKind(nextKind);
    setTemplateKey(templatesForKind(venue, nextKind)[0]?.key ?? '');
    setCopyFrom(defaultSource(venueId, nextKind));
  }

  async function submit(event_: FormEvent) {
    event_.preventDefault();
    if (!venue || !template) return;
    if (isEvent && guests === undefined) {
      setError(`Guest count must be a whole number from 1 to ${MENU_LIMITS.guestCountMax}.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: MenuCreateRequest = {
        venueId: venue.id,
        name: name.trim(),
        kind,
        templateKey: template.key,
        heading: heading.trim(),
        ...(copyFrom ? { copyFromMenuId: copyFrom } : {}),
        // Visibility is left to the server: PRIVATE for private events, PUBLIC otherwise.
        ...(isEvent
          ? {
              eventName: optionalText(event.eventName),
              eventDate: event.eventDate || null,
              organiserRef: optionalText(event.organiserRef),
              guestCount: guests ?? null
            }
          : {})
      };
      onCreated(await menuApi.create(input));
    } catch (caught) {
      setError(messageOf(caught, 'Could not create the menu.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="new-menu-title">
      <form className="menu-dialog-body menu-form" onSubmit={(event_) => void submit(event_)}>
        <header>
          <span className="menu-dialog-eyebrow">New menu</span>
          <h2 id="new-menu-title">Add a menu</h2>
          <p className="subtle">A Tuesday menu, a drinks book, a functions pack, an event menu — each has its own drafts, history and PDF, printed on one of the venue's templates.</p>
        </header>

        {addable.length === 0 ? (
          <p className="error-text">No venue has a print template yet, so a menu cannot be added here.</p>
        ) : (
          <>
            {addable.length > 1 ? (
              <Select id="new-menu-venue" label="Venue" value={venueId} onChange={(event_) => chooseVenue(event_.currentTarget.value)} options={addable.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
            ) : (
              <p className="subtle">Venue: <strong>{addable[0]!.name}</strong></p>
            )}
            {kinds.length > 1 ? (
              <Select id="new-menu-kind" label="Kind" value={kind} onChange={(event_) => chooseKind(event_.currentTarget.value as MenuKind)} options={kinds.map((candidate) => ({ value: candidate, label: MENU_KIND_LABELS[candidate] }))} hint="Decides the templates, the checks and where it sits on the home." />
            ) : kinds.length === 1 ? (
              <p className="subtle">Kind: <strong>{MENU_KIND_LABELS[kinds[0]!]}</strong></p>
            ) : null}
            {templates.length > 1 ? (
              <Select id="new-menu-template" label="Print template" value={template?.key ?? ''} onChange={(event_) => setTemplateKey(event_.currentTarget.value)} options={templates.map((candidate) => ({ value: candidate.key, label: candidate.label }))} />
            ) : null}
            <Input
              id="new-menu-name"
              label="Name"
              value={name}
              required
              maxLength={MENU_LIMITS.menuNameMax}
              placeholder={isEvent ? 'Smith wedding' : kind === 'DRINKS' ? 'Drinks' : kind === 'FUNCTIONS' ? 'Functions' : kind === 'PROMOTION' ? 'Happy hour' : 'Tuesday'}
              hint="Shown on the Menus home and in the PDF filename. Unique per venue."
              onChange={(event_) => setName(event_.currentTarget.value)}
              data-autofocus
            />
            <Input
              id="new-menu-heading"
              label="Printed heading"
              value={heading}
              maxLength={MENU_LIMITS.headingMax}
              placeholder={template?.title ?? ''}
              hint={`The italic title line. Blank prints “${template?.title ?? 'À la carte'}”. You can change it in the editor.`}
              onChange={(event_) => setHeading(event_.currentTarget.value)}
            />
            {isEvent ? (
              <>
                <EventFields ids={{ name: 'new-menu-event-name', date: 'new-menu-event-date', organiser: 'new-menu-organiser', guests: 'new-menu-guests' }} value={event} onChange={setEvent} />
                <p className="subtle menu-form-note">{PRIVATE_EVENT_NOTE}</p>
              </>
            ) : null}
            <Select
              id="new-menu-source"
              label="Start from"
              value={copyFrom}
              hint="A copy is a starting point: the two menus are edited separately from here on."
              onChange={(event_) => setCopyFrom(event_.currentTarget.value)}
              options={[
                { value: '', label: 'An empty menu' },
                ...sources.map((source) => ({
                  value: source.id,
                  label: `Copy of ${source.venue.name} · ${source.name}${menuKind(source) === kind ? '' : ` [${MENU_KIND_LABELS[menuKind(source)].toLowerCase()}]`}${
                    source.published ? ` (live v${source.published.versionNumber})` : ` (draft v${source.draft?.versionNumber ?? '?'}, nothing live yet)`
                  }`
                }))
              ]}
            />
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}
        <div className="menu-dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting || !venue || !template || !name.trim()}>
            {submitting ? 'Creating…' : 'Create and open'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Menu details (name, visibility, event)
// ---------------------------------------------------------------------------

type DetailsProps = {
  menu: MenuSummary;
  /** `renamed` says whether the name itself changed, for the home's notice. */
  onDone: (menu: MenuSummary, changed: { renamed: boolean }) => void;
  onClose: () => void;
};

export function MenuDetailsDialog({ menu, onDone, onClose }: DetailsProps) {
  const ref = useModal();
  const [name, setName] = useState(menu.name);
  const [visibility, setVisibility] = useState<MenuVisibility>(menu.visibility ?? 'PUBLIC');
  const initialEvent: EventFormState = {
    eventName: menu.event?.eventName ?? '',
    eventDate: eventDateInputValue(menu.event?.eventDate),
    organiserRef: menu.event?.organiserRef ?? '',
    guestCount: menu.event?.guestCount === null || menu.event?.guestCount === undefined ? '' : String(menu.event.guestCount)
  };
  const [event, setEvent] = useState<EventFormState>(initialEvent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEvent = menuKind(menu) === 'PRIVATE_EVENT';
  const guests = parseGuests(event.guestCount);

  /** Only the fields that differ from the menu as it is now. */
  function changes(): MenuUpdateRequest | null {
    const patch: MenuUpdateRequest = {};
    const nextName = name.trim();
    if (nextName && nextName !== menu.name) patch.name = nextName;
    if (visibility !== (menu.visibility ?? 'PUBLIC')) patch.visibility = visibility;
    if (isEvent) {
      if (optionalText(event.eventName) !== (menu.event?.eventName ?? null)) patch.eventName = optionalText(event.eventName);
      if (event.eventDate !== initialEvent.eventDate) patch.eventDate = event.eventDate || null;
      if (optionalText(event.organiserRef) !== (menu.event?.organiserRef ?? null)) patch.organiserRef = optionalText(event.organiserRef);
      if (guests !== undefined && guests !== (menu.event?.guestCount ?? null)) patch.guestCount = guests;
    }
    return Object.keys(patch).length ? patch : null;
  }

  async function submit(event_: FormEvent) {
    event_.preventDefault();
    if (!name.trim()) return;
    if (isEvent && guests === undefined) {
      setError(`Guest count must be a whole number from 1 to ${MENU_LIMITS.guestCountMax}.`);
      return;
    }
    const patch = changes();
    if (!patch) {
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onDone(await menuApi.update(menu.id, patch), { renamed: patch.name !== undefined });
    } catch (caught) {
      setError(messageOf(caught, 'Could not save the menu details.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="rename-menu-title">
      <form className="menu-dialog-body menu-form" onSubmit={(event_) => void submit(event_)}>
        <header>
          <span className="menu-dialog-eyebrow">Menu details</span>
          <h2 id="rename-menu-title">{menu.venue.name} · {menu.name}</h2>
          <p className="subtle">The name shows on the Menus home, in the editor and in PDF download filenames, past versions included. Nothing printed on the page changes here; the printed heading is edited in the editor.</p>
        </header>
        <Input id="rename-menu-name" label="Name" value={name} required maxLength={MENU_LIMITS.menuNameMax} onChange={(event_) => setName(event_.currentTarget.value)} data-autofocus />

        <div className="field">
          <span className="field-label" id="menu-visibility-label">Visibility</span>
          <div className="menu-segmented" role="radiogroup" aria-labelledby="menu-visibility-label">
            <button type="button" role="radio" aria-checked={visibility === 'PUBLIC'} className={visibility === 'PUBLIC' ? 'is-on' : ''} onClick={() => setVisibility('PUBLIC')}>Public</button>
            <button type="button" role="radio" aria-checked={visibility === 'PRIVATE'} className={visibility === 'PRIVATE' ? 'is-on' : ''} onClick={() => setVisibility('PRIVATE')}>Private</button>
          </div>
          <span className="field-hint">Public menus can be served to the website once published. Private menus are only ever printed from here.</span>
        </div>

        {isEvent ? (
          <>
            <EventFields ids={{ name: 'menu-event-name', date: 'menu-event-date', organiser: 'menu-organiser', guests: 'menu-guests' }} value={event} onChange={setEvent} />
            {visibility === 'PRIVATE' ? <p className="subtle menu-form-note">{PRIVATE_EVENT_NOTE}</p> : null}
          </>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
        <div className="menu-dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting || !name.trim()}>{submitting ? 'Saving…' : 'Save details'}</Button>
        </div>
      </form>
    </dialog>
  );
}

/** The dialog's earlier name, for anything still importing it. */
export const RenameMenuDialog = MenuDetailsDialog;

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

type ArchiveProps = {
  menu: MenuSummary;
  onDone: (menu: MenuSummary) => void;
  onClose: () => void;
};

export function ArchiveMenuDialog({ menu, onDone, onClose }: ArchiveProps) {
  const ref = useModal();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      onDone(await menuApi.archive(menu.id));
    } catch (caught) {
      setError(messageOf(caught, 'Could not archive the menu.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="archive-menu-title">
      <form method="dialog" className="menu-dialog-body" onSubmit={(event) => event.preventDefault()}>
        <header>
          <span className="menu-dialog-eyebrow">Archive</span>
          <h2 id="archive-menu-title">Archive {menu.venue.name} · {menu.name}?</h2>
        </header>
        <p>
          It comes off the Menus home and can no longer be edited, renamed or published. Every version, PDF and audit entry is kept, and a publisher can unarchive it from the archived list at any time.
          {menu.draft ? ` Its unpublished draft v${menu.draft.versionNumber} is kept too.` : ''}
        </p>
        {menu.published ? <p className="subtle">The live v{menu.published.versionNumber} PDF stays downloadable from History.</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <div className="menu-dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="button" variant="danger" onClick={() => void confirm()} disabled={submitting}>{submitting ? 'Archiving…' : 'Archive menu'}</Button>
        </div>
      </form>
    </dialog>
  );
}

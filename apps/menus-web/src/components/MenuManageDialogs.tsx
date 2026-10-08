import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { MENU_LIMITS, type MenuSummary, type MenuVenueSummary } from '@alma/shared';
import { Button, Input, Select } from '@alma/ui';
import { menuApi } from '../lib/menuApi';

/**
 * The three things a publisher does to a menu as a whole — add one, rename it,
 * archive it. Content lives in the editor; these only touch the Menu row.
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
  const [venueId, setVenueId] = useState(first?.id ?? '');
  const [templateKey, setTemplateKey] = useState(first?.templates[0]?.key ?? '');
  const [name, setName] = useState('');
  const [heading, setHeading] = useState('');
  // Default to a copy of the venue's live menu: a Tuesday menu usually starts as the à la carte with changes.
  const [copyFrom, setCopyFrom] = useState(() => (first ? menus.find((menu) => menu.venue.id === first.id && menu.published)?.id ?? '' : ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const venue = addable.find((candidate) => candidate.id === venueId) ?? null;
  const templates = venue?.templates ?? [];
  const template = templates.find((candidate) => candidate.key === templateKey) ?? templates[0] ?? null;
  // Anything with a live version (or at least a draft) can be copied. The venue's own menus come first.
  const sources = useMemo(
    () =>
      [...menus]
        .filter((menu) => menu.published || menu.draft)
        .sort((a, b) => Number(b.venue.id === venueId) - Number(a.venue.id === venueId)),
    [menus, venueId]
  );

  function chooseVenue(nextVenueId: string) {
    setVenueId(nextVenueId);
    const next = addable.find((candidate) => candidate.id === nextVenueId);
    setTemplateKey(next?.templates[0]?.key ?? '');
    const ownLive = menus.find((menu) => menu.venue.id === nextVenueId && menu.published);
    setCopyFrom(ownLive?.id ?? '');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!venue || !template) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await menuApi.create({
        venueId: venue.id,
        name: name.trim(),
        templateKey: template.key,
        heading: heading.trim(),
        ...(copyFrom ? { copyFromMenuId: copyFrom } : {})
      });
      onCreated(created);
    } catch (caught) {
      setError(messageOf(caught, 'Could not create the menu.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="new-menu-title">
      <form className="menu-dialog-body menu-form" onSubmit={(event) => void submit(event)}>
        <header>
          <span className="menu-dialog-eyebrow">New menu</span>
          <h2 id="new-menu-title">Add a menu</h2>
          <p className="subtle">A Tuesday menu, an event menu, a seasonal list — each has its own drafts, history and PDF, printed on the venue's template.</p>
        </header>

        {addable.length === 0 ? (
          <p className="error-text">No venue has a print template yet, so a menu cannot be added here.</p>
        ) : (
          <>
            {addable.length > 1 ? (
              <Select id="new-menu-venue" label="Venue" value={venueId} onChange={(event) => chooseVenue(event.currentTarget.value)} options={addable.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
            ) : (
              <p className="subtle">Venue: <strong>{addable[0]!.name}</strong></p>
            )}
            {templates.length > 1 ? (
              <Select id="new-menu-template" label="Print template" value={template?.key ?? ''} onChange={(event) => setTemplateKey(event.currentTarget.value)} options={templates.map((candidate) => ({ value: candidate.key, label: candidate.label }))} />
            ) : null}
            <Input
              id="new-menu-name"
              label="Name"
              value={name}
              required
              maxLength={MENU_LIMITS.menuNameMax}
              placeholder="Tuesday"
              hint="Shown on the Menus home and in the PDF filename. Unique per venue."
              onChange={(event) => setName(event.currentTarget.value)}
              data-autofocus
            />
            <Input
              id="new-menu-heading"
              label="Printed heading"
              value={heading}
              maxLength={MENU_LIMITS.headingMax}
              placeholder={template?.title ?? ''}
              hint={`The italic line under the logo. Blank prints “${template?.title ?? 'À la carte'}”. You can change it in the editor.`}
              onChange={(event) => setHeading(event.currentTarget.value)}
            />
            <Select
              id="new-menu-source"
              label="Start from"
              value={copyFrom}
              hint="A copy is a starting point: the two menus are edited separately from here on."
              onChange={(event) => setCopyFrom(event.currentTarget.value)}
              options={[
                { value: '', label: 'An empty menu' },
                ...sources.map((source) => ({
                  value: source.id,
                  label: `Copy of ${source.venue.name} · ${source.name}${source.published ? ` (live v${source.published.versionNumber})` : ` (draft v${source.draft?.versionNumber ?? '?'}, nothing live yet)`}`
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
// Rename
// ---------------------------------------------------------------------------

type RenameProps = {
  menu: MenuSummary;
  onDone: (menu: MenuSummary) => void;
  onClose: () => void;
};

export function RenameMenuDialog({ menu, onDone, onClose }: RenameProps) {
  const ref = useModal();
  const [name, setName] = useState(menu.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === menu.name) {
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onDone(await menuApi.rename(menu.id, next));
    } catch (caught) {
      setError(messageOf(caught, 'Could not rename the menu.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={ref} className="menu-dialog" onClose={onClose} aria-labelledby="rename-menu-title">
      <form className="menu-dialog-body menu-form" onSubmit={(event) => void submit(event)}>
        <header>
          <span className="menu-dialog-eyebrow">Rename</span>
          <h2 id="rename-menu-title">{menu.venue.name} · {menu.name}</h2>
          <p className="subtle">Changes the name on the Menus home, in the editor and in PDF download filenames, past versions included. Nothing printed on the page changes; the printed heading is edited in the editor.</p>
        </header>
        <Input id="rename-menu-name" label="Name" value={name} required maxLength={MENU_LIMITS.menuNameMax} onChange={(event) => setName(event.currentTarget.value)} data-autofocus />
        {error ? <p className="error-text">{error}</p> : null}
        <div className="menu-dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting || !name.trim()}>{submitting ? 'Saving…' : 'Rename'}</Button>
        </div>
      </form>
    </dialog>
  );
}

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

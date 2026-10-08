import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MENU_LIMITS,
  MENU_PLACEMENTS,
  MENU_PLACEMENT_LABELS,
  MENU_SECTION_TYPES,
  MENU_SECTION_TYPE_LABELS,
  MENU_TAGS,
  MENU_TEMPLATES,
  canPublishMenus,
  diffMenuDocuments,
  formatMenuPrice,
  isMenuTemplateKey,
  menuDiffIsEmpty,
  menuDocumentsEqual,
  summariseMenuDiff,
  newDishKey,
  overflowIssue,
  parseMenuPriceInput,
  validateMenuDocument,
  type AuthUser,
  type MenuDocument,
  type MenuDraftPayload,
  type MenuFillReport,
  type MenuItemDocument,
  type MenuPublishPreview,
  type MenuSectionDocument,
  type MenuSummary,
  type MenuValidationIssue,
  type MenuVersionPayload
} from '@alma/shared';
import { Badge, Button, Card, EmptyState, Spinner } from '@alma/ui';
import { DiffView } from '../components/DiffView';
import { MenuPreview } from '../components/MenuPreview';
import { PublishDialog } from '../components/PublishDialog';
import { ValidationPanel } from '../components/ValidationPanel';
import { ApiError } from '../lib/api';
import { formatWhen, pdfFilename, personName } from '../lib/format';
import { archivedMenuIdOf, isMenuArchivedError, menuApi, openVersionPdf } from '../lib/menuApi';
import {
  downloadUnsavedChanges,
  forgetUnsavedChanges,
  keepUnsavedChanges,
  newRecoveryId,
  readUnsavedChanges,
  saveConfirmsApply,
  type PendingRecoveryApply,
  type UnsavedMenuChanges
} from '../lib/recovery';
import { moveItem, useDragReorder } from '../lib/reorder';
import { IconArrowLeft, IconPlus, IconTrash } from '../../../web/src/lib/icons';

/**
 * The editor. Split view on a desk (form left, live A4 preview right), two
 * tabs on a phone (Edit / Preview). Edits are kept locally and auto-saved a
 * moment after you stop typing; the server's updatedAt travels with every save
 * so two people on the pass cannot silently overwrite each other.
 */

const AUTOSAVE_MS = 1500;

type SaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string }
  /** The menu was archived under this editor: nothing more is sent. */
  | { kind: 'archived' };

/**
 * Sections carry a client-only key. Every save rewrites the draft's rows, so
 * the server's section ids change on each autosave; keying React on them would
 * remount every section card mid-typing. The key never leaves the browser —
 * the API's zod schema strips unknown fields.
 */
type EditorSection = MenuSectionDocument & { clientKey?: string };

function clientKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `k${Math.random().toString(36).slice(2)}`;
}

function withClientKeys(doc: MenuDocument): MenuDocument {
  return { ...doc, sections: doc.sections.map((section: EditorSection) => (section.clientKey ? section : { ...section, clientKey: clientKey() })) };
}

/**
 * Carry the server's row ids and freshly minted dish keys from a save
 * response onto the editor's current document, matching sections by client
 * key and items by dish key (or by object identity for items that had no key
 * when they were sent). Positional matching would mislabel rows after an
 * insert, delete or drag that happened while the save was in flight.
 */
function adoptSaved(current: MenuDocument, sent: MenuDocument, saved: MenuDocument): MenuDocument {
  const sectionIdByClientKey = new Map<string, string | undefined>();
  const savedItemBySentItem = new Map<MenuItemDocument, MenuItemDocument>();
  sent.sections.forEach((section: EditorSection, index) => {
    const savedSection = saved.sections[index];
    if (section.clientKey) sectionIdByClientKey.set(section.clientKey, savedSection?.id);
    section.items.forEach((item, itemIndex) => {
      const savedItem = savedSection?.items[itemIndex];
      if (savedItem) savedItemBySentItem.set(item, savedItem);
    });
  });
  const savedItemByDishKey = new Map(saved.sections.flatMap((section) => section.items).map((item) => [item.dishKey, item] as const));
  return {
    ...current,
    sections: current.sections.map((section: EditorSection) => ({
      ...section,
      id: (section.clientKey ? sectionIdByClientKey.get(section.clientKey) : undefined) ?? section.id,
      items: section.items.map((item) => {
        const viaSent = savedItemBySentItem.get(item);
        const dishKey = item.dishKey ?? viaSent?.dishKey;
        const match = (dishKey ? savedItemByDishKey.get(dishKey) : undefined) ?? viaSent;
        return { ...item, dishKey, id: match?.id ?? item.id };
      })
    }))
  };
}

function emptyItem(name = ''): MenuItemDocument {
  return {
    dishKey: newDishKey(name || 'dish'),
    name,
    description: null,
    priceCents: null,
    priceUnit: null,
    prices: [],
    meta: null,
    note: null,
    flags: [],
    tags: [],
    isSeafood: false,
    visible: true,
    recipeId: null
  };
}

function emptySection(page = 1): EditorSection {
  return {
    clientKey: clientKey(),
    title: '',
    headerSuffix: null,
    subheading: null,
    sectionType: 'STANDARD',
    placement: 'LEFT',
    page,
    lead: null,
    body: null,
    priceColumns: [],
    visible: true,
    items: [emptyItem()]
  };
}

function itemDomId(sectionIndex: number, itemIndex: number) {
  return `menu-item-${sectionIndex}-${itemIndex}`;
}

function sectionDomId(sectionIndex: number) {
  return `menu-section-${sectionIndex}`;
}

export function EditorPage({ user }: { user: AuthUser }) {
  const { menuId = '' } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<MenuSummary | null>(null);
  const [draft, setDraft] = useState<MenuDraftPayload | null>(null);
  const [doc, setDoc] = useState<MenuDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [fill, setFill] = useState<MenuFillReport | null>(null);
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  const [focusDishKey, setFocusDishKey] = useState<string | null>(null);
  const [otherMenus, setOtherMenus] = useState<MenuSummary[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishPreview, setPublishPreview] = useState<MenuPublishPreview | null>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState<MenuVersionPayload | null>(null);
  const [copyTarget, setCopyTarget] = useState<{ dishKey: string; name: string } | null>(null);
  /** Edits the server never got because the menu was archived mid-edit (see lib/recovery). */
  const [unsaved, setUnsaved] = useState<{ changes: UnsavedMenuChanges; kept: boolean } | null>(null);
  const expectedUpdatedAt = useRef<string | undefined>(undefined);
  /** Set once the API says this menu is archived: no save is scheduled or sent after that. */
  const archivedRef = useRef(false);
  /** The document as the server last stored it, to tell what is unsaved. */
  const savedDocRef = useRef<MenuDocument | null>(null);
  /**
   * Every edit gets the next number; latestSeqRef is the number of the
   * document in latestDoc. A save remembers the number of what it sent, so a
   * response can tell whether it carried a given edit.
   */
  const editSeqRef = useRef(0);
  const latestSeqRef = useRef(0);
  /** The number of the document the server last confirmed; "saved" means it equals latestSeqRef. */
  const savedSeqRef = useRef(0);
  /** A kept copy applied to the editor and not yet confirmed saved: its backup stays until then. */
  const pendingApplyRef = useRef<PendingRecoveryApply | null>(null);
  const [applyPending, setApplyPending] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const latestDoc = useRef<MenuDocument | null>(null);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const saveStateRef = useRef<SaveState>({ kind: 'idle' });
  const saveNowRef = useRef<() => Promise<boolean>>(async () => true);
  const setSave = useCallback((state: SaveState) => {
    saveStateRef.current = state;
    setSaveState(state);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotice(null);
    try {
      const [menu, all] = await Promise.all([menuApi.get(menuId), menuApi.list()]);
      setSummary(menu);
      setOtherMenus(all.menus.filter((other) => other.id !== menuId));
      archivedRef.current = menu.status === 'ARCHIVED';
      // A reload replaces the editor's content with the server's: any apply
      // not yet saved is undone, and the kept copy (still in storage) is
      // offered again.
      pendingApplyRef.current = null;
      setApplyPending(null);
      const kept = readUnsavedChanges(menuId);
      setUnsaved(kept ? { changes: kept, kept: true } : null);
      if (menu.status === 'ARCHIVED') {
        // Read-only, but the kept edits are still shown against the draft as it was archived.
        savedDocRef.current = kept && menu.draft ? (await menuApi.getDraft(menuId).catch(() => null))?.document ?? null : null;
      }
      if (menu.draft && menu.status !== 'ARCHIVED') {
        const payload = await menuApi.getDraft(menuId);
        const keyed = withClientKeys(payload.document);
        setDraft(payload);
        setDoc(keyed);
        latestDoc.current = keyed;
        latestSeqRef.current = editSeqRef.current;
        savedSeqRef.current = editSeqRef.current;
        savedDocRef.current = payload.document;
        expectedUpdatedAt.current = payload.version.updatedAt;
        setSave({ kind: 'saved', at: payload.version.updatedAt });
      } else {
        setDraft(null);
        setDoc(null);
      }
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Could not load this menu.');
    } finally {
      setLoading(false);
    }
  }, [menuId, setSave]);

  useEffect(() => {
    void load();
  }, [load]);

  // ------------------------------------------------------------ saving
  const saveNow = useCallback((): Promise<boolean> => {
    const current = latestDoc.current;
    const sentSeq = latestSeqRef.current;
    if (archivedRef.current) return Promise.resolve(false);
    if (!current) return Promise.resolve(true);
    if (savingRef.current && inFlight.current) {
      // Another save is on the wire; run again when it lands so the newest edits go up.
      queuedRef.current = true;
      return inFlight.current;
    }
    savingRef.current = true;
    setSave({ kind: 'saving' });
    const run = (async (): Promise<boolean> => {
      try {
        const payload = await menuApi.saveDraft(menuId, current, expectedUpdatedAt.current);
        expectedUpdatedAt.current = payload.version.updatedAt;
        savedDocRef.current = payload.document;
        savedSeqRef.current = Math.max(savedSeqRef.current, sentSeq);
        // The menu was archived while this save was on the wire (the server
        // accepted it just before): the read-only view stands, nothing below
        // may flip it back to an editor.
        if (archivedRef.current) return true;
        setDraft(payload);
        // Adopt the server's row ids and dish keys without clobbering edits typed meanwhile.
        const base = latestDoc.current ?? current;
        const adopted = adoptSaved(base, current, payload.document);
        latestDoc.current = adopted;
        setDoc(adopted);
        if (latestSeqRef.current === sentSeq) {
          setSave({ kind: 'saved', at: payload.version.updatedAt });
        } else {
          // Edits were typed while this save was out. They are not saved yet:
          // say so, and make sure a save for them is coming.
          setSave({ kind: 'dirty' });
          if (!saveTimer.current && !queuedRef.current) saveTimer.current = window.setTimeout(() => void saveNowRef.current(), AUTOSAVE_MS);
        }
        // The server now holds the applied copy only if this save carried it:
        // one sent before the apply (still in flight when it was applied)
        // does not count. Only then is the backup removed, and only if the
        // stored copy is still the one that was applied.
        const pending = pendingApplyRef.current;
        if (saveConfirmsApply(pending, sentSeq)) {
          pendingApplyRef.current = null;
          forgetUnsavedChanges(menuId, pending.recoveryId);
          setUnsaved((prev) => (prev && prev.changes.id === pending.recoveryId ? null : prev));
          setApplyPending((prev) => (prev === pending.recoveryId ? null : prev));
          setNotice({ tone: 'success', text: 'Your recovered changes are saved to the draft.' });
        }
        return true;
      } catch (caught) {
        if (isMenuArchivedError(caught)) {
          enterArchivedRef.current(latestDoc.current ?? current);
        } else if (caught instanceof ApiError && caught.status === 409) {
          setSave({ kind: 'conflict', message: caught.message });
        } else {
          setSave({ kind: 'error', message: caught instanceof Error ? caught.message : 'Could not save.' });
        }
        return false;
      } finally {
        savingRef.current = false;
        inFlight.current = null;
        if (queuedRef.current && !archivedRef.current) {
          queuedRef.current = false;
          void saveNowRef.current();
        }
      }
    })();
    inFlight.current = run;
    return run;
  }, [menuId, setSave]);
  saveNowRef.current = saveNow;

  /** Apply an edit and schedule the autosave. Returns the edit's number (none once archived). */
  const update = useCallback(
    (mutate: (prev: MenuDocument) => MenuDocument): number | null => {
      if (archivedRef.current) return null;
      const seq = ++editSeqRef.current;
      setDoc((prev) => {
        if (!prev) return prev;
        const next = mutate(prev);
        latestDoc.current = next;
        latestSeqRef.current = seq;
        return next;
      });
      if (saveStateRef.current.kind !== 'conflict') setSave({ kind: 'dirty' });
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void saveNowRef.current();
      }, AUTOSAVE_MS);
      return seq;
    },
    [setSave]
  );

  /**
   * The API said this menu is archived (a save, publish, copy or discard was
   * refused). Stop: cancel the pending autosave, never send another, close
   * any open dialog, and show the read-only view. Anything typed since the
   * last successful save is kept in this browser so it can be applied once
   * the menu is unarchived — the server's draft stays as it was archived.
   */
  const enterArchived = useCallback(
    (latest: MenuDocument | null) => {
      archivedRef.current = true;
      queuedRef.current = false;
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      setPublishOpen(false);
      setCopyTarget(null);
      setSave({ kind: 'archived' });
      // An applied copy not yet saved is part of `latest`, so it is kept again below.
      pendingApplyRef.current = null;
      setApplyPending(null);
      const saved = savedDocRef.current;
      if (latest && saved && draft && summary && !menuDocumentsEqual(saved, latest)) {
        const changes: UnsavedMenuChanges = {
          id: newRecoveryId(),
          menuId,
          menuLabel: `${summary.venue.name} · ${summary.name}`,
          draftVersionNumber: draft.version.versionNumber,
          keptAt: new Date().toISOString(),
          document: latest
        };
        setUnsaved({ changes, kept: keepUnsavedChanges(changes) });
      }
      setSummary((prev) => (prev ? { ...prev, status: 'ARCHIVED' } : prev));
    },
    [draft, menuId, setSave, summary]
  );
  const enterArchivedRef = useRef(enterArchived);
  enterArchivedRef.current = enterArchived;
  /** Unsaved edits exist and this browser could not keep them: leaving the page loses them. */
  const unsavedNotKeptRef = useRef(false);
  unsavedNotKeptRef.current = Boolean(unsaved && !unsaved.kept);

  // Leaving the page (History, the task bar, the back link) flushes a pending
  // autosave rather than dropping it; closing the tab asks first while edits
  // are unsaved.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const kind = saveStateRef.current.kind;
      if (kind === 'dirty' || kind === 'saving' || kind === 'error' || (kind === 'archived' && unsavedNotKeptRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void saveNowRef.current();
      }
    };
  }, []);

  // Flush a pending save when the tab is hidden (phone locked on the pass).
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void saveNowRef.current();
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  /** Make sure the server has what the editor shows: run or await the save, then report whether it stuck. */
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (archivedRef.current) return false;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlight.current) {
      const ok = await inFlight.current;
      // Edits typed during that save were queued; wait for the follow-up too.
      if (inFlight.current) return inFlight.current;
      if (!ok) return false;
    }
    const kind = saveStateRef.current.kind;
    if (kind === 'conflict') return false;
    // Whatever the label says, the server has the latest edits only when
    // their number is the one it last confirmed.
    if (latestSeqRef.current !== savedSeqRef.current || kind === 'error') return saveNow();
    return true;
  }, [saveNow]);

  // ------------------------------------------------------------ validation
  const validation = useMemo(() => (doc ? validateMenuDocument(doc) : null), [doc]);
  const overflow = useMemo(() => (fill ? overflowIssue(fill) : null), [fill]);
  const errors = useMemo(() => [...(validation?.errors ?? []), ...(overflow ? [overflow] : [])], [validation, overflow]);
  const warnings = validation?.warnings ?? [];

  const handleFill = useCallback((report: MenuFillReport) => setFill(report), []);

  const jumpTo = useCallback(
    (issue: MenuValidationIssue) => {
      if (issue.sectionIndex === undefined) return;
      setMobileTab('edit');
      const id = issue.itemIndex !== undefined ? itemDomId(issue.sectionIndex, issue.itemIndex) : sectionDomId(issue.sectionIndex);
      window.setTimeout(() => {
        const element = document.getElementById(id);
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element?.classList.add('is-flash');
        window.setTimeout(() => element?.classList.remove('is-flash'), 1600);
        const input = element?.querySelector<HTMLInputElement>('input[data-field="name"]');
        input?.focus({ preventScroll: true });
      }, 50);
      if (issue.dishKey) setFocusDishKey(issue.dishKey);
    },
    []
  );

  // ------------------------------------------------------------ draft lifecycle
  async function startDraft() {
    setNotice(null);
    try {
      await menuApi.createDraft(menuId);
      await load();
    } catch (caught) {
      if (isMenuArchivedError(caught)) {
        enterArchived(null);
        return;
      }
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : 'Could not start a draft.' });
    }
  }

  async function discardDraft() {
    if (!draft) return;
    const ok = window.confirm(`Discard draft v${draft.version.versionNumber}? Everything unpublished in it is lost. The live menu is not affected.`);
    if (!ok) return;
    try {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      await menuApi.discardDraft(menuId);
      navigate('/');
    } catch (caught) {
      // Archived by someone else since this page opened: show the read-only state rather than a dead toolbar.
      if (isMenuArchivedError(caught)) {
        enterArchived(latestDoc.current);
        return;
      }
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : 'Could not discard the draft.' });
    }
  }

  async function openPublish() {
    setPublishError(null);
    setPublishPreview(null);
    setPublishOpen(true);
    setPublishLoading(true);
    const saved = await flushSave();
    if (!saved) {
      setPublishLoading(false);
      if (archivedRef.current) return; // the save found the menu archived; the read-only view says so
      const state = saveStateRef.current;
      setPublishError(state.kind === 'conflict' || state.kind === 'error' ? state.message : 'The draft could not be saved, so it cannot be published yet.');
      return;
    }
    try {
      setPublishPreview(await menuApi.publishPreview(menuId));
    } catch (caught) {
      if (isMenuArchivedError(caught)) {
        enterArchived(latestDoc.current);
        return;
      }
      setPublishError(caught instanceof Error ? caught.message : 'Could not check the draft.');
    } finally {
      setPublishLoading(false);
    }
  }

  async function confirmPublish() {
    if (!publishPreview) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await menuApi.publish(menuId, { expectedUpdatedAt: expectedUpdatedAt.current, acknowledgeWarnings: publishPreview.validation.warnings.length > 0 });
      setPublishOpen(false);
      setJustPublished(result);
      setDraft(null);
      setDoc(null);
      latestDoc.current = null;
      setSummary(await menuApi.get(menuId));
    } catch (caught) {
      if (isMenuArchivedError(caught)) {
        enterArchived(latestDoc.current);
        return;
      }
      if (caught instanceof ApiError && caught.details && typeof caught.details === 'object' && 'validation' in caught.details) {
        const details = caught.details as { validation: MenuPublishPreview['validation'] };
        setPublishPreview((prev) => (prev ? { ...prev, validation: details.validation, canPublish: false } : prev));
      }
      setPublishError(caught instanceof Error ? caught.message : 'Could not publish.');
    } finally {
      setPublishing(false);
    }
  }

  async function copyItem(targetMenuId: string) {
    if (!copyTarget) return;
    const target = otherMenus.find((menu) => menu.id === targetMenuId);
    setCopyTarget(null);
    const saved = await flushSave();
    if (!saved) {
      if (archivedRef.current) return; // this menu was archived; the read-only view says so
      setNotice({ tone: 'error', text: 'Save the draft before copying a dish to another menu.' });
      return;
    }
    const targetLabel = target ? `${target.venue.name} · ${target.name}` : 'the other menu';
    try {
      await menuApi.copyItemTo(menuId, { dishKey: copyTarget.dishKey, targetMenuId });
      setNotice({ tone: 'success', text: `"${copyTarget.name}" copied to the ${targetLabel} draft.` });
    } catch (caught) {
      const archivedId = archivedMenuIdOf(caught);
      if (archivedId === targetMenuId) {
        // The menu copied into was archived; this one is fine and stays editable.
        setOtherMenus((prev) => prev.filter((menu) => menu.id !== targetMenuId));
        setNotice({ tone: 'error', text: `${targetLabel} was archived, so "${copyTarget.name}" was not copied. Pick another menu.` });
        return;
      }
      if (archivedId !== null) {
        enterArchived(latestDoc.current);
        return;
      }
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : 'Could not copy the dish.' });
    }
  }

  // ------------------------------------------------------------ render
  if (loading) {
    return (
      <div className="menus-loading">
        <Spinner label="Loading menu" />
      </div>
    );
  }
  if (loadError || !summary) {
    return (
      <EmptyState
        title="Could not load this menu"
        description={loadError ?? 'Unknown error.'}
        action={
          <div className="menus-actions-row">
            <Button onClick={() => void load()}>Try again</Button>
            <Link className="btn btn-secondary btn-md" to="/"><span>Back to Menus</span></Link>
          </div>
        }
      />
    );
  }

  const header = (
    <div className="editor-head">
      <div className="editor-head-titles">
        <Link to="/" className="editor-back">
          <IconArrowLeft /> <span>All menus</span>
        </Link>
        <h1>
          {summary.venue.name} <em>{summary.name}</em>
        </h1>
        <p className="subtle">
          {summary.published ? `Live: v${summary.published.versionNumber}, published ${formatWhen(summary.published.publishedAt)} by ${personName(summary.published.publishedBy)}.` : 'Nothing published yet.'}
        </p>
      </div>
      <div className="editor-head-actions">
        <Link className="btn btn-secondary btn-md" to={`/menus/${menuId}/history`}><span>History</span></Link>
      </div>
    </div>
  );

  if (justPublished) {
    return (
      <>
        {header}
        <Card title={`Published v${justPublished.version.versionNumber}`} subtitle={`${summary.venue.name} · ${summary.name} · ${formatWhen(justPublished.version.publishedAt)}`}>
          <p>The PDF is stored with this version. Print it for the venue, or download it.</p>
          <div className="menus-actions-row">
            <Button onClick={() => void openVersionPdf(justPublished.version.id, 'print', pdfFilename(summary, justPublished.version.versionNumber))}>Print</Button>
            <Button variant="secondary" onClick={() => void openVersionPdf(justPublished.version.id, 'download', pdfFilename(summary, justPublished.version.versionNumber))}>Download PDF</Button>
            <Button variant="ghost" onClick={() => void openVersionPdf(justPublished.version.id, 'view', pdfFilename(summary, justPublished.version.versionNumber))}>Open PDF</Button>
            <Button variant="ghost" onClick={() => { setJustPublished(null); void startDraft(); }}>Start another draft</Button>
            <Link className="btn btn-ghost btn-md" to="/"><span>Back to Menus</span></Link>
          </div>
        </Card>
      </>
    );
  }

  const unsavedCard = (where: 'archived' | 'draft' | 'no-draft') => {
    if (!unsaved) return null;
    const { changes, kept } = unsaved;
    const applied = where === 'draft' && applyPending === changes.id;
    const against = where === 'draft' && doc ? doc : savedDocRef.current;
    const diff = against ? diffMenuDocuments(against, changes.document) : null;
    const forget = () => {
      if (!window.confirm('Forget these unsaved changes? They are not on the server, so this cannot be undone.')) return;
      forgetUnsavedChanges(menuId, changes.id);
      if (pendingApplyRef.current?.recoveryId === changes.id) pendingApplyRef.current = null;
      setApplyPending(null);
      setUnsaved(null);
      setNotice(null);
    };
    // Applying only puts the copy into the editor. The copy and this card stay
    // until a save carrying it succeeds (see saveNow); a rejected or failed
    // save, or a reload, leaves it here to apply again.
    const apply = () => {
      // Applying again replaces whatever was typed since the first apply.
      if (applied && doc && !menuDocumentsEqual(doc, changes.document) && !window.confirm('Apply again? It replaces everything in the editor, including anything typed since you last applied, with the kept copy.')) return;
      const seq = update(() => withClientKeys(changes.document));
      if (seq === null) return;
      pendingApplyRef.current = { recoveryId: changes.id, editSeq: seq };
      setApplyPending(changes.id);
      setNotice({ tone: 'info', text: 'Your recovered changes are in the editor. The kept copy stays until the draft has saved them.' });
    };
    const appliedStatus = !applied
      ? null
      : saveState.kind === 'conflict' || saveState.kind === 'error'
        ? `Not saved yet: ${saveState.message} The kept copy is still here; reload or retry, then apply again if needed.`
        : 'Applied to the editor. The kept copy stays until the draft has saved it.';
    return (
      <Card
        className="unsaved-card"
        title={where === 'archived' ? 'Your unsaved changes' : `Unsaved changes from ${formatWhen(changes.keptAt)}`}
        subtitle={
          where === 'archived'
            ? kept
              ? 'Not saved: this menu was archived while you were editing. They are kept in this browser.'
              : 'Not saved: this menu was archived while you were editing. This browser could not keep them, so download them before leaving this page.'
            : `Not saved when this menu was archived (draft v${changes.draftVersionNumber}). Kept in this browser.`
        }
      >
        {appliedStatus ? (
          <p className={saveState.kind === 'conflict' || saveState.kind === 'error' ? 'error-text' : 'subtle'} role="status">
            {appliedStatus}
          </p>
        ) : null}
        {diff ? (
          <>
            <p className="menu-dialog-summary">{summariseMenuDiff(diff)}</p>
            <DiffView diff={diff} templateTitle={isMenuTemplateKey(summary.templateKey) ? MENU_TEMPLATES[summary.templateKey].title : undefined} emptyText={applied ? 'The editor holds this copy now.' : 'Same as the editor now.'} />
          </>
        ) : null}
        {appliedStatus ? null : (
          <p className="subtle">
            {where === 'archived'
              ? 'When a publisher unarchives the menu, open it here and choose Apply to put them back into the draft.'
              : where === 'draft'
                ? 'Apply replaces what the editor holds now with the version you were editing. This copy is kept until the draft has saved it.'
                : 'Start a draft, then apply them.'}
          </p>
        )}
        <div className="menus-actions-row">
          {where === 'draft' ? <Button onClick={apply}>{applied ? 'Apply again' : 'Apply to this draft'}</Button> : null}
          <Button variant="secondary" onClick={() => downloadUnsavedChanges(changes)}>Download a copy</Button>
          <Button variant="ghost" onClick={forget}>Forget them</Button>
        </div>
      </Card>
    );
  };

  if (summary.status === 'ARCHIVED') {
    return (
      <>
        {header}
        <EmptyState
          title="This menu is archived"
          description="It is read-only until a publisher unarchives it from the Menus home. Its versions and PDFs are in History; its draft is kept as it was when it was archived."
          action={
            <div className="menus-actions-row">
              <Link className="btn btn-secondary btn-md" to={`/menus/${menuId}/history`}><span>History</span></Link>
              <Link className="btn btn-ghost btn-md" to="/"><span>Back to Menus</span></Link>
            </div>
          }
        />
        {unsavedCard('archived')}
      </>
    );
  }

  if (!draft || !doc) {
    return (
      <>
        {header}
        {notice ? <p className={notice.tone === 'error' ? 'error-text' : 'subtle'}>{notice.text}</p> : null}
        <EmptyState
          title="No draft in progress"
          description={summary.published ? `Start a draft from the live v${summary.published.versionNumber}. Nothing changes for the venue until you publish.` : 'Start the first draft of this menu.'}
          action={<Button onClick={() => void startDraft()}>{summary.published ? 'Start a draft' : 'Start the first draft'}</Button>}
        />
        {unsavedCard('no-draft')}
      </>
    );
  }

  const publisher = canPublishMenus(user);
  const saveLabel =
    saveState.kind === 'saving'
      ? 'Saving…'
      : saveState.kind === 'dirty'
        ? 'Unsaved changes'
        : saveState.kind === 'saved'
          ? `Saved ${formatWhen(saveState.at)}`
          : saveState.kind === 'error'
            ? `Not saved: ${saveState.message}`
            : saveState.kind === 'conflict'
              ? saveState.message
              : '';

  return (
    <>
      {header}
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <Badge tone="warning" dot>Draft v{draft.version.versionNumber}</Badge>
          <span className={`editor-save-state is-${saveState.kind}`}>{saveLabel}</span>
          {saveState.kind === 'conflict' ? (
            <Button size="sm" variant="secondary" onClick={() => void load()}>Reload their changes</Button>
          ) : saveState.kind === 'error' ? (
            <Button size="sm" variant="secondary" onClick={() => void saveNow()}>Retry save</Button>
          ) : null}
        </div>
        <div className="editor-toolbar-right">
          <Button variant="ghost" size="sm" onClick={() => void discardDraft()}>Discard draft</Button>
          {publisher ? (
            <Button onClick={() => void openPublish()} disabled={saveState.kind === 'conflict'}>Publish…</Button>
          ) : (
            <span className="subtle">Managers and the head chef publish.</span>
          )}
        </div>
      </div>
      {notice ? <p className={notice.tone === 'error' ? 'error-text' : 'editor-notice'} role="status">{notice.text}</p> : null}
      {unsavedCard('draft')}

      <div className="editor-tabs" role="tablist" aria-label="Editor view">
        <button type="button" role="tab" aria-selected={mobileTab === 'edit'} className={mobileTab === 'edit' ? 'active' : ''} onClick={() => setMobileTab('edit')}>
          Edit
        </button>
        <button type="button" role="tab" aria-selected={mobileTab === 'preview'} className={mobileTab === 'preview' ? 'active' : ''} onClick={() => setMobileTab('preview')}>
          Preview{fill ? ` · ${Math.round(fill.fillRatio * 100)}%` : ''}
        </button>
      </div>

      <div className={`editor-split is-${mobileTab}`}>
        <div className="editor-form">
          <HeadingEditor doc={doc} templateKey={summary.templateKey} onChange={update} />
          <ValidationPanel errors={errors} warnings={warnings} fill={fill} onJump={jumpTo} />
          <SectionsEditor doc={doc} onChange={update} onCopy={(item) => setCopyTarget({ dishKey: item.dishKey ?? '', name: item.name })} canCopy={otherMenus.length > 0} />
          <FooterEditor doc={doc} onChange={update} />
        </div>
        <aside className="editor-preview">
          <div className="editor-preview-sticky">
            <MenuPreview document={doc} templateKey={summary.templateKey} onFill={handleFill} focusDishKey={focusDishKey} />
            <p className="subtle editor-preview-note">Live preview, same template as the PDF. Hidden (86'd) items are left off.</p>
          </div>
        </aside>
      </div>

      <PublishDialog
        open={publishOpen}
        preview={publishPreview}
        loading={publishLoading}
        publishing={publishing}
        error={publishError}
        publishedVersion={draft.publishedVersion}
        draftVersionNumber={draft.version.versionNumber}
        templateTitle={isMenuTemplateKey(summary.templateKey) ? MENU_TEMPLATES[summary.templateKey].title : undefined}
        onConfirm={() => void confirmPublish()}
        onClose={() => setPublishOpen(false)}
      />

      {copyTarget ? (
        <div className="menu-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="copy-title" onClick={() => setCopyTarget(null)}>
          <div className="menu-sheet" onClick={(event) => event.stopPropagation()}>
            <h3 id="copy-title">Copy “{copyTarget.name}” to another menu</h3>
            <p className="subtle">The dish is added to that menu's draft (started from its live version if there is none). The two copies are then edited separately.</p>
            <div className="menus-actions-row">
              {otherMenus.map((menu) => (
                <Button key={menu.id} onClick={() => void copyItem(menu.id)}>
                  {menu.venue.name} · {menu.name}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setCopyTarget(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sections and items
// ---------------------------------------------------------------------------

type Mutate = (mutate: (prev: MenuDocument) => MenuDocument) => void;

function SectionsEditor({ doc, onChange, onCopy, canCopy }: { doc: MenuDocument; onChange: Mutate; onCopy: (item: MenuItemDocument) => void; canCopy: boolean }) {
  const moveSection = useCallback((from: number, to: number) => onChange((prev) => ({ ...prev, sections: moveItem(prev.sections, from, to) })), [onChange]);
  const { drag, register, handleProps } = useDragReorder(doc.sections.length, moveSection);

  return (
    <div className="sections-editor">
      {doc.sections.map((section, sectionIndex) => (
        <SectionCard
          key={(section as EditorSection).clientKey ?? section.id ?? `new-${sectionIndex}`}
          section={section}
          sectionIndex={sectionIndex}
          dragging={drag?.from === sectionIndex}
          dropTarget={drag !== null && drag.over === sectionIndex && drag.from !== sectionIndex}
          registerRow={register(sectionIndex)}
          handleProps={handleProps(sectionIndex)}
          canCopy={canCopy}
          onCopy={onCopy}
          onChange={(mutate) => onChange((prev) => ({ ...prev, sections: prev.sections.map((s, i) => (i === sectionIndex ? mutate(s) : s)) }))}
          onDelete={() => {
            const label = section.title.trim() || `section ${sectionIndex + 1}`;
            const count = section.items.length;
            if (!window.confirm(`Delete ${label}${count ? ` and its ${count} item${count === 1 ? '' : 's'}` : ''}? Hide it instead if it is coming back.`)) return;
            onChange((prev) => ({ ...prev, sections: prev.sections.filter((_, i) => i !== sectionIndex) }));
          }}
        />
      ))}
      <Button variant="secondary" leftIcon={<IconPlus />} onClick={() => onChange((prev) => ({ ...prev, sections: [...prev.sections, emptySection()] }))}>
        Add section
      </Button>
    </div>
  );
}

type SectionCardProps = {
  section: MenuSectionDocument;
  sectionIndex: number;
  dragging: boolean;
  dropTarget: boolean;
  registerRow: (element: HTMLElement | null) => void;
  handleProps: Record<string, unknown>;
  canCopy: boolean;
  onCopy: (item: MenuItemDocument) => void;
  onChange: (mutate: (prev: MenuSectionDocument) => MenuSectionDocument) => void;
  onDelete: () => void;
};

function SectionCard({ section, sectionIndex, dragging, dropTarget, registerRow, handleProps, canCopy, onCopy, onChange, onDelete }: SectionCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const moveRow = useCallback((from: number, to: number) => onChange((prev) => ({ ...prev, items: moveItem(prev.items, from, to) })), [onChange]);
  const items = useDragReorder(section.items.length, moveRow);
  const isSet = section.sectionType === 'SET_MENUS';
  const namesOnly = section.sectionType === 'HEADER_PRICED';

  return (
    <section
      ref={registerRow}
      id={sectionDomId(sectionIndex)}
      className={`section-card${section.visible ? '' : ' is-hidden'}${dragging ? ' is-dragging' : ''}${dropTarget ? ' is-drop-target' : ''}`}
    >
      <header className="section-card-head">
        <button type="button" className="drag-handle" aria-label="Drag to reorder section (Alt+arrow keys to move)" title="Drag to reorder" {...handleProps}>
          ⋮⋮
        </button>
        <input
          className="section-title-input"
          data-field="name"
          value={section.title}
          maxLength={MENU_LIMITS.titleMax}
          placeholder="Section title"
          onChange={(event) => {
            const value = event.currentTarget.value;
            onChange((prev) => ({ ...prev, title: value }));
          }}
        />
        <label className="section-toggle">
          <input type="checkbox" checked={section.visible} onChange={(event) => { const checked = event.currentTarget.checked; onChange((prev) => ({ ...prev, visible: checked })); }} />
          <span>{section.visible ? 'On the print' : 'Hidden'}</span>
        </label>
        <button type="button" className="section-collapse" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
          {collapsed ? `Show ${section.items.length}` : 'Collapse'}
        </button>
      </header>
      {collapsed ? null : (
        <>
          <div className="section-card-settings">
            <label className="field">
              <span className="field-label">Type</span>
              <select className="field-control" value={section.sectionType} onChange={(event) => { const value = event.currentTarget.value as MenuSectionDocument['sectionType']; onChange((prev) => ({ ...prev, sectionType: value })); }}>
                {MENU_SECTION_TYPES.map((type) => (
                  <option key={type} value={type}>{MENU_SECTION_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Placement</span>
              <select className="field-control" value={section.placement} onChange={(event) => { const value = event.currentTarget.value as MenuSectionDocument['placement']; onChange((prev) => ({ ...prev, placement: value })); }}>
                {MENU_PLACEMENTS.map((placement) => (
                  <option key={placement} value={placement}>{MENU_PLACEMENT_LABELS[placement]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Heading suffix</span>
              <input className="field-control" value={section.headerSuffix ?? ''} maxLength={MENU_LIMITS.headerSuffixMax} placeholder={namesOnly ? '9 each' : 'optional'} onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, headerSuffix: value.trim() ? value : null })); }} />
            </label>
            {isSet ? (
              <label className="field">
                <span className="field-label">Subheading</span>
                <input className="field-control" value={section.subheading ?? ''} maxLength={MENU_LIMITS.subheadingMax} placeholder="For the whole table." onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, subheading: value.trim() ? value : null })); }} />
              </label>
            ) : null}
          </div>

          <ol className="item-list">
            {section.items.map((item, itemIndex) => (
              <ItemRow
                key={item.dishKey ?? item.id ?? itemIndex}
                item={item}
                sectionIndex={sectionIndex}
                itemIndex={itemIndex}
                sectionType={section.sectionType}
                dragging={items.drag?.from === itemIndex}
                dropTarget={items.drag !== null && items.drag.over === itemIndex && items.drag.from !== itemIndex}
                registerRow={items.register(itemIndex)}
                handleProps={items.handleProps(itemIndex)}
                canCopy={canCopy}
                onCopy={() => onCopy(item)}
                onChange={(mutate) => onChange((prev) => ({ ...prev, items: prev.items.map((it, i) => (i === itemIndex ? mutate(it) : it)) }))}
                onDuplicate={() =>
                  onChange((prev) => {
                    const copy: MenuItemDocument = { ...item, id: undefined, dishKey: newDishKey(item.name), name: item.name ? `${item.name} (copy)` : '' };
                    const next = [...prev.items];
                    next.splice(itemIndex + 1, 0, copy);
                    return { ...prev, items: next };
                  })
                }
                onDelete={() => {
                  if (!window.confirm(`Delete "${item.name || 'this dish'}" from ${section.title || 'this section'}? Use 86 to take it off the print but keep it.`)) return;
                  onChange((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== itemIndex) }));
                }}
              />
            ))}
          </ol>
          <div className="section-card-foot">
            <Button size="sm" variant="secondary" leftIcon={<IconPlus />} onClick={() => onChange((prev) => ({ ...prev, items: [...prev.items, { ...emptyItem(), priceUnit: isSet ? 'pp' : null }] }))}>
              Add {isSet ? 'set menu' : 'dish'}
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<IconTrash />} onClick={onDelete}>
              Delete section
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

type ItemRowProps = {
  item: MenuItemDocument;
  sectionIndex: number;
  itemIndex: number;
  sectionType: MenuSectionDocument['sectionType'];
  dragging: boolean;
  dropTarget: boolean;
  registerRow: (element: HTMLElement | null) => void;
  handleProps: Record<string, unknown>;
  canCopy: boolean;
  onCopy: () => void;
  onChange: (mutate: (prev: MenuItemDocument) => MenuItemDocument) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function ItemRow({ item, sectionIndex, itemIndex, sectionType, dragging, dropTarget, registerRow, handleProps, canCopy, onCopy, onChange, onDuplicate, onDelete }: ItemRowProps) {
  const namesOnly = sectionType === 'HEADER_PRICED';
  const isSet = sectionType === 'SET_MENUS';
  const [priceText, setPriceText] = useState(item.priceCents === null ? '' : String(Math.round(item.priceCents / 100)));
  const [priceInvalid, setPriceInvalid] = useState(false);
  useEffect(() => {
    setPriceText(item.priceCents === null ? '' : String(Math.round(item.priceCents / 100)));
  }, [item.priceCents]);

  return (
    <li ref={registerRow} id={itemDomId(sectionIndex, itemIndex)} className={`item-row${item.visible ? '' : ' is-86'}${dragging ? ' is-dragging' : ''}${dropTarget ? ' is-drop-target' : ''}`}>
      <button type="button" className="drag-handle" aria-label="Drag to reorder dish (Alt+arrow keys to move)" title="Drag to reorder" {...handleProps}>
        ⋮⋮
      </button>
      <div className="item-row-main">
        <div className="item-row-top">
          <input
            className="item-name"
            data-field="name"
            value={item.name}
            maxLength={MENU_LIMITS.nameMax}
            placeholder={isSet ? 'Set menu name' : 'Dish name'}
            onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, name: value })); }}
          />
          {namesOnly ? null : (
            <label className={`item-price${priceInvalid ? ' is-invalid' : ''}`}>
              <span aria-hidden="true">$</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={priceText}
                placeholder="—"
                aria-label="Price in whole dollars"
                onChange={(event) => {
                  const text = event.currentTarget.value;
                  setPriceText(text);
                  const parsed = parseMenuPriceInput(text);
                  if (parsed === undefined) {
                    setPriceInvalid(true);
                    return;
                  }
                  setPriceInvalid(false);
                  onChange((prev) => ({ ...prev, priceCents: parsed }));
                }}
                onBlur={() => {
                  if (priceInvalid) {
                    setPriceText(item.priceCents === null ? '' : String(Math.round(item.priceCents / 100)));
                    setPriceInvalid(false);
                  }
                }}
              />
              {isSet ? (
                <input className="item-price-unit" value={item.priceUnit ?? ''} maxLength={MENU_LIMITS.priceUnitMax} placeholder="pp" aria-label="Price unit" onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, priceUnit: value.trim() ? value.trim() : null })); }} />
              ) : null}
            </label>
          )}
        </div>
        {namesOnly ? null : (
          <textarea
            className="item-description"
            rows={1}
            value={item.description ?? ''}
            maxLength={MENU_LIMITS.descriptionMax}
            placeholder={isSet ? 'One line about the package' : 'Description, in italic under the name'}
            onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, description: value.trim() ? value : null })); }}
          />
        )}
        {isSet ? null : (
          <div className="item-tags" role="group" aria-label="Dietary tags">
            {MENU_TAGS.map((tag) => {
              const on = item.tags.includes(tag.code);
              return (
                <button
                  key={tag.code}
                  type="button"
                  className={`tag-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  title={tag.label}
                  onClick={() => onChange((prev) => ({ ...prev, tags: on ? prev.tags.filter((code) => code !== tag.code) : [...prev.tags, tag.code] }))}
                >
                  {tag.code}
                </button>
              );
            })}
            <label className="tag-chip tag-chip-check" title="Seafood must carry A or I">
              <input type="checkbox" checked={item.isSeafood} onChange={(event) => { const checked = event.currentTarget.checked; onChange((prev) => ({ ...prev, isSeafood: checked })); }} />
              <span>Seafood</span>
            </label>
          </div>
        )}
        <div className="item-row-actions">
          <button type="button" className={`item-86${item.visible ? '' : ' is-on'}`} aria-pressed={!item.visible} onClick={() => onChange((prev) => ({ ...prev, visible: !prev.visible }))}>
            {item.visible ? '86' : "86'd — bring back"}
          </button>
          <button type="button" className="item-action" onClick={onDuplicate}>Duplicate</button>
          {canCopy ? <button type="button" className="item-action" onClick={onCopy} disabled={!item.dishKey}>Copy to another menu</button> : null}
          <button type="button" className="item-action is-danger" onClick={onDelete}>Delete</button>
          {!namesOnly && item.priceCents !== null ? <span className="item-print-price subtle">prints {formatMenuPrice(item.priceCents, item.priceUnit)}</span> : null}
        </div>
      </div>
    </li>
  );
}

/** The italic title line under the logo. Blank prints the template's own title, so the two existing menus keep reading "À la carte". */
function HeadingEditor({ doc, templateKey, onChange }: { doc: MenuDocument; templateKey: string; onChange: Mutate }) {
  const templateTitle = isMenuTemplateKey(templateKey) ? MENU_TEMPLATES[templateKey].title : 'À la carte';
  return (
    <Card title="Heading" subtitle={`The italic line under the logo. Blank prints “${templateTitle}”.`}>
      <label className="field">
        <span className="field-label">Printed heading</span>
        <input
          className="field-control"
          value={doc.heading}
          maxLength={MENU_LIMITS.headingMax}
          placeholder={templateTitle}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onChange((prev) => ({ ...prev, heading: value }));
          }}
        />
      </label>
    </Card>
  );
}

function FooterEditor({ doc, onChange }: { doc: MenuDocument; onChange: Mutate }) {
  return (
    <Card title="Footer" subtitle="The tag legend is generated from the tags in use; only these two lines are typed.">
      <label className="field">
        <span className="field-label">Dietary note</span>
        <input className="field-control" value={doc.dietaryNote} maxLength={MENU_LIMITS.footerLineMax} onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, dietaryNote: value })); }} />
      </label>
      <label className="field">
        <span className="field-label">Surcharge line</span>
        <input className="field-control" value={doc.surchargeLine} maxLength={MENU_LIMITS.footerLineMax} onChange={(event) => { const value = event.currentTarget.value; onChange((prev) => ({ ...prev, surchargeLine: value })); }} />
      </label>
    </Card>
  );
}

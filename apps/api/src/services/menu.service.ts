import { prisma } from '@alma/db';
import type { Prisma } from '@prisma/client';
import {
  diffMenuDocuments,
  ensureDishKeys,
  getMenuTemplate,
  isMenuKind,
  isMenuTemplateKey,
  MENU_FORMATS,
  MENU_KINDS,
  MENU_LIMITS,
  menuCopyItemInputSchema,
  menuCreateInputSchema,
  menuDiffIsEmpty,
  menuDocumentsEqual,
  menuDraftSaveInputSchema,
  menuPrintedHeading,
  menuPublishInputSchema,
  menuRestoreInputSchema,
  menuSlug,
  menuTemplatesForVenue,
  menuUpdateInputSchema,
  newDishKey,
  normaliseMenuDocument,
  overflowIssue,
  renderMenuHtml,
  sortMenuItemFlags,
  sortMenuTags,
  summariseMenuDiff,
  validateMenuDocument,
  type AuthUser,
  type MenuActor,
  type MenuAuditEntry,
  type MenuDiff,
  type MenuDocument,
  type MenuDraftPayload,
  type MenuEventDetails,
  type MenuHeader,
  type MenuKind,
  type MenuListPayload,
  type MenuPublishPreview,
  type MenuSnapshot,
  type MenuStatus,
  type MenuSummary,
  type MenuTemplate,
  type MenuVenueSummary,
  type MenuValidationResult,
  type MenuVersionPayload,
  type MenuVersionSummary,
  type MenuVisibility,
  type PublicMenuDocument,
  type PublicMenuSummary
} from '@alma/shared';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { loadMenuRenderAssets, MenuAssetError } from '../lib/menu-assets.js';
import { chromeStatus, renderMenuPdf, measureMenuFill } from '../lib/menu-pdf.js';

/**
 * Alma Menus — drafts, publishing, history, the audit trail and the public
 * read surface the website uses.
 *
 * Invariants this service keeps:
 *   - one DRAFT per menu at most; one PUBLISHED at most; the rest ARCHIVED.
 *   - a published or archived version is never changed again. Its snapshot
 *     and PDF are written once, at publish, and only read after that.
 *   - restoring creates a new draft from a snapshot; it never rewrites history.
 *   - every change writes a MenuAuditEvent with who, what and a diff summary.
 *   - a dish keeps its dishKey through saves, clones and restores.
 *   - a venue has any number of menus of any kind (the à la carte, the drinks
 *     book, a Tuesday menu, a happy-hour card, an event menu), each with its
 *     own drafts, history and PDF. Archiving one takes it off the module home
 *     and freezes it; nothing is deleted.
 *   - a menu's slug is minted once, at creation, and never changes: it is what
 *     the website links. Renaming changes only the name.
 *   - the public endpoints serve PUBLISHED snapshots of PUBLIC, ACTIVE menus
 *     and nothing else — never a draft, never a private-event menu.
 *   - an archived menu is never written. Every write locks the Menu row
 *     (lockActiveMenu) and re-checks the status inside its own transaction;
 *     archive and unarchive take the same lock. So an archive can never
 *     commit between a write's check and its write: the write either lands
 *     before the archive or is refused after it. Two menus are always locked
 *     in id order.
 */

type VersionRow = Prisma.MenuVersionGetPayload<{ include: { sections: { include: { items: true } } } }>;
type VersionMeta = Prisma.MenuVersionGetPayload<{ select: typeof VERSION_SUMMARY_SELECT }>;

const VERSION_SUMMARY_SELECT = {
  id: true,
  menuId: true,
  versionNumber: true,
  state: true,
  publishedAt: true,
  publishedById: true,
  publishedByName: true,
  createdAt: true,
  updatedAt: true,
  updatedById: true,
  updatedByName: true,
  restoredFromVersionId: true,
  pdfByteSize: true,
  pdfGeneratedAt: true,
  pageCount: true
} as const;

const MENU_SELECT = {
  id: true,
  name: true,
  slug: true,
  kind: true,
  visibility: true,
  templateKey: true,
  status: true,
  eventName: true,
  eventDate: true,
  organiserRef: true,
  guestCount: true,
  venue: { select: { id: true, name: true, slug: true } }
} as const;

type MenuRow = Prisma.MenuGetPayload<{ select: typeof MENU_SELECT }>;

type Actor = { id: string | null; name: string | null; email: string | null };

export function menuActor(user: AuthUser | null | undefined): Actor {
  if (!user) return { id: null, name: null, email: null };
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return { id: user.id, name: name || user.email || null, email: user.email ?? null };
}

function asMenuActor(id: string | null, name: string | null): MenuActor {
  return id || name ? { id, name } : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function kindOf(menu: Pick<MenuRow, 'kind'>): MenuKind {
  return isMenuKind(menu.kind) ? menu.kind : 'FOOD';
}

function visibilityOf(menu: Pick<MenuRow, 'visibility'>): MenuVisibility {
  return menu.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
}

function eventOf(menu: MenuRow): MenuEventDetails {
  return { eventName: menu.eventName, eventDate: iso(menu.eventDate), organiserRef: menu.organiserRef, guestCount: menu.guestCount };
}

function versionSummary(version: VersionMeta): MenuVersionSummary {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    publishedAt: iso(version.publishedAt),
    publishedBy: asMenuActor(version.publishedById, version.publishedByName),
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    updatedBy: asMenuActor(version.updatedById, version.updatedByName),
    restoredFromVersionId: version.restoredFromVersionId,
    hasPdf: version.pdfByteSize !== null && version.pdfByteSize > 0,
    pdfByteSize: version.pdfByteSize,
    pageCount: version.pageCount
  };
}

function menuHeader(menu: MenuRow): MenuHeader {
  return { id: menu.id, name: menu.name, slug: menu.slug, kind: kindOf(menu), visibility: visibilityOf(menu), templateKey: menu.templateKey, venue: menu.venue };
}

function pricesFromJson(value: Prisma.JsonValue): Array<number | null> {
  return Array.isArray(value) ? value.map((price) => (typeof price === 'number' ? price : null)) : [];
}

/** The editable document from live draft rows (ids and dish keys included). */
function documentFromRows(version: VersionRow): MenuDocument {
  return {
    heading: version.heading,
    subheading: version.subheading,
    whenLine: version.whenLine,
    heroPriceCents: version.heroPriceCents,
    heroPriceUnit: version.heroPriceUnit,
    conditions: version.conditions,
    showPrices: version.showPrices,
    pageCount: version.pageCount,
    dietaryNote: version.dietaryNote,
    surchargeLine: version.surchargeLine,
    sections: [...version.sections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((section) => ({
        id: section.id,
        title: section.title,
        headerSuffix: section.headerSuffix,
        subheading: section.subheading,
        sectionType: section.sectionType,
        placement: section.placement,
        page: section.page,
        lead: section.lead,
        body: section.body,
        priceColumns: section.priceColumns,
        visible: section.visible,
        items: [...section.items]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => ({
            id: item.id,
            dishKey: item.dishKey,
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            priceUnit: item.priceUnit,
            prices: pricesFromJson(item.prices),
            meta: item.meta,
            note: item.note,
            flags: sortMenuItemFlags(item.flags),
            tags: sortMenuTags(item.tags),
            isSeafood: item.isSeafood,
            visible: item.visible,
            recipeId: item.recipeId
          }))
      }))
  };
}

/** Row ids stripped: a snapshot outlives the rows it was taken from. */
function stripIds(doc: MenuDocument): MenuDocument {
  return {
    ...doc,
    sections: doc.sections.map(({ id: _sectionId, ...section }) => ({
      ...section,
      items: section.items.map(({ id: _itemId, ...item }) => item)
    }))
  };
}

function snapshotDocument(version: { snapshotJson: Prisma.JsonValue | null }): MenuDocument | null {
  const snapshot = version.snapshotJson as unknown as MenuSnapshot | null;
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.sections)) return null;
  // Versions published before V2 carry neither the card fields nor pages; they read as their defaults.
  return normaliseMenuDocument(snapshot);
}

/** A version's document, from the live rows for a draft and from the snapshot otherwise. */
function documentFor(version: VersionRow): MenuDocument {
  if (version.state === 'DRAFT') return documentFromRows(version);
  return snapshotDocument(version) ?? documentFromRows(version);
}

async function loadMenu(menuId: string): Promise<MenuRow> {
  const menu = await prisma.menu.findUnique({ where: { id: menuId }, select: MENU_SELECT });
  if (!menu) throw new HttpError(404, 'That menu does not exist.');
  return menu;
}

function templateFor(menu: Pick<MenuRow, 'templateKey'>): MenuTemplate {
  return getMenuTemplate(menu.templateKey);
}

/**
 * The one answer to a write on an archived menu. `menuId` says which menu, so
 * a client copying a dish can tell an archived target from an archived source.
 */
function archivedError(menu: Pick<MenuRow, 'id' | 'name' | 'venue'>): HttpError {
  return new HttpError(409, `${menu.venue.name} · ${menu.name} is archived. Unarchive it from the Menus home before changing it.`, {
    code: 'MENU_ARCHIVED',
    menuId: menu.id
  });
}

/**
 * Fast refusal before any work (a PDF render, a diff) for a menu already
 * archived. Not the guarantee: that is lockActiveMenu inside the transaction.
 * An archived menu can still be read, diffed and its PDFs opened.
 */
function requireActive(menu: MenuRow): MenuRow {
  if (menu.status === 'ARCHIVED') throw archivedError(menu);
  return menu;
}

type LockedMenu = { id: string; name: string; status: string; venueId: string };

/**
 * Lock Menu rows for the rest of the transaction (SELECT … FOR UPDATE), one at
 * a time in id order. Every path that locks more than one menu uses this, so
 * two transactions touching the same pair (a copy A→B beside a copy B→A) queue
 * instead of deadlocking.
 */
async function lockMenus(tx: Prisma.TransactionClient, menuIds: string[]): Promise<Map<string, LockedMenu>> {
  const locked = new Map<string, LockedMenu>();
  for (const id of [...new Set(menuIds)].sort()) {
    const rows = await tx.$queryRaw<LockedMenu[]>`SELECT "id", "name", "status", "venueId" FROM "Menu" WHERE "id" = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new HttpError(404, 'That menu does not exist.');
    locked.set(id, row);
  }
  return locked;
}

/** Lock one menu and confirm, inside the transaction, that it is still live. */
async function lockActiveMenu(tx: Prisma.TransactionClient, menu: MenuRow): Promise<LockedMenu> {
  const locked = (await lockMenus(tx, [menu.id])).get(menu.id)!;
  if (locked.status === 'ARCHIVED') throw archivedError(menu);
  return locked;
}

/** An empty document on a template: the template's footer defaults, nothing else. */
function emptyDocument(template?: MenuTemplate): MenuDocument {
  return normaliseMenuDocument({
    dietaryNote: template?.defaults?.dietaryNote ?? '',
    surchargeLine: template?.defaults?.surchargeLine ?? '',
    sections: []
  });
}

/**
 * A venue's menu names are unique regardless of case or status, so "Tuesday"
 * and "tuesday" cannot both exist and an archived "NYE" blocks a new "NYE"
 * (unarchive it instead). The database's unique index on (venueId, name) is
 * the backstop for two creates of the exact same name racing past this check;
 * it is case-sensitive, so two publishers racing "Tuesday" against "tuesday"
 * in the same instant could both succeed — accepted, a rename fixes it.
 */
async function requireNameFree(venueId: string, name: string, exceptMenuId: string | null, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const clash = await client.menu.findFirst({
    where: { venueId, name: { equals: name, mode: 'insensitive' }, ...(exceptMenuId ? { id: { not: exceptMenuId } } : {}) },
    select: { id: true, name: true, status: true }
  });
  if (!clash) return;
  throw new HttpError(
    409,
    clash.status === 'ARCHIVED'
      ? `An archived menu is already called "${clash.name}" at this venue. Unarchive it, or pick another name.`
      : `This venue already has a menu called "${clash.name}". Pick another name.`,
    { code: 'NAME_TAKEN', menuId: clash.id, status: clash.status }
  );
}

/**
 * The public identifier, from the name, de-duplicated per venue ("tuesday",
 * "tuesday-2"). Archived menus keep theirs, so a slug is never reused for a
 * different menu while the old one exists.
 */
async function freeSlug(venueId: string, name: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const base = menuSlug(name);
  const taken = new Set((await client.menu.findMany({ where: { venueId, slug: { startsWith: base } }, select: { slug: true } })).map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new HttpError(409, 'Too many menus share this name at the venue. Pick a more specific one.');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

async function loadDraft(menuId: string): Promise<VersionRow | null> {
  return prisma.menuVersion.findFirst({
    where: { menuId, state: 'DRAFT' },
    include: { sections: { include: { items: true } } }
  });
}

async function loadPublished(menuId: string): Promise<VersionRow | null> {
  return prisma.menuVersion.findFirst({
    where: { menuId, state: 'PUBLISHED' },
    orderBy: { versionNumber: 'desc' },
    include: { sections: { include: { items: true } } }
  });
}

/**
 * The next version number, from the menu's own counter so a number is never
 * handed out twice — not from max(versionNumber), which would reuse a
 * discarded draft's number. Called inside the transaction that creates the
 * version; the row update serialises concurrent callers.
 */
async function nextVersionNumber(menuId: string, tx: Prisma.TransactionClient): Promise<number> {
  const menu = await tx.menu.update({ where: { id: menuId }, data: { versionCounter: { increment: 1 } }, select: { versionCounter: true } });
  // Self-heal if a version row is ever ahead of the counter (a menu created
  // before the counter existed, or rows written by hand): never hand out a
  // number that is already taken.
  const highest = await tx.menuVersion.aggregate({ where: { menuId }, _max: { versionNumber: true } });
  const taken = highest._max.versionNumber ?? 0;
  if (menu.versionCounter <= taken) {
    await tx.menu.update({ where: { id: menuId }, data: { versionCounter: taken + 1 } });
    return taken + 1;
  }
  return menu.versionCounter;
}

/** The version-level fields of a document, as the MenuVersion row stores them. */
function versionFields(doc: MenuDocument) {
  return {
    heading: doc.heading,
    subheading: doc.subheading,
    whenLine: doc.whenLine,
    heroPriceCents: doc.heroPriceCents,
    heroPriceUnit: doc.heroPriceUnit,
    conditions: doc.conditions,
    showPrices: doc.showPrices,
    pageCount: doc.pageCount,
    dietaryNote: doc.dietaryNote,
    surchargeLine: doc.surchargeLine
  };
}

/** Write the rows of a document under a version. Dish keys must already be set. */
async function writeDocumentRows(tx: Prisma.TransactionClient, versionId: string, doc: MenuDocument) {
  await tx.menuSection.deleteMany({ where: { menuVersionId: versionId } });
  for (const [sectionIndex, section] of doc.sections.entries()) {
    await tx.menuSection.create({
      data: {
        menuVersionId: versionId,
        title: section.title,
        headerSuffix: section.headerSuffix,
        subheading: section.subheading,
        sectionType: section.sectionType,
        placement: section.placement,
        page: section.page,
        lead: section.lead,
        body: section.body,
        priceColumns: section.priceColumns,
        sortOrder: sectionIndex,
        visible: section.visible,
        items: {
          create: section.items.map((item, itemIndex) => ({
            dishKey: item.dishKey ?? newDishKey(item.name),
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            priceUnit: item.priceUnit,
            prices: item.prices as Prisma.InputJsonValue,
            meta: item.meta,
            note: item.note,
            flags: item.flags,
            tags: item.tags,
            isSeafood: item.isSeafood,
            sortOrder: itemIndex,
            visible: item.visible,
            recipeId: item.recipeId
          }))
        }
      }
    });
  }
}

async function audit(
  tx: Prisma.TransactionClient | typeof prisma,
  input: { menuId: string | null; menuVersionId: string | null; action: string; summary: string; before?: unknown; after?: unknown; actor: Actor }
) {
  await tx.menuAuditEvent.create({
    data: {
      menuId: input.menuId,
      menuVersionId: input.menuVersionId,
      action: input.action,
      summary: input.summary,
      before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorEmail: input.actor.email
    }
  });
}

function requireDraft(draft: VersionRow | null): VersionRow {
  if (!draft) throw new HttpError(404, 'This menu has no draft. Start one from the published version first.');
  return draft;
}

function checkUpdatedAt(version: VersionRow, expected: string | undefined) {
  if (!expected) return;
  if (version.updatedAt.toISOString() !== expected) {
    throw new HttpError(409, 'Someone else saved this draft after you opened it. Reload to see their changes before saving yours.', {
      code: 'STALE_DRAFT',
      updatedAt: version.updatedAt.toISOString(),
      updatedBy: asMenuActor(version.updatedById, version.updatedByName)
    });
  }
}

function buildSnapshot(menu: MenuRow, version: { versionNumber: number }, doc: MenuDocument, publishedAt: Date | null): MenuSnapshot {
  return {
    schemaVersion: 2,
    menuId: menu.id,
    menuName: menu.name,
    templateKey: menu.templateKey,
    venue: menu.venue,
    versionNumber: version.versionNumber,
    publishedAt: iso(publishedAt),
    ...stripIds(doc)
  };
}

function renderAssetsOrThrow() {
  try {
    return loadMenuRenderAssets();
  } catch (error) {
    if (error instanceof MenuAssetError) throw new HttpError(503, error.message);
    throw error;
  }
}

/** The validator's options for a menu: rules by kind, pages by template. */
function validationOptions(menu: MenuRow) {
  const template = isMenuTemplateKey(menu.templateKey) ? templateFor(menu) : null;
  return { kind: kindOf(menu), maxPages: template?.multiPage ? template.maxPages ?? MENU_LIMITS.pagesMax : 1 };
}

function pageLabel(template: MenuTemplate): string {
  return `one ${MENU_FORMATS[template.format].label} page`;
}

async function draftPayload(menu: MenuRow, draft: VersionRow): Promise<MenuDraftPayload> {
  const published = await loadPublished(menu.id);
  return {
    menu: menuHeader(menu),
    version: versionSummary(draft),
    document: documentFromRows(draft),
    publishedDocument: published ? documentFor(published) : null,
    publishedVersion: published ? versionSummary(published) : null
  };
}

const KIND_ORDER = new Map<string, number>(MENU_KINDS.map((kind, index) => [kind, index]));

async function summaries(where: Prisma.MenuWhereInput): Promise<MenuSummary[]> {
  const menus = await prisma.menu.findMany({
    where,
    select: {
      ...MENU_SELECT,
      createdAt: true,
      versions: { where: { state: { in: ['DRAFT', 'PUBLISHED'] } }, select: { ...VERSION_SUMMARY_SELECT, heading: true }, orderBy: { versionNumber: 'desc' } }
    },
    // The venue's first menu of a kind (its à la carte) stays first; later menus follow in the order they were added.
    orderBy: [{ venue: { name: 'asc' } }, { createdAt: 'asc' }, { name: 'asc' }]
  });
  return menus
    .map((menu) => {
      const published = menu.versions.find((version) => version.state === 'PUBLISHED') ?? null;
      const draft = menu.versions.find((version) => version.state === 'DRAFT') ?? null;
      const candidates: Array<{ at: Date; by: MenuActor }> = [];
      if (draft) candidates.push({ at: draft.updatedAt, by: asMenuActor(draft.updatedById, draft.updatedByName) });
      if (published?.publishedAt) candidates.push({ at: published.publishedAt, by: asMenuActor(published.publishedById, published.publishedByName) });
      candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
      const last = candidates[0];
      return {
        ...menuHeader(menu),
        status: menu.status === 'ARCHIVED' ? 'ARCHIVED' : ('ACTIVE' as MenuStatus),
        printedHeading: isMenuTemplateKey(menu.templateKey)
          ? menuPrintedHeading({ heading: (published ?? draft)?.heading ?? '' }, getMenuTemplate(menu.templateKey))
          : ((published ?? draft)?.heading ?? ''),
        event: eventOf(menu),
        published: published ? versionSummary(published) : null,
        draft: draft ? versionSummary(draft) : null,
        lastEdited: last ? { at: last.at.toISOString(), by: last.by } : null,
        _createdAt: menu.createdAt
      };
    })
    .sort((a, b) => {
      if (a.venue.name !== b.venue.name) return a.venue.name.localeCompare(b.venue.name);
      const kindGap = (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99);
      if (kindGap !== 0) return kindGap;
      return a._createdAt.getTime() - b._createdAt.getTime();
    })
    .map(({ _createdAt: _ignored, ...summary }) => summary);
}

/** A public URL on the API host, as the website links it. */
function publicUrl(path: string): string {
  return `${env.publicApiUrl.replace(/\/$/, '')}${path}`;
}

function publicSummary(menu: MenuRow, version: VersionMeta & { heading: string }): PublicMenuSummary {
  const template = templateFor(menu);
  return {
    slug: menu.slug,
    kind: kindOf(menu),
    name: menu.name,
    heading: menuPrintedHeading({ heading: version.heading }, template),
    format: template.format,
    pageCount: version.pageCount,
    publishedAt: version.publishedAt?.toISOString() ?? version.updatedAt.toISOString(),
    versionId: version.id,
    pdfUrl: publicUrl(`/api/public/menus/${menu.venue.slug}/${menu.slug}.pdf?v=${version.id}`),
    jsonUrl: publicUrl(`/api/public/menus/${menu.venue.slug}/${menu.slug}.json?v=${version.id}`)
  };
}

/** The menu the public endpoints may serve: active, public, with a published version. 404 otherwise, never a hint. */
async function loadPublicMenu(venueSlug: string, slug: string): Promise<{ menu: MenuRow; version: VersionRow }> {
  const menu = await prisma.menu.findFirst({ where: { slug, status: 'ACTIVE', visibility: 'PUBLIC', venue: { slug: venueSlug } }, select: MENU_SELECT });
  const version = menu ? await loadPublished(menu.id) : null;
  if (!menu || !version || !isMenuTemplateKey(menu.templateKey)) throw new HttpError(404, 'No published menu by that name.');
  return { menu, version };
}

export const menuService = {
  // ---------------------------------------------------------------- home
  /** The live menus, every venue. */
  async list(): Promise<MenuSummary[]> {
    return summaries({ status: 'ACTIVE' });
  },

  /** Archived menus — off the home grid, kept with their history. */
  async listArchived(): Promise<MenuSummary[]> {
    return summaries({ status: 'ARCHIVED' });
  },

  /** Every venue with the print templates its menus may use (none means no menu can be added there yet). */
  async venues(): Promise<MenuVenueSummary[]> {
    const venues = await prisma.venue.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } });
    return venues.map((venue) => ({
      ...venue,
      templates: menuTemplatesForVenue(venue.slug).map((template) => ({
        key: template.key,
        label: template.label,
        title: template.title,
        kinds: template.kinds,
        format: template.format,
        multiPage: template.multiPage
      }))
    }));
  },

  /** GET /api/menus — everything the module home needs in one call. */
  async home(): Promise<MenuListPayload> {
    const [menus, archived, venues] = await Promise.all([this.list(), this.listArchived(), this.venues()]);
    return { menus, archived, venues, renderer: this.rendererStatus() };
  },

  async get(menuId: string): Promise<MenuSummary> {
    const [found] = await summaries({ id: menuId });
    if (!found) throw new HttpError(404, 'That menu does not exist.');
    return found;
  },

  // ---------------------------------------------------------------- menus
  /**
   * A new menu for a venue, with its first draft started — empty, or a copy of
   * another menu's live version (its draft when nothing is live yet). The copy
   * keeps dish keys, so a dish shared between the à la carte and the Tuesday
   * menu reads as the same dish to Menu Costing; recipe links are dropped when
   * the source belongs to another venue. The slug is minted here and never
   * changes.
   */
  async createMenu(input: unknown, user: AuthUser | undefined): Promise<MenuSummary> {
    const data = menuCreateInputSchema.parse(input);
    const actor = menuActor(user);
    const venue = await prisma.venue.findUnique({ where: { id: data.venueId }, select: { id: true, name: true, slug: true } });
    if (!venue) throw new HttpError(404, 'That venue does not exist.');

    const templates = menuTemplatesForVenue(venue.slug, data.kind);
    if (templates.length === 0) {
      throw new HttpError(409, `${venue.name} has no print template for a ${data.kind.toLowerCase().replace('_', ' ')} menu yet. Templates are code (packages/shared/src/menu-render.ts).`);
    }
    const templateKey = data.templateKey ?? (templates.length === 1 ? templates[0]!.key : null);
    if (!templateKey) throw new HttpError(400, `Choose which of ${venue.name}'s print templates this menu uses.`);
    const template = templates.find((candidate) => candidate.key === templateKey);
    if (!template) throw new HttpError(400, `That print template is not one of ${venue.name}'s for this kind of menu.`);

    await requireNameFree(venue.id, data.name, null);
    const visibility: MenuVisibility = data.visibility ?? (data.kind === 'PRIVATE_EVENT' ? 'PRIVATE' : 'PUBLIC');

    let source: { menu: MenuRow; version: VersionRow } | null = null;
    if (data.copyFromMenuId) {
      const sourceMenu = await loadMenu(data.copyFromMenuId);
      const sourceVersion = (await loadPublished(sourceMenu.id)) ?? (await loadDraft(sourceMenu.id));
      if (!sourceVersion) throw new HttpError(409, `${sourceMenu.venue.name} · ${sourceMenu.name} has nothing to copy yet.`);
      source = { menu: sourceMenu, version: sourceVersion };
    }
    let doc: MenuDocument = source ? stripIds(documentFor(source.version)) : emptyDocument(template);
    doc = { ...doc, heading: data.heading };
    // A single-sheet template cannot carry a multi-page copy: fold everything onto page 1.
    if (!template.multiPage && doc.pageCount > 1) {
      doc = { ...doc, pageCount: 1, sections: doc.sections.map((section) => ({ ...section, page: 1 })) };
    }
    if (source && source.menu.venue.id !== venue.id) {
      doc = { ...doc, sections: doc.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, recipeId: null })) })) };
    }
    doc = ensureDishKeys(doc);

    let menuId: string;
    try {
      menuId = await prisma.$transaction(async (tx) => {
        const slug = await freeSlug(venue.id, data.name, tx);
        const menu = await tx.menu.create({
          data: {
            venueId: venue.id,
            name: data.name,
            slug,
            kind: data.kind,
            visibility,
            templateKey,
            eventName: data.eventName ?? null,
            eventDate: data.eventDate ? new Date(data.eventDate) : null,
            organiserRef: data.organiserRef ?? null,
            guestCount: data.guestCount ?? null
          },
          select: { id: true }
        });
        await audit(tx, {
          menuId: menu.id,
          menuVersionId: null,
          action: 'menu.created',
          summary: `Created ${data.kind.toLowerCase().replace('_', ' ')} menu "${data.name}" for ${venue.name} (${template.label}).`,
          after: { name: data.name, slug, kind: data.kind, visibility, templateKey, copiedFromMenuId: source?.menu.id ?? null, copiedFromVersion: source?.version.versionNumber ?? null },
          actor
        });
        const versionNumber = await nextVersionNumber(menu.id, tx);
        const version = await tx.menuVersion.create({
          data: {
            menuId: menu.id,
            versionNumber,
            state: 'DRAFT',
            ...versionFields(doc),
            createdById: actor.id,
            createdByName: actor.name,
            updatedById: actor.id,
            updatedByName: actor.name
          }
        });
        await writeDocumentRows(tx, version.id, doc);
        await audit(tx, {
          menuId: menu.id,
          menuVersionId: version.id,
          action: 'draft.created',
          summary: source
            ? `Started draft v${versionNumber} as a copy of ${source.menu.venue.name} · ${source.menu.name} v${source.version.versionNumber}.`
            : `Started draft v${versionNumber} from an empty menu.`,
          actor
        });
        return menu.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `This venue already has a menu called "${data.name}". Pick another name.`, { code: 'NAME_TAKEN' });
      throw error;
    }
    return this.get(menuId);
  },

  /**
   * Rename, change visibility, or edit the private-event details. The name is
   * what the home card, the editor title and every PDF download filename show
   * (past versions included); the slug and the printed page do not change —
   * the heading on the page is edited in the editor.
   */
  async updateMenu(menuId: string, input: unknown, user: AuthUser | undefined): Promise<MenuSummary> {
    const menu = requireActive(await loadMenu(menuId));
    const actor = menuActor(user);
    const data = menuUpdateInputSchema.parse(input);
    const changes: Prisma.MenuUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const lines: string[] = [];
    if (data.name !== undefined && data.name !== menu.name) {
      await requireNameFree(menu.venue.id, data.name, menu.id);
      changes.name = data.name;
      before.name = menu.name;
      after.name = data.name;
      lines.push(`renamed "${menu.name}" to "${data.name}"`);
    }
    if (data.visibility !== undefined && data.visibility !== visibilityOf(menu)) {
      changes.visibility = data.visibility;
      before.visibility = visibilityOf(menu);
      after.visibility = data.visibility;
      lines.push(data.visibility === 'PUBLIC' ? 'made public (published versions may be served to the website)' : 'made private (never served publicly)');
    }
    const eventFields: Array<['eventName' | 'organiserRef' | 'guestCount', string | number | null | undefined]> = [
      ['eventName', data.eventName],
      ['organiserRef', data.organiserRef],
      ['guestCount', data.guestCount]
    ];
    for (const [field, value] of eventFields) {
      if (value === undefined || value === menu[field]) continue;
      (changes as Record<string, unknown>)[field] = value;
      before[field] = menu[field];
      after[field] = value;
      lines.push(`${field === 'eventName' ? 'event name' : field === 'organiserRef' ? 'organiser reference' : 'guest count'} set to ${value === null ? '—' : `"${value}"`}`);
    }
    if (data.eventDate !== undefined && (data.eventDate ?? null) !== iso(menu.eventDate)) {
      changes.eventDate = data.eventDate ? new Date(data.eventDate) : null;
      before.eventDate = iso(menu.eventDate);
      after.eventDate = data.eventDate ?? null;
      lines.push(`event date set to ${data.eventDate ? data.eventDate.slice(0, 10) : '—'}`);
    }
    if (lines.length === 0) return this.get(menuId);
    try {
      await prisma.$transaction(async (tx) => {
        await lockActiveMenu(tx, menu);
        if (changes.name) await requireNameFree(menu.venue.id, String(changes.name), menu.id, tx);
        await tx.menu.update({ where: { id: menuId }, data: changes });
        await audit(tx, {
          menuId,
          menuVersionId: null,
          action: changes.name && lines.length === 1 ? 'menu.renamed' : 'menu.updated',
          summary: `Menu ${lines.join('; ')}.`,
          before,
          after,
          actor
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `This venue already has a menu called "${data.name}". Pick another name.`, { code: 'NAME_TAKEN' });
      throw error;
    }
    return this.get(menuId);
  },

  /** Off the home grid. Versions, PDFs, the audit log and any draft are kept exactly as they are. */
  async archiveMenu(menuId: string, user: AuthUser | undefined): Promise<MenuSummary> {
    const menu = await loadMenu(menuId);
    const alreadyArchived = () => new HttpError(409, `${menu.venue.name} · ${menu.name} is already archived.`);
    if (menu.status === 'ARCHIVED') throw alreadyArchived();
    const actor = menuActor(user);
    await prisma.$transaction(async (tx) => {
      // The same row lock every write takes: a write already in its
      // transaction finishes first; one that has not started yet will find
      // the menu archived when it does.
      const locked = (await lockMenus(tx, [menuId])).get(menuId)!;
      if (locked.status === 'ARCHIVED') throw alreadyArchived();
      const draft = await tx.menuVersion.findFirst({ where: { menuId, state: 'DRAFT' }, select: { versionNumber: true } });
      await tx.menu.update({ where: { id: menuId }, data: { status: 'ARCHIVED' } });
      await audit(tx, {
        menuId,
        menuVersionId: null,
        action: 'menu.archived',
        summary: `Archived menu "${locked.name}".${draft ? ` Its unpublished draft v${draft.versionNumber} is kept.` : ''}`,
        before: { status: 'ACTIVE' },
        after: { status: 'ARCHIVED' },
        actor
      });
    });
    return this.get(menuId);
  },

  async unarchiveMenu(menuId: string, user: AuthUser | undefined): Promise<MenuSummary> {
    const menu = await loadMenu(menuId);
    const notArchived = () => new HttpError(409, `${menu.venue.name} · ${menu.name} is not archived.`);
    if (menu.status !== 'ARCHIVED') throw notArchived();
    const actor = menuActor(user);
    await prisma.$transaction(async (tx) => {
      const locked = (await lockMenus(tx, [menuId])).get(menuId)!;
      if (locked.status !== 'ARCHIVED') throw notArchived();
      await tx.menu.update({ where: { id: menuId }, data: { status: 'ACTIVE' } });
      await audit(tx, {
        menuId,
        menuVersionId: null,
        action: 'menu.unarchived',
        summary: `Unarchived menu "${locked.name}"; it is back on the Menus home.`,
        before: { status: 'ARCHIVED' },
        after: { status: 'ACTIVE' },
        actor
      });
    });
    return this.get(menuId);
  },

  // ---------------------------------------------------------------- drafts
  async getDraft(menuId: string): Promise<MenuDraftPayload> {
    const menu = await loadMenu(menuId);
    const draft = requireDraft(await loadDraft(menuId));
    return draftPayload(menu, draft);
  },

  /** A new draft, cloned from the published version (or empty when there is none). */
  async createDraft(menuId: string, user: AuthUser | undefined): Promise<MenuDraftPayload> {
    const menu = requireActive(await loadMenu(menuId));
    const actor = menuActor(user);
    const published = await loadPublished(menuId);
    const source: MenuDocument = published ? stripIds(documentFor(published)) : emptyDocument(isMenuTemplateKey(menu.templateKey) ? templateFor(menu) : undefined);

    await prisma.$transaction(async (tx) => {
      // The Menu row lock serialises concurrent callers on this menu (and an
      // archive): the one-draft check after it cannot race.
      await lockActiveMenu(tx, menu);
      const versionNumber = await nextVersionNumber(menuId, tx);
      const existing = await tx.menuVersion.findFirst({ where: { menuId, state: 'DRAFT' }, select: { id: true } });
      if (existing) throw new HttpError(409, 'This menu already has a draft. Open it, or discard it to start again.');
      const version = await tx.menuVersion.create({
        data: {
          menuId,
          versionNumber,
          state: 'DRAFT',
          ...versionFields(source),
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name
        }
      });
      await writeDocumentRows(tx, version.id, ensureDishKeys(source));
      await audit(tx, {
        menuId,
        menuVersionId: version.id,
        action: 'draft.created',
        summary: published ? `Started draft v${version.versionNumber} from published v${published.versionNumber}.` : `Started draft v${version.versionNumber} from an empty menu.`,
        actor
      });
    });
    return draftPayload(menu, requireDraft(await loadDraft(menuId)));
  },

  async saveDraft(menuId: string, input: unknown, user: AuthUser | undefined): Promise<MenuDraftPayload> {
    const menu = requireActive(await loadMenu(menuId));
    const actor = menuActor(user);
    const data = menuDraftSaveInputSchema.parse(input);
    const draft = requireDraft(await loadDraft(menuId));
    checkUpdatedAt(draft, data.expectedUpdatedAt);

    // Carry dish keys for items the editor sent by id without a key, then mint
    // keys for genuinely new dishes.
    const keyById = new Map<string, string>();
    for (const section of draft.sections) for (const item of section.items) keyById.set(item.id, item.dishKey);
    const before = documentFromRows(draft);
    const { expectedUpdatedAt: _expected, ...incoming } = data;
    const next = ensureDishKeys(
      normaliseMenuDocument({
        ...incoming,
        sections: incoming.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => ({ ...item, dishKey: item.dishKey ?? (item.id ? keyById.get(item.id) : undefined) }))
        }))
      })
    );
    const diff = diffMenuDocuments(before, next);
    const keysMinted = next.sections.some((section, sectionIndex) => section.items.some((item, itemIndex) => item.dishKey !== before.sections[sectionIndex]?.items[itemIndex]?.dishKey));
    // Everything stored counts, not only what the publish diff reports: a
    // seafood flag or a recipe link does not print, but it must still save.
    const changed = keysMinted || !menuDocumentsEqual(before, next);
    // A save that changes nothing is not a write: bumping updatedAt would hand
    // every other editor of this draft a spurious stale-save conflict.
    if (!changed) return draftPayload(menu, draft);
    const summary = menuDiffIsEmpty(diff) ? 'dish settings changed (nothing printed differs)' : summariseMenuDiff(diff);

    await prisma.$transaction(async (tx) => {
      await lockActiveMenu(tx, menu);
      // The optimistic lock, enforced where it counts: the row is only written
      // if it still carries the updatedAt the editor saw (or the editor asked
      // to force). Two saves racing through checkUpdatedAt above cannot both
      // get past this.
      const guarded = await tx.menuVersion.updateMany({
        where: { id: draft.id, state: 'DRAFT', ...(data.expectedUpdatedAt ? { updatedAt: draft.updatedAt } : {}) },
        data: { ...versionFields(next), updatedById: actor.id, updatedByName: actor.name }
      });
      if (guarded.count !== 1) {
        throw new HttpError(409, 'Someone else saved this draft a moment ago. Reload to see their changes before saving yours.', { code: 'STALE_DRAFT' });
      }
      await writeDocumentRows(tx, draft.id, next);
      await audit(tx, {
        menuId,
        menuVersionId: draft.id,
        action: 'draft.saved',
        summary: `Saved draft v${draft.versionNumber}: ${summary}.`,
        after: diff,
        actor
      });
    });
    return draftPayload(menu, requireDraft(await loadDraft(menuId)));
  },

  async discardDraft(menuId: string, user: AuthUser | undefined): Promise<{ ok: true }> {
    const menu = requireActive(await loadMenu(menuId));
    const actor = menuActor(user);
    const draft = requireDraft(await loadDraft(menuId));
    await prisma.$transaction(async (tx) => {
      await lockActiveMenu(tx, menu);
      const deleted = await tx.menuVersion.deleteMany({ where: { id: draft.id, state: 'DRAFT' } });
      if (deleted.count !== 1) throw new HttpError(409, 'This draft was published or discarded a moment ago. Reload to see the menu as it is now.', { code: 'STALE_DRAFT' });
      await audit(tx, {
        menuId,
        menuVersionId: draft.id,
        action: 'draft.discarded',
        summary: `Discarded draft v${draft.versionNumber}.`,
        actor
      });
    });
    return { ok: true };
  },

  // ---------------------------------------------------------------- publishing
  /** Everything the publish dialog shows: validation, page fill, and the diff against the live menu. */
  async publishPreview(menuId: string): Promise<MenuPublishPreview> {
    const menu = requireActive(await loadMenu(menuId));
    const draft = requireDraft(await loadDraft(menuId));
    const doc = documentFromRows(draft);
    const published = await loadPublished(menuId);
    const validation = validateMenuDocument(doc, validationOptions(menu));
    const renderer = chromeStatus();
    let fill: MenuPublishPreview['fill'] = null;
    if (renderer.ok) {
      const assets = renderAssetsOrThrow();
      const template = templateFor(menu);
      fill = await measureMenuFill(renderMenuHtml(doc, menu.templateKey, { assets }), template.page);
      const overflow = overflowIssue(fill, pageLabel(template));
      if (overflow) validation.errors.push(overflow);
    }
    const diff = diffMenuDocuments(published ? documentFor(published) : null, doc);
    return {
      validation: { ...validation, ok: validation.errors.length === 0 },
      fill,
      renderer: { ok: renderer.ok, message: renderer.ok ? 'Ready' : renderer.message },
      diff,
      summary: summariseMenuDiff(diff),
      canPublish: renderer.ok && validation.errors.length === 0
    };
  },

  async publish(menuId: string, input: unknown, user: AuthUser | undefined): Promise<MenuVersionPayload> {
    const menu = requireActive(await loadMenu(menuId));
    const actor = menuActor(user);
    const data = menuPublishInputSchema.parse(input);
    const draft = requireDraft(await loadDraft(menuId));
    checkUpdatedAt(draft, data.expectedUpdatedAt);
    const doc = documentFromRows(draft);

    const validation: MenuValidationResult = validateMenuDocument(doc, validationOptions(menu));
    if (validation.errors.length > 0) {
      throw new HttpError(422, `The menu has ${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'} to fix before it can be published.`, {
        code: 'VALIDATION',
        validation
      });
    }
    if (validation.warnings.length > 0 && !data.acknowledgeWarnings) {
      throw new HttpError(409, `The menu has ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'}. Review them, then publish again to confirm.`, {
        code: 'WARNINGS',
        validation
      });
    }

    const template = templateFor(menu);
    const assets = renderAssetsOrThrow();
    const html = renderMenuHtml(doc, menu.templateKey, { assets, title: `${menu.venue.name} ${menu.name.toLowerCase()} menu | Alma Group` });
    const rendered = await renderMenuPdf(html, template.page);
    const overflow = overflowIssue(rendered.fill, pageLabel(template));
    if (overflow || rendered.pageCount !== doc.pageCount) {
      const issue = overflow ?? {
        level: 'error' as const,
        code: 'OVERFLOW' as const,
        message:
          doc.pageCount === 1
            ? `The menu rendered to ${rendered.pageCount} pages. It must fit on ${pageLabel(template)}.`
            : `The menu rendered to ${rendered.pageCount} pages but declares ${doc.pageCount}. Check each page in the preview before publishing.`
      };
      throw new HttpError(422, issue.message, { code: 'VALIDATION', validation: { errors: [issue], warnings: validation.warnings, ok: false }, fill: rendered.fill });
    }

    const published = await loadPublished(menuId);
    const diff = diffMenuDocuments(published ? documentFor(published) : null, doc);
    const publishedAt = new Date();
    const snapshot = buildSnapshot(menu, draft, doc, publishedAt);

    // The PDF is rendered above, outside any transaction, so a slow render
    // never holds the lock. Archive could have landed meanwhile: the status is
    // checked again under the lock, and nothing below is written if it did.
    await prisma.$transaction(async (tx) => {
      await lockActiveMenu(tx, menu);
      const liveNow = await tx.menuVersion.findFirst({ where: { menuId, state: 'PUBLISHED' }, select: { id: true } });
      if ((liveNow?.id ?? null) !== (published?.id ?? null)) {
        throw new HttpError(409, 'The live version changed while this one was being published. Reload, check the preview, and publish again.', { code: 'STALE_DRAFT' });
      }
      if (published) {
        await tx.menuVersion.update({ where: { id: published.id }, data: { state: 'ARCHIVED' } });
      }
      const flipped = await tx.menuVersion.updateMany({
        where: { id: draft.id, state: 'DRAFT', updatedAt: draft.updatedAt },
        data: {
          state: 'PUBLISHED',
          snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
          pdfData: new Uint8Array(rendered.pdf),
          pdfByteSize: rendered.pdf.length,
          pdfGeneratedAt: publishedAt,
          publishedAt,
          publishedById: actor.id,
          publishedByName: actor.name
        }
      });
      if (flipped.count !== 1) {
        throw new HttpError(409, 'The draft changed while it was being published. Reload, check the preview, and publish again.', { code: 'STALE_DRAFT' });
      }
      await audit(tx, {
        menuId,
        menuVersionId: draft.id,
        action: 'published',
        summary: `Published v${draft.versionNumber}${published ? ` (replacing v${published.versionNumber})` : ''}: ${summariseMenuDiff(diff)}.${
          validation.warnings.length ? ` ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'} acknowledged.` : ''
        }`,
        before: published ? { versionNumber: published.versionNumber } : null,
        after: { versionNumber: draft.versionNumber, diff, fillRatio: rendered.fill.fillRatio, pageCount: rendered.pageCount, renderMs: rendered.renderMs, warnings: validation.warnings },
        actor
      });
    });

    return this.getVersion(draft.id);
  },

  // ---------------------------------------------------------------- history
  async listVersions(menuId: string): Promise<MenuVersionSummary[]> {
    await loadMenu(menuId);
    const versions = await prisma.menuVersion.findMany({ where: { menuId }, select: VERSION_SUMMARY_SELECT, orderBy: { versionNumber: 'desc' } });
    return versions.map(versionSummary);
  },

  async getVersion(versionId: string): Promise<MenuVersionPayload> {
    const version = await prisma.menuVersion.findUnique({ where: { id: versionId }, include: { sections: { include: { items: true } }, menu: { select: MENU_SELECT } } });
    if (!version) throw new HttpError(404, 'That menu version does not exist.');
    const doc = documentFor(version);
    const stored = version.snapshotJson as unknown as MenuSnapshot | null;
    // Versions published before V2 lack the card fields and pages; they read as their defaults.
    const snapshot: MenuSnapshot = stored
      ? { ...stored, ...normaliseMenuDocument(stored), schemaVersion: stored.schemaVersion ?? 1 }
      : buildSnapshot(version.menu, version, doc, version.publishedAt);
    return { menu: menuHeader(version.menu), version: versionSummary(version), snapshot };
  },

  async getVersionPdf(versionId: string): Promise<{ filename: string; bytes: Buffer; generatedAt: Date | null }> {
    const version = await prisma.menuVersion.findUnique({
      where: { id: versionId },
      select: { pdfData: true, pdfGeneratedAt: true, versionNumber: true, state: true, menu: { select: MENU_SELECT } }
    });
    if (!version) throw new HttpError(404, 'That menu version does not exist.');
    if (!version.pdfData) throw new HttpError(404, version.state === 'DRAFT' ? 'A draft has no PDF yet. Publish it to generate one.' : 'No PDF is stored for this version.');
    return { filename: `${version.menu.venue.slug}-${version.menu.slug}-v${version.versionNumber}.pdf`, bytes: Buffer.from(version.pdfData), generatedAt: version.pdfGeneratedAt };
  },

  /** A version's content against the draft, the published version, or another version. */
  async diffVersion(versionId: string, against: string): Promise<{ from: MenuVersionSummary; to: MenuVersionSummary | null; diff: MenuDiff; summary: string }> {
    const version = await prisma.menuVersion.findUnique({ where: { id: versionId }, include: { sections: { include: { items: true } } } });
    if (!version) throw new HttpError(404, 'That menu version does not exist.');
    let target: VersionRow | null;
    if (against === 'draft') target = await loadDraft(version.menuId);
    else if (against === 'published') target = await loadPublished(version.menuId);
    else target = await prisma.menuVersion.findFirst({ where: { id: against, menuId: version.menuId }, include: { sections: { include: { items: true } } } });
    if (!target) throw new HttpError(404, against === 'draft' ? 'There is no draft to compare against.' : 'Nothing to compare against.');
    const diff = diffMenuDocuments(documentFor(version), documentFor(target));
    return { from: versionSummary(version), to: versionSummary(target), diff, summary: summariseMenuDiff(diff) };
  },

  /** A new draft from a past version. The past version is untouched. */
  async restore(versionId: string, input: unknown, user: AuthUser | undefined): Promise<MenuDraftPayload> {
    const actor = menuActor(user);
    const data = menuRestoreInputSchema.parse(input);
    const source = await prisma.menuVersion.findUnique({ where: { id: versionId }, include: { sections: { include: { items: true } }, menu: { select: MENU_SELECT } } });
    if (!source) throw new HttpError(404, 'That menu version does not exist.');
    requireActive(source.menu);
    if (source.state === 'DRAFT') throw new HttpError(400, 'That version is the current draft.');
    const existing = await loadDraft(source.menuId);
    if (existing && !data.replaceDraft) {
      throw new HttpError(409, `This menu has an unpublished draft (v${existing.versionNumber}). Restoring replaces it — confirm to continue.`, {
        code: 'DRAFT_EXISTS',
        draft: versionSummary(existing)
      });
    }
    const doc = ensureDishKeys(stripIds(documentFor(source)));
    await prisma.$transaction(async (tx) => {
      await lockActiveMenu(tx, source.menu);
      const versionNumber = await nextVersionNumber(source.menuId, tx);
      const current = await tx.menuVersion.findFirst({ where: { menuId: source.menuId, state: 'DRAFT' }, select: { id: true, versionNumber: true } });
      if (current && !data.replaceDraft) {
        throw new HttpError(409, `This menu has an unpublished draft (v${current.versionNumber}). Restoring replaces it — confirm to continue.`, { code: 'DRAFT_EXISTS' });
      }
      if (current) {
        await tx.menuVersion.delete({ where: { id: current.id } });
        await audit(tx, { menuId: source.menuId, menuVersionId: current.id, action: 'draft.discarded', summary: `Discarded draft v${current.versionNumber} to restore v${source.versionNumber}.`, actor });
      }
      const version = await tx.menuVersion.create({
        data: {
          menuId: source.menuId,
          versionNumber,
          state: 'DRAFT',
          ...versionFields(doc),
          restoredFromVersionId: source.id,
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name
        }
      });
      await writeDocumentRows(tx, version.id, doc);
      await audit(tx, {
        menuId: source.menuId,
        menuVersionId: version.id,
        action: 'restored',
        summary: `Restored v${source.versionNumber} as new draft v${version.versionNumber}.`,
        before: { versionNumber: source.versionNumber },
        after: { versionNumber: version.versionNumber },
        actor
      });
    });
    return draftPayload(source.menu, requireDraft(await loadDraft(source.menuId)));
  },

  // ---------------------------------------------------------------- cross-venue copy
  /** Copy one dish from this menu's draft into another menu's draft (created from its published version when needed). */
  async copyItemTo(menuId: string, input: unknown, user: AuthUser | undefined): Promise<{ target: MenuDraftPayload; dishKey: string }> {
    const sourceMenu = requireActive(await loadMenu(menuId));
    const actor = menuActor(user);
    const data = menuCopyItemInputSchema.parse(input);
    if (data.targetMenuId === menuId) throw new HttpError(400, 'Use Duplicate to copy a dish within the same menu.');
    const targetMenu = requireActive(await loadMenu(data.targetMenuId));
    const sourceDraft = requireDraft(await loadDraft(menuId));
    const sourceItem = sourceDraft.sections.flatMap((section) => section.items.map((item) => ({ item, section }))).find(({ item }) => item.dishKey === data.dishKey);
    if (!sourceItem) throw new HttpError(404, 'That dish is not in this draft.');

    let targetDraft = await loadDraft(targetMenu.id);
    if (!targetDraft) {
      await this.createDraft(targetMenu.id, user);
      targetDraft = requireDraft(await loadDraft(targetMenu.id));
    }
    const targetSection =
      (data.targetSectionId ? targetDraft.sections.find((section) => section.id === data.targetSectionId) : undefined) ??
      targetDraft.sections.find((section) => section.title.trim().toLowerCase() === sourceItem.section.title.trim().toLowerCase()) ??
      [...targetDraft.sections].sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (!targetSection) throw new HttpError(409, `${targetMenu.venue.name} · ${targetMenu.name}'s draft has no sections yet. Add one there first.`);

    const dishKey = newDishKey(sourceItem.item.name);
    await prisma.$transaction(async (tx) => {
      // Both menus, in id order; each refused separately so the editor can
      // tell "this menu was archived" from "the menu you copied into was".
      const locked = await lockMenus(tx, [sourceMenu.id, targetMenu.id]);
      if (locked.get(sourceMenu.id)!.status === 'ARCHIVED') throw archivedError(sourceMenu);
      if (locked.get(targetMenu.id)!.status === 'ARCHIVED') throw archivedError(targetMenu);
      const stillThere = await tx.menuSection.findFirst({ where: { id: targetSection.id, version: { id: targetDraft!.id, state: 'DRAFT' } }, select: { id: true } });
      if (!stillThere) throw new HttpError(409, `${targetMenu.venue.name} · ${targetMenu.name}'s draft changed a moment ago. Try the copy again.`, { code: 'STALE_DRAFT' });
      const last = await tx.menuItem.aggregate({ where: { sectionId: targetSection.id }, _max: { sortOrder: true } });
      await tx.menuItem.create({
        data: {
          sectionId: targetSection.id,
          dishKey,
          name: sourceItem.item.name,
          description: sourceItem.item.description,
          priceCents: sourceItem.item.priceCents,
          priceUnit: sourceItem.item.priceUnit,
          prices: sourceItem.item.prices as Prisma.InputJsonValue,
          meta: sourceItem.item.meta,
          note: sourceItem.item.note,
          flags: sourceItem.item.flags,
          tags: sourceItem.item.tags,
          isSeafood: sourceItem.item.isSeafood,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          visible: sourceItem.item.visible,
          recipeId: null
        }
      });
      await tx.menuVersion.update({ where: { id: targetDraft!.id }, data: { updatedById: actor.id, updatedByName: actor.name } });
      await audit(tx, {
        menuId: targetMenu.id,
        menuVersionId: targetDraft!.id,
        action: 'item.copied',
        summary: `Copied "${sourceItem.item.name}" into ${targetSection.title} from another menu's draft.`,
        after: { dishKey, fromMenuId: menuId, fromDishKey: data.dishKey },
        actor
      });
    });
    return { target: await this.getDraft(targetMenu.id), dishKey };
  },

  // ---------------------------------------------------------------- audit
  async listAudit(menuId: string, limit = 100): Promise<MenuAuditEntry[]> {
    await loadMenu(menuId);
    const rows = await prisma.menuAuditEvent.findMany({ where: { menuId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 500) });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      summary: row.summary,
      actor: { id: row.actorId, name: row.actorName, email: row.actorEmail },
      menuVersionId: row.menuVersionId,
      createdAt: row.createdAt.toISOString(),
      before: row.before,
      after: row.after
    }));
  },

  // ---------------------------------------------------------------- public (website)
  /** The published, public menus of a venue — what the website lists and links. */
  async publicMenus(venueSlug: string): Promise<{ venue: { name: string; slug: string }; menus: PublicMenuSummary[] }> {
    const venue = await prisma.venue.findUnique({ where: { slug: venueSlug }, select: { name: true, slug: true } });
    if (!venue) throw new HttpError(404, 'No such venue.');
    const menus = await prisma.menu.findMany({
      where: { venue: { slug: venueSlug }, status: 'ACTIVE', visibility: 'PUBLIC', versions: { some: { state: 'PUBLISHED' } } },
      select: { ...MENU_SELECT, versions: { where: { state: 'PUBLISHED' }, select: { ...VERSION_SUMMARY_SELECT, heading: true }, orderBy: { versionNumber: 'desc' }, take: 1 } },
      orderBy: [{ createdAt: 'asc' }]
    });
    const out: PublicMenuSummary[] = [];
    for (const menu of menus) {
      const version = menu.versions[0];
      if (!version || !isMenuTemplateKey(menu.templateKey)) continue;
      out.push(publicSummary(menu, version));
    }
    out.sort((a, b) => (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99));
    return { venue, menus: out };
  },

  /** One published menu's snapshot, for in-page rendering on the website. */
  async publicMenu(venueSlug: string, slug: string): Promise<PublicMenuDocument> {
    const { menu, version } = await loadPublicMenu(venueSlug, slug);
    return { ...publicSummary(menu, version), venue: { name: menu.venue.name, slug: menu.venue.slug }, document: documentFor(version) };
  },

  /** The live PDF of a published menu. */
  async publicMenuPdf(venueSlug: string, slug: string): Promise<{ filename: string; bytes: Buffer; versionId: string; generatedAt: Date | null }> {
    const { menu, version } = await loadPublicMenu(venueSlug, slug);
    if (!version.pdfData) throw new HttpError(404, 'No PDF is stored for this menu.');
    return { filename: `${menu.venue.slug}-${menu.slug}.pdf`, bytes: Buffer.from(version.pdfData), versionId: version.id, generatedAt: version.pdfGeneratedAt };
  },

  /** Renderer and asset readiness, for the module home's status line. */
  rendererStatus(): { ok: boolean; message: string } {
    const chrome = chromeStatus();
    if (!chrome.ok) return chrome;
    try {
      loadMenuRenderAssets();
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, message: 'PDF renderer ready' };
  }
};

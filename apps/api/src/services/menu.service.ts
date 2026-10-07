import { prisma } from '@alma/db';
import type { Prisma } from '@prisma/client';
import {
  diffMenuDocuments,
  ensureDishKeys,
  getMenuTemplate,
  menuCopyItemInputSchema,
  menuDiffIsEmpty,
  menuDraftSaveInputSchema,
  menuPublishInputSchema,
  menuRestoreInputSchema,
  newDishKey,
  overflowIssue,
  renderMenuHtml,
  summariseMenuDiff,
  validateMenuDocument,
  type AuthUser,
  type MenuActor,
  type MenuAuditEntry,
  type MenuDiff,
  type MenuDocument,
  type MenuDraftPayload,
  type MenuPublishPreview,
  type MenuSnapshot,
  type MenuSummary,
  type MenuValidationResult,
  type MenuVersionPayload,
  type MenuVersionSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { loadMenuRenderAssets, MenuAssetError } from '../lib/menu-assets.js';
import { chromeStatus, renderMenuPdf, measureMenuFill } from '../lib/menu-pdf.js';

/**
 * Menu Editor — drafts, publishing, history and the audit trail.
 *
 * Invariants this service keeps:
 *   - one DRAFT per menu at most; one PUBLISHED at most; the rest ARCHIVED.
 *   - a published or archived version is never changed again. Its snapshot
 *     and PDF are written once, at publish, and only read after that.
 *   - restoring creates a new draft from a snapshot; it never rewrites history.
 *   - every change writes a MenuAuditEvent with who, what and a diff summary.
 *   - a dish keeps its dishKey through saves, clones and restores.
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
  pdfGeneratedAt: true
} as const;

const MENU_SELECT = {
  id: true,
  name: true,
  templateKey: true,
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
    pdfByteSize: version.pdfByteSize
  };
}

function menuHeader(menu: MenuRow): Pick<MenuSummary, 'id' | 'name' | 'templateKey' | 'venue'> {
  return { id: menu.id, name: menu.name, templateKey: menu.templateKey, venue: menu.venue };
}

/** The editable document from live draft rows (ids and dish keys included). */
function documentFromRows(version: VersionRow): MenuDocument {
  return {
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
            tags: item.tags.filter((tag): tag is MenuDocument['sections'][number]['items'][number]['tags'][number] => true),
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
    dietaryNote: doc.dietaryNote,
    surchargeLine: doc.surchargeLine,
    sections: doc.sections.map(({ id: _sectionId, ...section }) => ({
      ...section,
      items: section.items.map(({ id: _itemId, ...item }) => item)
    }))
  };
}

function snapshotDocument(version: { snapshotJson: Prisma.JsonValue | null }): MenuDocument | null {
  const snapshot = version.snapshotJson as unknown as MenuSnapshot | null;
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.sections)) return null;
  return { dietaryNote: snapshot.dietaryNote ?? '', surchargeLine: snapshot.surchargeLine ?? '', sections: snapshot.sections };
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
  return menu.versionCounter;
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
        sortOrder: sectionIndex,
        visible: section.visible,
        items: {
          create: section.items.map((item, itemIndex) => ({
            dishKey: item.dishKey ?? newDishKey(item.name),
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            priceUnit: item.priceUnit,
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
    schemaVersion: 1,
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

export const menuService = {
  // ---------------------------------------------------------------- home
  async list(): Promise<MenuSummary[]> {
    const menus = await prisma.menu.findMany({
      where: { status: 'ACTIVE' },
      select: {
        ...MENU_SELECT,
        versions: { where: { state: { in: ['DRAFT', 'PUBLISHED'] } }, select: VERSION_SUMMARY_SELECT, orderBy: { versionNumber: 'desc' } }
      },
      orderBy: [{ venue: { name: 'asc' } }, { name: 'asc' }]
    });
    return menus.map((menu) => {
      const published = menu.versions.find((version) => version.state === 'PUBLISHED') ?? null;
      const draft = menu.versions.find((version) => version.state === 'DRAFT') ?? null;
      const candidates: Array<{ at: Date; by: MenuActor }> = [];
      if (draft) candidates.push({ at: draft.updatedAt, by: asMenuActor(draft.updatedById, draft.updatedByName) });
      if (published?.publishedAt) candidates.push({ at: published.publishedAt, by: asMenuActor(published.publishedById, published.publishedByName) });
      candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
      const last = candidates[0];
      return {
        ...menuHeader(menu),
        published: published ? versionSummary(published) : null,
        draft: draft ? versionSummary(draft) : null,
        lastEdited: last ? { at: last.at.toISOString(), by: last.by } : null
      };
    });
  },

  async get(menuId: string): Promise<MenuSummary> {
    const all = await this.list();
    const found = all.find((menu) => menu.id === menuId);
    if (!found) throw new HttpError(404, 'That menu does not exist.');
    return found;
  },

  // ---------------------------------------------------------------- drafts
  async getDraft(menuId: string): Promise<MenuDraftPayload> {
    const menu = await loadMenu(menuId);
    const draft = requireDraft(await loadDraft(menuId));
    return draftPayload(menu, draft);
  },

  /** A new draft, cloned from the published version (or empty when there is none). */
  async createDraft(menuId: string, user: AuthUser | undefined): Promise<MenuDraftPayload> {
    const menu = await loadMenu(menuId);
    const actor = menuActor(user);
    const existing = await loadDraft(menuId);
    if (existing) throw new HttpError(409, 'This menu already has a draft. Open it, or discard it to start again.');
    const published = await loadPublished(menuId);
    const source: MenuDocument = published ? stripIds(documentFor(published)) : { dietaryNote: '', surchargeLine: '', sections: [] };

    const created = await prisma.$transaction(async (tx) => {
      const version = await tx.menuVersion.create({
        data: {
          menuId,
          versionNumber: await nextVersionNumber(menuId, tx),
          state: 'DRAFT',
          dietaryNote: source.dietaryNote,
          surchargeLine: source.surchargeLine,
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
      return version;
    });
    const draft = requireDraft(await loadDraft(menuId));
    void created;
    return draftPayload(menu, draft);
  },

  async saveDraft(menuId: string, input: unknown, user: AuthUser | undefined): Promise<MenuDraftPayload> {
    const menu = await loadMenu(menuId);
    const actor = menuActor(user);
    const data = menuDraftSaveInputSchema.parse(input);
    const draft = requireDraft(await loadDraft(menuId));
    checkUpdatedAt(draft, data.expectedUpdatedAt);

    // Carry dish keys for items the editor sent by id without a key, then mint
    // keys for genuinely new dishes.
    const keyById = new Map<string, string>();
    for (const section of draft.sections) for (const item of section.items) keyById.set(item.id, item.dishKey);
    const before = documentFromRows(draft);
    const next = ensureDishKeys({
      dietaryNote: data.dietaryNote,
      surchargeLine: data.surchargeLine,
      sections: data.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, dishKey: item.dishKey ?? (item.id ? keyById.get(item.id) : undefined) }))
      }))
    });
    const diff = diffMenuDocuments(before, next);
    const changed = !menuDiffIsEmpty(diff);

    await prisma.$transaction(async (tx) => {
      await tx.menuVersion.update({
        where: { id: draft.id },
        data: { dietaryNote: next.dietaryNote, surchargeLine: next.surchargeLine, updatedById: actor.id, updatedByName: actor.name }
      });
      await writeDocumentRows(tx, draft.id, next);
      if (changed) {
        await audit(tx, {
          menuId,
          menuVersionId: draft.id,
          action: 'draft.saved',
          summary: `Saved draft v${draft.versionNumber}: ${summariseMenuDiff(diff)}.`,
          after: diff,
          actor
        });
      }
    });
    return draftPayload(menu, requireDraft(await loadDraft(menuId)));
  },

  async discardDraft(menuId: string, user: AuthUser | undefined): Promise<{ ok: true }> {
    await loadMenu(menuId);
    const actor = menuActor(user);
    const draft = requireDraft(await loadDraft(menuId));
    await prisma.$transaction(async (tx) => {
      await tx.menuVersion.delete({ where: { id: draft.id } });
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
    const menu = await loadMenu(menuId);
    const draft = requireDraft(await loadDraft(menuId));
    const doc = documentFromRows(draft);
    const published = await loadPublished(menuId);
    const validation = validateMenuDocument(doc);
    const renderer = chromeStatus();
    let fill: MenuPublishPreview['fill'] = null;
    if (renderer.ok) {
      const assets = renderAssetsOrThrow();
      fill = await measureMenuFill(renderMenuHtml(doc, menu.templateKey, { assets }));
      const overflow = overflowIssue(fill);
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
    const menu = await loadMenu(menuId);
    const actor = menuActor(user);
    const data = menuPublishInputSchema.parse(input);
    const draft = requireDraft(await loadDraft(menuId));
    checkUpdatedAt(draft, data.expectedUpdatedAt);
    const doc = documentFromRows(draft);

    const validation: MenuValidationResult = validateMenuDocument(doc);
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

    const template = getMenuTemplate(menu.templateKey);
    const assets = renderAssetsOrThrow();
    const html = renderMenuHtml(doc, menu.templateKey, { assets, title: `${menu.venue.name} ${menu.name.toLowerCase()} menu | Alma Group` });
    const rendered = await renderMenuPdf(html, template.page);
    const overflow = overflowIssue(rendered.fill);
    if (overflow || rendered.pageCount !== 1) {
      const issue = overflow ?? {
        level: 'error' as const,
        code: 'OVERFLOW' as const,
        message: `The menu rendered to ${rendered.pageCount} pages. It must fit on one A4 page.`
      };
      throw new HttpError(422, issue.message, { code: 'VALIDATION', validation: { errors: [issue], warnings: validation.warnings, ok: false }, fill: rendered.fill });
    }

    const published = await loadPublished(menuId);
    const diff = diffMenuDocuments(published ? documentFor(published) : null, doc);
    const publishedAt = new Date();
    const snapshot = buildSnapshot(menu, draft, doc, publishedAt);

    await prisma.$transaction(async (tx) => {
      if (published) {
        await tx.menuVersion.update({ where: { id: published.id }, data: { state: 'ARCHIVED' } });
      }
      await tx.menuVersion.update({
        where: { id: draft.id },
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
      await audit(tx, {
        menuId,
        menuVersionId: draft.id,
        action: 'published',
        summary: `Published v${draft.versionNumber}${published ? ` (replacing v${published.versionNumber})` : ''}: ${summariseMenuDiff(diff)}.${
          validation.warnings.length ? ` ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'} acknowledged.` : ''
        }`,
        before: published ? { versionNumber: published.versionNumber } : null,
        after: { versionNumber: draft.versionNumber, diff, fillRatio: rendered.fill.fillRatio, renderMs: rendered.renderMs, warnings: validation.warnings },
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
    const snapshot = (version.snapshotJson as unknown as MenuSnapshot | null) ?? buildSnapshot(version.menu, version, doc, version.publishedAt);
    return { menu: menuHeader(version.menu), version: versionSummary(version), snapshot };
  },

  async getVersionPdf(versionId: string): Promise<{ filename: string; bytes: Buffer; generatedAt: Date | null }> {
    const version = await prisma.menuVersion.findUnique({
      where: { id: versionId },
      select: { pdfData: true, pdfGeneratedAt: true, versionNumber: true, state: true, menu: { select: MENU_SELECT } }
    });
    if (!version) throw new HttpError(404, 'That menu version does not exist.');
    if (!version.pdfData) throw new HttpError(404, version.state === 'DRAFT' ? 'A draft has no PDF yet. Publish it to generate one.' : 'No PDF is stored for this version.');
    const slug = `${version.menu.venue.slug}-${version.menu.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { filename: `${slug}-v${version.versionNumber}.pdf`, bytes: Buffer.from(version.pdfData), generatedAt: version.pdfGeneratedAt };
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
      if (existing) {
        await tx.menuVersion.delete({ where: { id: existing.id } });
        await audit(tx, { menuId: source.menuId, menuVersionId: existing.id, action: 'draft.discarded', summary: `Discarded draft v${existing.versionNumber} to restore v${source.versionNumber}.`, actor });
      }
      const version = await tx.menuVersion.create({
        data: {
          menuId: source.menuId,
          versionNumber: await nextVersionNumber(source.menuId, tx),
          state: 'DRAFT',
          dietaryNote: doc.dietaryNote,
          surchargeLine: doc.surchargeLine,
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
    await loadMenu(menuId);
    const actor = menuActor(user);
    const data = menuCopyItemInputSchema.parse(input);
    if (data.targetMenuId === menuId) throw new HttpError(400, 'Use Duplicate to copy a dish within the same menu.');
    const targetMenu = await loadMenu(data.targetMenuId);
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
    if (!targetSection) throw new HttpError(409, `${targetMenu.venue.name}'s draft has no sections yet. Add one there first.`);

    const dishKey = newDishKey(sourceItem.item.name);
    await prisma.$transaction(async (tx) => {
      const last = await tx.menuItem.aggregate({ where: { sectionId: targetSection.id }, _max: { sortOrder: true } });
      await tx.menuItem.create({
        data: {
          sectionId: targetSection.id,
          dishKey,
          name: sourceItem.item.name,
          description: sourceItem.item.description,
          priceCents: sourceItem.item.priceCents,
          priceUnit: sourceItem.item.priceUnit,
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
        summary: `Copied "${sourceItem.item.name}" into ${targetSection.title} from another venue's draft.`,
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

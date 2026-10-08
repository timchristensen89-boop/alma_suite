/**
 * Import the reference menus and the website's What's On events as
 * reviewable drafts — repeatably, and never publishing anything.
 *
 *   pnpm --filter @alma/api menus:import              # every spec, drafts only
 *   pnpm --filter @alma/api menus:import -- --only st-alma/drinks,alma-avalon/happy-hour
 *   pnpm --filter @alma/api menus:import -- --dry-run  # say what would happen, write nothing
 *   pnpm --filter @alma/api menus:import -- --photos /path/to/alma-web-platform/apps/web/public
 *
 * Rules, in order of precedence:
 *   - a menu is found by (venue slug, menu slug). It is never created twice,
 *     never renamed, never published, never archived.
 *   - a menu nobody has touched since the importer last wrote it (its draft's
 *     last writer is the importer) is brought up to date when the spec's
 *     content changed; a draft someone has edited is left exactly as it is
 *     and reported.
 *   - a menu with a published version and no draft gets a new draft only when
 *     the spec differs from what is published; the published version is
 *     untouched.
 *   - every write is audited as "menu.imported" with the source path, ref,
 *     hash, confidence and the review notes, so the Menus home can show where
 *     a draft came from and what to check.
 *   - promotions follow the same rule by (venue slug, promotion slug); they
 *     are created DRAFT (never published) and linked to their card when the
 *     card exists. A photo is attached when --photos names a folder that
 *     holds it; a promotion that already has a photo keeps it.
 *
 * Needs DATABASE_URL. Prints one line per spec: created / updated / unchanged /
 * skipped (edited by someone) / missing venue.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { prisma } from '@alma/db';
import { menuDocumentsEqual, normaliseMenuDocument, type AuthUser, type MenuDocument } from '@alma/shared';
import { MENU_IMPORTS, PROMOTION_IMPORTS, type MenuImportSpec, type PromotionImportSpec } from '../src/data/import/index.js';
import { menuService } from '../src/services/menu.service.js';
import { promotionService } from '../src/services/promotion.service.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const onlyArg = args[args.indexOf('--only') + 1];
const ONLY = args.includes('--only') && onlyArg ? new Set(onlyArg.split(',').map((key) => key.trim())) : null;
const photosArg = args[args.indexOf('--photos') + 1];
const PHOTOS = args.includes('--photos') && photosArg ? resolve(photosArg) : null;

/** The importer as an actor: what the audit log and "last edited by" show. */
export const IMPORT_ACTOR = {
  id: 'menu-import',
  firstName: 'Menu',
  lastName: 'import',
  email: 'menu-import@almagroup.com.au',
  role: 'ADMIN',
  isAdmin: true,
  accountType: 'SYSTEM',
  appAccess: []
} as unknown as AuthUser;

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped' | 'missing-venue' | 'dry-run';

function contentHash(document: MenuDocument): string {
  return createHash('sha256').update(JSON.stringify(normaliseMenuDocument(document))).digest('hex').slice(0, 16);
}

function wanted(venueSlug: string, slug: string): boolean {
  return !ONLY || ONLY.has(`${venueSlug}/${slug}`);
}

function line(kind: string, key: string, outcome: Outcome, detail = '') {
  console.log(`${kind.padEnd(9)} ${key.padEnd(34)} ${outcome.padEnd(14)} ${detail}`);
}

async function importMenu(spec: MenuImportSpec): Promise<Outcome> {
  const key = `${spec.venueSlug}/${spec.slug}`;
  const venue = await prisma.venue.findUnique({ where: { slug: spec.venueSlug }, select: { id: true, name: true } });
  if (!venue) {
    line('menu', key, 'missing-venue', `no venue with slug ${spec.venueSlug}`);
    return 'missing-venue';
  }
  const document = normaliseMenuDocument(spec.document);
  const hash = contentHash(document);
  const auditDetail = { source: spec.source, confidence: spec.confidence, review: spec.review, contentHash: hash };

  const existing = await prisma.menu.findUnique({ where: { venueId_slug: { venueId: venue.id, slug: spec.slug } }, select: { id: true, name: true, status: true } });
  if (!existing) {
    if (DRY_RUN) {
      line('menu', key, 'dry-run', `would create "${spec.name}" (${spec.kind}, ${spec.templateKey}, ${document.pageCount} page(s), ${document.sections.length} sections)`);
      return 'dry-run';
    }
    const created = await menuService.createMenu(
      { venueId: venue.id, name: spec.name, slug: spec.slug, kind: spec.kind, templateKey: spec.templateKey, heading: document.heading, visibility: spec.visibility ?? 'PUBLIC' },
      IMPORT_ACTOR
    );
    const draft = await menuService.getDraft(created.id);
    await menuService.saveDraft(created.id, { ...document, expectedUpdatedAt: draft.version.updatedAt }, IMPORT_ACTOR);
    await prisma.menuAuditEvent.create({
      data: { menuId: created.id, action: 'menu.imported', summary: `Imported from ${spec.source.path} (${spec.confidence} confidence) as draft v${draft.version.versionNumber}.`, after: auditDetail, actorId: IMPORT_ACTOR.id, actorName: 'Menu import' }
    });
    line('menu', key, 'created', `"${spec.name}" draft v${draft.version.versionNumber}, ${document.sections.length} sections`);
    return 'created';
  }

  if (existing.status !== 'ACTIVE') {
    line('menu', key, 'skipped', `"${existing.name}" is archived`);
    return 'skipped';
  }
  const summary = await menuService.get(existing.id);
  if (summary.draft) {
    const draft = await menuService.getDraft(existing.id);
    if (menuDocumentsEqual(draft.document, document)) {
      line('menu', key, 'unchanged', `draft v${draft.version.versionNumber} already matches`);
      return 'unchanged';
    }
    if (draft.version.updatedBy?.id !== IMPORT_ACTOR.id) {
      line('menu', key, 'skipped', `draft v${draft.version.versionNumber} was edited by ${draft.version.updatedBy?.name ?? 'someone'} — not overwritten`);
      return 'skipped';
    }
    if (DRY_RUN) {
      line('menu', key, 'dry-run', `would update draft v${draft.version.versionNumber}`);
      return 'dry-run';
    }
    await menuService.saveDraft(existing.id, { ...document, expectedUpdatedAt: draft.version.updatedAt }, IMPORT_ACTOR);
    await prisma.menuAuditEvent.create({
      data: { menuId: existing.id, action: 'menu.imported', summary: `Re-imported from ${spec.source.path} (${spec.confidence} confidence) into draft v${draft.version.versionNumber}.`, after: auditDetail, actorId: IMPORT_ACTOR.id, actorName: 'Menu import' }
    });
    line('menu', key, 'updated', `draft v${draft.version.versionNumber}`);
    return 'updated';
  }

  // No draft: compare with what is published; a new draft only when the spec differs.
  const published = summary.published ? await menuService.getVersion(summary.published.id) : null;
  if (published && menuDocumentsEqual(normaliseMenuDocument(published.snapshot), document)) {
    line('menu', key, 'unchanged', `published v${published.version.versionNumber} already matches`);
    return 'unchanged';
  }
  if (DRY_RUN) {
    line('menu', key, 'dry-run', published ? `would start a draft from published v${published.version.versionNumber}` : 'would start a draft');
    return 'dry-run';
  }
  const draft = await menuService.createDraft(existing.id, IMPORT_ACTOR);
  await menuService.saveDraft(existing.id, { ...document, expectedUpdatedAt: draft.version.updatedAt }, IMPORT_ACTOR);
  await prisma.menuAuditEvent.create({
    data: { menuId: existing.id, action: 'menu.imported', summary: `Imported from ${spec.source.path} (${spec.confidence} confidence) as draft v${draft.version.versionNumber}${published ? ` beside published v${published.version.versionNumber}` : ''}.`, after: auditDetail, actorId: IMPORT_ACTOR.id, actorName: 'Menu import' }
  });
  line('menu', key, 'created', `draft v${draft.version.versionNumber}${published ? ` (published v${published.version.versionNumber} untouched)` : ''}`);
  return 'created';
}

function photoDataUrl(relativePath: string): { dataUrl: string; fileName: string } | null {
  if (!PHOTOS) return null;
  const file = join(PHOTOS, relativePath);
  if (!existsSync(file)) return null;
  const ext = extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
  if (!mime) return null;
  return { dataUrl: `data:${mime};base64,${readFileSync(file).toString('base64')}`, fileName: relativePath.split('/').pop() ?? 'photo' };
}

async function importPromotion(spec: PromotionImportSpec): Promise<Outcome> {
  const key = `${spec.venueSlug}/${spec.slug}`;
  const venue = await prisma.venue.findUnique({ where: { slug: spec.venueSlug }, select: { id: true, name: true } });
  if (!venue) {
    line('promotion', key, 'missing-venue', `no venue with slug ${spec.venueSlug}`);
    return 'missing-venue';
  }
  const card = spec.cardSlug ? await prisma.menu.findUnique({ where: { venueId_slug: { venueId: venue.id, slug: spec.cardSlug } }, select: { id: true, name: true, kind: true, status: true } }) : null;
  // The card's own figures are what the promotion prints: take price, when-line and conditions from its latest document.
  let fromCard: { heroPriceCents: number | null; heroPriceUnit: string | null; conditions: string; timeLabel: string } | null = null;
  if (card) {
    const summary = await menuService.get(card.id);
    const doc = summary.draft ? (await menuService.getDraft(card.id)).document : summary.published ? normaliseMenuDocument((await menuService.getVersion(summary.published.id)).snapshot) : null;
    if (doc) fromCard = { heroPriceCents: doc.heroPriceCents, heroPriceUnit: doc.heroPriceUnit, conditions: doc.conditions, timeLabel: doc.whenLine || spec.timeLabel };
  }
  const fields = {
    name: spec.name,
    publicTitle: spec.publicTitle,
    summary: spec.summary,
    dayLabel: spec.dayLabel,
    cadenceLabel: spec.cadenceLabel,
    timeLabel: fromCard?.timeLabel || spec.timeLabel,
    validDays: spec.validDays,
    startTime: spec.startTime,
    heroPriceCents: fromCard?.heroPriceCents ?? null,
    heroPriceUnit: fromCard?.heroPriceUnit ?? null,
    priceLabel: spec.priceLabel,
    conditions: fromCard?.conditions ?? '',
    bookDestination: 'OPENTABLE' as const,
    bookLabel: 'Reserve'
  };

  const existing = await prisma.promotion.findUnique({ where: { venueId_slug: { venueId: venue.id, slug: spec.slug } }, select: { id: true, name: true, updatedById: true, imageId: true, menuId: true, status: true } });
  const photo = spec.image ? photoDataUrl(spec.image.path) : null;
  if (!existing) {
    if (DRY_RUN) {
      line('promotion', key, 'dry-run', `would create "${spec.name}"${card ? ` linked to card "${card.name}"` : ''}${photo ? ' with photo' : ''}`);
      return 'dry-run';
    }
    const created = await promotionService.create({ venueId: venue.id, ...fields, menuId: card && card.kind === 'PROMOTION' && card.status === 'ACTIVE' ? card.id : null }, IMPORT_ACTOR);
    if (photo && spec.image) await promotionService.setImage(created.id, { ...photo, alt: spec.image.alt }, IMPORT_ACTOR);
    await prisma.menuAuditEvent.create({
      data: { promotionId: created.id, action: 'promotion.imported', summary: `Imported from the website's What's On (${spec.confidence} confidence).`, after: { confidence: spec.confidence, review: spec.review, cardSlug: spec.cardSlug, photo: Boolean(photo) }, actorId: IMPORT_ACTOR.id, actorName: 'Menu import' }
    });
    line('promotion', key, 'created', `"${spec.name}"${card ? ` → card "${card.name}"` : ''}${photo ? ', photo attached' : spec.image ? ', photo not found' : ''}`);
    return 'created';
  }
  if (existing.updatedById !== IMPORT_ACTOR.id) {
    line('promotion', key, 'skipped', `"${existing.name}" was edited by someone — not overwritten`);
    return 'skipped';
  }
  if (DRY_RUN) {
    line('promotion', key, 'dry-run', 'would bring the working copy up to date');
    return 'dry-run';
  }
  const detail = await promotionService.get(existing.id);
  const unchanged = (Object.keys(fields) as Array<keyof typeof fields>).every((field) => JSON.stringify(detail.fields[field]) === JSON.stringify(fields[field]));
  const wantsLink = card && card.kind === 'PROMOTION' && card.status === 'ACTIVE' && existing.menuId !== card.id;
  if (!unchanged || wantsLink) await promotionService.update(existing.id, { ...fields, ...(wantsLink ? { menuId: card!.id } : {}) }, IMPORT_ACTOR);
  if (photo && spec.image && !existing.imageId) await promotionService.setImage(existing.id, { ...photo, alt: spec.image.alt }, IMPORT_ACTOR);
  line('promotion', key, unchanged && !wantsLink ? 'unchanged' : 'updated', '');
  return unchanged && !wantsLink ? 'unchanged' : 'updated';
}

async function main() {
  console.log(`Menus V2 import${DRY_RUN ? ' (dry run — nothing written)' : ''}${ONLY ? ` — only ${[...ONLY].join(', ')}` : ''}${PHOTOS ? ` — photos from ${PHOTOS}` : ''}`);
  const counts = new Map<Outcome, number>();
  for (const spec of MENU_IMPORTS) {
    if (!wanted(spec.venueSlug, spec.slug)) continue;
    const outcome = await importMenu(spec);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  for (const spec of PROMOTION_IMPORTS) {
    if (!wanted(spec.venueSlug, spec.slug)) continue;
    const outcome = await importPromotion(spec);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  console.log([...counts.entries()].map(([outcome, count]) => `${count} ${outcome}`).join(', ') || 'nothing matched');
  console.log('Nothing was published: every import is a draft (menus) or an unpublished promotion, to review in Alma Menus.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

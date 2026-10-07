/**
 * Menu Editor — the printed food menus as data.
 *
 * Everything here is pure and shared by the API (publish, PDF) and the editor
 * (live preview, validation panel, publish summary), so a rule is written and
 * tested once. Nothing in this file touches a database or a browser.
 *
 * Vocabulary:
 *   MenuDocument   the editable content of one version: footer + sections + items
 *   MenuSnapshot   a MenuDocument frozen at publish, with the menu's identity
 *   dishKey        a dish's stable identity across versions (Menu Costing hooks here)
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Dietary tags — one fixed list, in print order.
// ---------------------------------------------------------------------------

export const MENU_TAGS = [
  { code: 'V', label: 'vegetarian' },
  { code: 'VG', label: 'vegan' },
  { code: 'GF', label: 'gluten free' },
  { code: 'GFA', label: 'gluten free available' },
  { code: 'DF', label: 'dairy free' },
  { code: 'N', label: 'contains nuts' },
  { code: 'A', label: 'australian' },
  { code: 'I', label: 'imported' }
] as const;

export type MenuTagCode = (typeof MENU_TAGS)[number]['code'];

export const MENU_TAG_CODES = MENU_TAGS.map((tag) => tag.code) as MenuTagCode[];

const TAG_ORDER = new Map<string, number>(MENU_TAGS.map((tag, index) => [tag.code, index]));

export function isMenuTagCode(value: unknown): value is MenuTagCode {
  return typeof value === 'string' && TAG_ORDER.has(value);
}

/** Known codes only, de-duplicated, in print order. */
export function sortMenuTags(tags: readonly string[]): MenuTagCode[] {
  const seen = new Set<MenuTagCode>();
  for (const tag of tags) {
    const code = typeof tag === 'string' ? tag.trim().toUpperCase() : '';
    if (isMenuTagCode(code)) seen.add(code);
  }
  return MENU_TAG_CODES.filter((code) => seen.has(code));
}

/** "VG · GFA · DF · N" — how tags sit after a dish name on the print. */
export function formatMenuTags(tags: readonly string[]): string {
  return sortMenuTags(tags).join(' · ');
}

/**
 * The footer legend, generated from the tags actually in use on the printed
 * (visible) items, in print order: "V vegetarian · VG vegan · …". Never typed.
 */
export function menuTagLegend(doc: Pick<MenuDocument, 'sections'>): string {
  const inUse = new Set<MenuTagCode>();
  for (const section of doc.sections) {
    if (!section.visible) continue;
    for (const item of section.items) {
      if (!item.visible) continue;
      for (const tag of sortMenuTags(item.tags)) inUse.add(tag);
    }
  }
  return MENU_TAGS.filter((tag) => inUse.has(tag.code))
    .map((tag) => `${tag.code} ${tag.label}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

export const MENU_PLACEMENTS = ['LEFT', 'RIGHT', 'FULL'] as const;
export type MenuPlacement = (typeof MENU_PLACEMENTS)[number];

export const MENU_SECTION_TYPES = ['STANDARD', 'HEADER_PRICED', 'SET_MENUS'] as const;
export type MenuSectionType = (typeof MENU_SECTION_TYPES)[number];

export const MENU_VERSION_STATES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type MenuVersionState = (typeof MENU_VERSION_STATES)[number];

export const MENU_PLACEMENT_LABELS: Record<MenuPlacement, string> = {
  LEFT: 'Left column',
  RIGHT: 'Right column',
  FULL: 'Full width'
};

export const MENU_SECTION_TYPE_LABELS: Record<MenuSectionType, string> = {
  STANDARD: 'Standard (name, tags, price, description)',
  HEADER_PRICED: 'Priced in heading (names only)',
  SET_MENUS: 'Set menus (Trust our chef)'
};

export type MenuItemDocument = {
  /** Database id when the item already exists in the draft; absent for new ones. */
  id?: string;
  /** Stable across versions. Assigned by the server when absent. */
  dishKey?: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  /** "pp" on set menus. */
  priceUnit: string | null;
  tags: MenuTagCode[];
  isSeafood: boolean;
  /** false = 86'd: kept in the data, dropped from the print. */
  visible: boolean;
  recipeId: string | null;
};

export type MenuSectionDocument = {
  id?: string;
  title: string;
  /** "9 each" — rendered after a slash in the heading. */
  headerSuffix: string | null;
  /** "For the whole table." — italic line under a set-menu heading. */
  subheading: string | null;
  sectionType: MenuSectionType;
  placement: MenuPlacement;
  visible: boolean;
  items: MenuItemDocument[];
};

export type MenuDocument = {
  dietaryNote: string;
  surchargeLine: string;
  sections: MenuSectionDocument[];
};

/** A published version, frozen. Everything the renderer and the diff need. */
export type MenuSnapshot = MenuDocument & {
  schemaVersion: 1;
  menuId: string;
  menuName: string;
  templateKey: string;
  venue: { id: string; name: string; slug: string };
  versionNumber: number;
  publishedAt: string | null;
};

// ---------------------------------------------------------------------------
// Zod — what the API accepts from the editor
// ---------------------------------------------------------------------------

export const MENU_LIMITS = {
  nameMax: 160,
  descriptionMax: 400,
  titleMax: 80,
  headerSuffixMax: 40,
  subheadingMax: 120,
  footerLineMax: 240,
  priceUnitMax: 8,
  /** $999,999 — anything bigger is a typo. */
  priceCentsMax: 99_999_900,
  sectionsMax: 40,
  itemsPerSectionMax: 60
} as const;

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      const text = typeof value === 'string' ? value.trim() : '';
      return text ? text : null;
    })
    .pipe(z.string().max(max).nullable());

export const menuTagCodeSchema = z.enum(['V', 'VG', 'GF', 'GFA', 'DF', 'N', 'A', 'I']);
export const menuPlacementSchema = z.enum(MENU_PLACEMENTS);
export const menuSectionTypeSchema = z.enum(MENU_SECTION_TYPES);

export const menuItemDocumentSchema = z.object({
  id: z.string().min(1).optional(),
  dishKey: z.string().min(1).max(80).optional(),
  name: trimmed(MENU_LIMITS.nameMax),
  description: optionalText(MENU_LIMITS.descriptionMax),
  priceCents: z.number().int().min(0).max(MENU_LIMITS.priceCentsMax).nullable().default(null),
  priceUnit: optionalText(MENU_LIMITS.priceUnitMax),
  tags: z.array(z.string()).default([]).transform((tags) => sortMenuTags(tags)),
  isSeafood: z.boolean().default(false),
  visible: z.boolean().default(true),
  recipeId: z.string().min(1).nullable().default(null)
});

export const menuSectionDocumentSchema = z.object({
  id: z.string().min(1).optional(),
  title: trimmed(MENU_LIMITS.titleMax),
  headerSuffix: optionalText(MENU_LIMITS.headerSuffixMax),
  subheading: optionalText(MENU_LIMITS.subheadingMax),
  sectionType: menuSectionTypeSchema.default('STANDARD'),
  placement: menuPlacementSchema.default('LEFT'),
  visible: z.boolean().default(true),
  items: z.array(menuItemDocumentSchema).max(MENU_LIMITS.itemsPerSectionMax).default([])
});

export const menuDocumentSchema = z.object({
  dietaryNote: trimmed(MENU_LIMITS.footerLineMax).default(''),
  surchargeLine: trimmed(MENU_LIMITS.footerLineMax).default(''),
  sections: z.array(menuSectionDocumentSchema).max(MENU_LIMITS.sectionsMax).default([])
});

/** PUT /api/menus/:menuId/draft */
export const menuDraftSaveInputSchema = menuDocumentSchema.extend({
  /**
   * The draft's updatedAt the editor last saw. When it no longer matches, the
   * save is refused rather than silently overwriting somebody else's work on
   * the pass. Omit to force.
   */
  expectedUpdatedAt: z.string().optional()
});
export type MenuDraftSaveInput = z.infer<typeof menuDraftSaveInputSchema>;

/** POST /api/menus/:menuId/draft/publish */
export const menuPublishInputSchema = z.object({
  expectedUpdatedAt: z.string().optional(),
  /** Set when the editor has shown the warnings and the publisher accepted them. */
  acknowledgeWarnings: z.boolean().default(false)
});
export type MenuPublishInput = z.infer<typeof menuPublishInputSchema>;

/** POST /api/menus/versions/:versionId/restore */
export const menuRestoreInputSchema = z.object({
  /** An existing draft is discarded only when the caller says so. */
  replaceDraft: z.boolean().default(false)
});
export type MenuRestoreInput = z.infer<typeof menuRestoreInputSchema>;

/** POST /api/menus/:menuId/draft/items/copy-to */
export const menuCopyItemInputSchema = z.object({
  dishKey: z.string().min(1),
  targetMenuId: z.string().min(1),
  /** A section in the target draft; defaults to the one with the same title, else the first. */
  targetSectionId: z.string().min(1).optional()
});
export type MenuCopyItemInput = z.infer<typeof menuCopyItemInputSchema>;

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Whole dollars, no decimals, optional unit: 1700 → "17"; 4900 + "pp" → "49 pp". */
export function formatMenuPrice(priceCents: number | null | undefined, priceUnit?: string | null): string {
  if (priceCents === null || priceCents === undefined) return '';
  const dollars = Math.round(priceCents / 100);
  return priceUnit ? `${dollars} ${priceUnit}` : String(dollars);
}

/** The editor's numeric field: "17" → 1700, "" → null. Rejects anything that is not whole dollars. */
export function parseMenuPriceInput(value: string): number | null | undefined {
  const text = value.trim().replace(/^\$/, '');
  if (!text) return null;
  if (!/^\d{1,6}$/.test(text)) return undefined;
  return Number(text) * 100;
}

// ---------------------------------------------------------------------------
// Validation — block publish on errors, warn on warnings
// ---------------------------------------------------------------------------

export type MenuValidationLevel = 'error' | 'warning';

export type MenuValidationCode =
  | 'GF_AND_GFA'
  | 'A_AND_I'
  | 'SEAFOOD_NO_ORIGIN'
  | 'VG_AND_V'
  | 'STANDARD_NO_PRICE'
  | 'SET_MENU_NO_PRICE'
  | 'EMPTY_NAME'
  | 'EMPTY_SECTION_TITLE'
  | 'DUPLICATE_DISH_KEY'
  | 'NOTHING_TO_PRINT'
  | 'OVERFLOW';

export type MenuValidationIssue = {
  level: MenuValidationLevel;
  code: MenuValidationCode;
  message: string;
  /** Where to jump in the editor. Absent for document-level issues. */
  sectionIndex?: number;
  itemIndex?: number;
  dishKey?: string;
};

export type MenuValidationResult = {
  errors: MenuValidationIssue[];
  warnings: MenuValidationIssue[];
  ok: boolean;
};

export function validateMenuDocument(doc: MenuDocument): MenuValidationResult {
  const issues: MenuValidationIssue[] = [];
  const seenKeys = new Map<string, string>();
  let printable = 0;

  doc.sections.forEach((section, sectionIndex) => {
    const at = (itemIndex?: number, dishKey?: string): Pick<MenuValidationIssue, 'sectionIndex' | 'itemIndex' | 'dishKey'> => ({
      sectionIndex,
      ...(itemIndex !== undefined ? { itemIndex } : {}),
      ...(dishKey ? { dishKey } : {})
    });

    if (!section.title.trim()) {
      issues.push({ level: 'error', code: 'EMPTY_SECTION_TITLE', message: `Section ${sectionIndex + 1} has no title.`, ...at() });
    }

    section.items.forEach((item, itemIndex) => {
      const label = item.name.trim() || `item ${itemIndex + 1}`;
      const where = `${section.title.trim() || `section ${sectionIndex + 1}`} › ${label}`;
      const tags = new Set(sortMenuTags(item.tags));
      const place = at(itemIndex, item.dishKey);

      if (!item.name.trim()) {
        issues.push({ level: 'error', code: 'EMPTY_NAME', message: `${section.title.trim() || `Section ${sectionIndex + 1}`}: item ${itemIndex + 1} has no name.`, ...place });
      }
      if (tags.has('GF') && tags.has('GFA')) {
        issues.push({ level: 'error', code: 'GF_AND_GFA', message: `${where}: GF and GFA are both set. A dish is either gluten free or gluten free available.`, ...place });
      }
      if (tags.has('A') && tags.has('I')) {
        issues.push({ level: 'error', code: 'A_AND_I', message: `${where}: A and I are both set. Seafood is Australian or imported, not both.`, ...place });
      }
      if (item.isSeafood && !tags.has('A') && !tags.has('I')) {
        issues.push({ level: 'error', code: 'SEAFOOD_NO_ORIGIN', message: `${where}: seafood must carry an origin tag, A (Australian) or I (imported).`, ...place });
      }
      if (tags.has('VG') && tags.has('V')) {
        issues.push({ level: 'warning', code: 'VG_AND_V', message: `${where}: VG and V are both set. VG already implies V; the print shows both.`, ...place });
      }
      if (section.sectionType === 'SET_MENUS' && item.priceCents === null) {
        issues.push({ level: 'error', code: 'SET_MENU_NO_PRICE', message: `${where}: a set menu needs a price.`, ...place });
      }
      if (section.sectionType === 'STANDARD' && item.priceCents === null && section.visible && item.visible) {
        issues.push({ level: 'warning', code: 'STANDARD_NO_PRICE', message: `${where}: no price. It will print without one.`, ...place });
      }
      if (item.dishKey) {
        const existing = seenKeys.get(item.dishKey);
        if (existing) {
          issues.push({ level: 'error', code: 'DUPLICATE_DISH_KEY', message: `${where}: shares its dish key with ${existing}. Duplicate the dish instead of reusing its key.`, ...place });
        } else {
          seenKeys.set(item.dishKey, where);
        }
      }
      if (section.visible && item.visible) printable += 1;
    });
  });

  if (printable === 0) {
    issues.push({ level: 'error', code: 'NOTHING_TO_PRINT', message: 'Nothing is visible. Un-hide at least one item before publishing.' });
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return { errors, warnings, ok: errors.length === 0 };
}

// ---------------------------------------------------------------------------
// Page fill / overflow — measured in a browser, reported in one shape
// ---------------------------------------------------------------------------

export type MenuFillReport = {
  /** Natural content height over the sheet's fixed height. 1.0 = exactly full. */
  fillRatio: number;
  contentHeightPx: number;
  sheetHeightPx: number;
  overflow: boolean;
};

/**
 * JavaScript evaluated inside a rendered menu page (iframe or headless Chrome).
 * Lets the sheet grow to its natural height for a moment, measures it against
 * its fixed A4 height, then puts it back. The flex `margin-top:auto` on the set
 * menu band resolves to zero while the height is auto, so the measurement is
 * of content, not of the gap the layout would otherwise push to the bottom.
 */
export const MENU_FILL_PROBE_SCRIPT = `(() => {
  const sheet = document.querySelector('.food-print-page .sheet');
  if (!sheet) return { fillRatio: 0, contentHeightPx: 0, sheetHeightPx: 0, overflow: false };
  const fixed = sheet.getBoundingClientRect().height;
  const prevHeight = sheet.style.height;
  const prevOverflow = sheet.style.overflow;
  sheet.style.height = 'auto';
  sheet.style.overflow = 'visible';
  const natural = sheet.getBoundingClientRect().height;
  sheet.style.height = prevHeight;
  sheet.style.overflow = prevOverflow;
  const ratio = fixed > 0 ? natural / fixed : 0;
  return { fillRatio: ratio, contentHeightPx: natural, sheetHeightPx: fixed, overflow: natural > fixed + 0.5 };
})()`;

export function overflowIssue(report: MenuFillReport): MenuValidationIssue | null {
  if (!report.overflow) return null;
  const percent = Math.round(report.fillRatio * 100);
  return {
    level: 'error',
    code: 'OVERFLOW',
    message: `The menu runs past one A4 page (${percent}% of the page). Hide or shorten something before publishing.`
  };
}

// ---------------------------------------------------------------------------
// Diff — what changed between two documents, by dish key
// ---------------------------------------------------------------------------

export type MenuDishRef = { dishKey: string; name: string; section: string };

export type MenuDiff = {
  added: MenuDishRef[];
  removed: MenuDishRef[];
  priceChanges: Array<MenuDishRef & { from: string; to: string }>;
  tagChanges: Array<MenuDishRef & { from: string; to: string }>;
  renamed: Array<MenuDishRef & { from: string; to: string }>;
  descriptionChanges: Array<MenuDishRef & { from: string; to: string }>;
  /** Items hidden (86'd) or brought back. */
  visibilityChanges: Array<MenuDishRef & { visible: boolean }>;
  /** A dish that moved to a different section. */
  moved: Array<MenuDishRef & { from: string; to: string }>;
  /** Section-level changes in words: added, removed, renamed, placement, type, hidden. */
  sectionChanges: string[];
  footerChanges: string[];
};

type FlatItem = MenuItemDocument & { section: MenuSectionDocument; sectionIndex: number; itemIndex: number };

function flatten(doc: MenuDocument): Map<string, FlatItem> {
  const out = new Map<string, FlatItem>();
  doc.sections.forEach((section, sectionIndex) => {
    section.items.forEach((item, itemIndex) => {
      const key = item.dishKey ?? `__${sectionIndex}:${itemIndex}`;
      if (!out.has(key)) out.set(key, { ...item, section, sectionIndex, itemIndex });
    });
  });
  return out;
}

function sectionKey(section: MenuSectionDocument, index: number) {
  return section.id ?? `${section.title.toLowerCase()}#${index}`;
}

function describeSection(section: MenuSectionDocument) {
  return `${section.title || 'Untitled'} (${MENU_PLACEMENT_LABELS[section.placement].toLowerCase()}, ${section.sectionType.toLowerCase().replace('_', ' ')})`;
}

export function diffMenuDocuments(before: MenuDocument | null, after: MenuDocument): MenuDiff {
  const diff: MenuDiff = {
    added: [],
    removed: [],
    priceChanges: [],
    tagChanges: [],
    renamed: [],
    descriptionChanges: [],
    visibilityChanges: [],
    moved: [],
    sectionChanges: [],
    footerChanges: []
  };
  const prev = before ? flatten(before) : new Map<string, FlatItem>();
  const next = flatten(after);

  for (const [key, item] of next) {
    const ref: MenuDishRef = { dishKey: key, name: item.name, section: item.section.title };
    const old = prev.get(key);
    if (!old) {
      diff.added.push(ref);
      continue;
    }
    const oldPrice = formatMenuPrice(old.priceCents, old.priceUnit);
    const newPrice = formatMenuPrice(item.priceCents, item.priceUnit);
    if (oldPrice !== newPrice) diff.priceChanges.push({ ...ref, from: oldPrice || '—', to: newPrice || '—' });
    const oldTags = formatMenuTags(old.tags);
    const newTags = formatMenuTags(item.tags);
    if (oldTags !== newTags) diff.tagChanges.push({ ...ref, from: oldTags || '—', to: newTags || '—' });
    if (old.name.trim() !== item.name.trim()) diff.renamed.push({ ...ref, from: old.name, to: item.name });
    if ((old.description ?? '') !== (item.description ?? '')) {
      diff.descriptionChanges.push({ ...ref, from: old.description ?? '—', to: item.description ?? '—' });
    }
    if (old.visible !== item.visible) diff.visibilityChanges.push({ ...ref, visible: item.visible });
    if (old.section.title.trim().toLowerCase() !== item.section.title.trim().toLowerCase()) {
      diff.moved.push({ ...ref, from: old.section.title, to: item.section.title });
    }
  }
  for (const [key, item] of prev) {
    if (!next.has(key)) diff.removed.push({ dishKey: key, name: item.name, section: item.section.title });
  }

  // Sections: matched by id where both sides carry one, else by title.
  const beforeSections = before?.sections ?? [];
  const byId = new Map(beforeSections.map((section, index) => [sectionKey(section, index), section]));
  const byTitle = new Map(beforeSections.map((section) => [section.title.trim().toLowerCase(), section]));
  const matched = new Set<MenuSectionDocument>();
  after.sections.forEach((section, index) => {
    const old = (section.id ? byId.get(sectionKey(section, index)) : undefined) ?? byTitle.get(section.title.trim().toLowerCase());
    if (!old) {
      if (before) diff.sectionChanges.push(`Added section ${describeSection(section)}.`);
      return;
    }
    matched.add(old);
    if (old.title !== section.title) diff.sectionChanges.push(`Renamed section "${old.title}" to "${section.title}".`);
    if (old.placement !== section.placement) {
      diff.sectionChanges.push(`${section.title}: moved from ${MENU_PLACEMENT_LABELS[old.placement].toLowerCase()} to ${MENU_PLACEMENT_LABELS[section.placement].toLowerCase()}.`);
    }
    if (old.sectionType !== section.sectionType) diff.sectionChanges.push(`${section.title}: type changed to ${section.sectionType.toLowerCase().replace('_', ' ')}.`);
    if ((old.headerSuffix ?? '') !== (section.headerSuffix ?? '')) {
      diff.sectionChanges.push(`${section.title}: heading suffix "${old.headerSuffix ?? '—'}" → "${section.headerSuffix ?? '—'}".`);
    }
    if ((old.subheading ?? '') !== (section.subheading ?? '')) {
      diff.sectionChanges.push(`${section.title}: subheading "${old.subheading ?? '—'}" → "${section.subheading ?? '—'}".`);
    }
    if (old.visible !== section.visible) diff.sectionChanges.push(`${section.title}: ${section.visible ? 'shown again' : 'hidden from the print'}.`);
  });
  for (const old of beforeSections) {
    if (!matched.has(old)) diff.sectionChanges.push(`Removed section ${describeSection(old)}.`);
  }

  if (before) {
    if (before.dietaryNote !== after.dietaryNote) diff.footerChanges.push(`Dietary note: "${before.dietaryNote}" → "${after.dietaryNote}".`);
    if (before.surchargeLine !== after.surchargeLine) diff.footerChanges.push(`Surcharge line: "${before.surchargeLine}" → "${after.surchargeLine}".`);
  }

  return diff;
}

export function menuDiffIsEmpty(diff: MenuDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.priceChanges.length === 0 &&
    diff.tagChanges.length === 0 &&
    diff.renamed.length === 0 &&
    diff.descriptionChanges.length === 0 &&
    diff.visibilityChanges.length === 0 &&
    diff.moved.length === 0 &&
    diff.sectionChanges.length === 0 &&
    diff.footerChanges.length === 0
  );
}

/** "2 added, 1 removed, 3 price changes" — the audit line and the publish dialog headline. */
export function summariseMenuDiff(diff: MenuDiff): string {
  const parts: string[] = [];
  const count = (n: number, singular: string, plural = `${singular}s`) => (n > 0 ? parts.push(`${n} ${n === 1 ? singular : plural}`) : undefined);
  count(diff.added.length, 'dish added', 'dishes added');
  count(diff.removed.length, 'dish removed', 'dishes removed');
  count(diff.priceChanges.length, 'price change');
  count(diff.tagChanges.length, 'tag change');
  count(diff.renamed.length, 'rename');
  count(diff.descriptionChanges.length, 'description change');
  const hidden = diff.visibilityChanges.filter((change) => !change.visible).length;
  const shown = diff.visibilityChanges.length - hidden;
  count(hidden, "dish 86'd", "dishes 86'd");
  count(shown, 'dish back on', 'dishes back on');
  count(diff.moved.length, 'dish moved', 'dishes moved');
  count(diff.sectionChanges.length, 'section change');
  count(diff.footerChanges.length, 'footer change');
  return parts.length ? parts.join(', ') : 'No content changes';
}

// ---------------------------------------------------------------------------
// Dish keys
// ---------------------------------------------------------------------------

/**
 * A new dish's key: a readable slug of its name plus a short random suffix, so
 * two "Churros" at two venues never collide and a key survives a rename. Pure
 * so the editor can mint one when it duplicates a dish offline.
 */
export function newDishKey(name: string, random: () => number = Math.random): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += alphabet[Math.floor(random() * alphabet.length)] ?? 'a';
  return `${slug || 'dish'}-${suffix}`;
}

/** Fill in missing dish keys without touching the ones already set. */
export function ensureDishKeys(doc: MenuDocument, random?: () => number): MenuDocument {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => (item.dishKey ? item : { ...item, dishKey: newDishKey(item.name, random) }))
    }))
  };
}

// ---------------------------------------------------------------------------
// API payload shapes (what the editor receives)
// ---------------------------------------------------------------------------

export type MenuActor = { id: string | null; name: string | null } | null;

export type MenuVersionSummary = {
  id: string;
  versionNumber: number;
  state: MenuVersionState;
  publishedAt: string | null;
  publishedBy: MenuActor;
  createdAt: string;
  updatedAt: string;
  updatedBy: MenuActor;
  restoredFromVersionId: string | null;
  hasPdf: boolean;
  pdfByteSize: number | null;
};

export type MenuSummary = {
  id: string;
  name: string;
  templateKey: string;
  venue: { id: string; name: string; slug: string };
  published: MenuVersionSummary | null;
  draft: MenuVersionSummary | null;
  /** The newest write of any kind — publish or draft save. */
  lastEdited: { at: string; by: MenuActor } | null;
};

export type MenuDraftPayload = {
  menu: Pick<MenuSummary, 'id' | 'name' | 'templateKey' | 'venue'>;
  version: MenuVersionSummary;
  document: MenuDocument;
  /** The document this draft is being compared against in the publish summary. */
  publishedDocument: MenuDocument | null;
  publishedVersion: MenuVersionSummary | null;
};

export type MenuVersionPayload = {
  menu: Pick<MenuSummary, 'id' | 'name' | 'templateKey' | 'venue'>;
  version: MenuVersionSummary;
  snapshot: MenuSnapshot;
};

export type MenuPublishPreview = {
  validation: MenuValidationResult;
  /** Null when the server could not measure the page (renderer unavailable). */
  fill: MenuFillReport | null;
  renderer: { ok: boolean; message: string };
  diff: MenuDiff;
  summary: string;
  canPublish: boolean;
};

export type MenuAuditEntry = {
  id: string;
  action: string;
  summary: string;
  actor: MenuActor & { email?: string | null };
  menuVersionId: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
};

/** Who may publish: managers, admins and the head chef. Mirrors the API's rule. */
export function canPublishMenus(user: {
  role?: string | null;
  isAdmin?: boolean | null;
  roleTitle?: string | null;
  accountType?: string | null;
  appAccess?: Array<{ appId: string; status: string; role: string }> | null;
} | null | undefined): boolean {
  if (!user || user.accountType === 'VENUE_DEVICE') return false;
  if (user.isAdmin || user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  if ((user.roleTitle ?? '').toLowerCase().includes('head chef')) return true;
  return Boolean(
    user.appAccess?.some((access) => access.appId === 'MENUS' && access.status === 'ENABLED' && (access.role === 'MANAGER' || access.role === 'ADMIN'))
  );
}

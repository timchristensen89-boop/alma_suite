/**
 * Alma Menus — every printed and website menu as data.
 *
 * Everything here is pure and shared by the API (publish, PDF, public
 * endpoints) and the editor (live preview, validation panel, publish summary),
 * so a rule is written and tested once. Nothing in this file touches a database
 * or a browser.
 *
 * Vocabulary:
 *   MenuDocument   the editable content of one version: title block, footer, sections, items
 *   MenuSnapshot   a MenuDocument frozen at publish, with the menu's identity
 *   dishKey        a dish's stable identity across versions (Menu Costing hooks here)
 *   kind           what the menu is for: FOOD, DRINKS, FUNCTIONS, PROMOTION, PRIVATE_EVENT
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
// Kinds, flags, visibility — the small fixed vocabularies of V2
// ---------------------------------------------------------------------------

/** What a menu is for. Decides which templates, rules and home group apply. */
export const MENU_KINDS = ['FOOD', 'DRINKS', 'FUNCTIONS', 'PROMOTION', 'PRIVATE_EVENT'] as const;
export type MenuKind = (typeof MENU_KINDS)[number];

export const MENU_KIND_LABELS: Record<MenuKind, string> = {
  FOOD: 'Food',
  DRINKS: 'Drinks',
  FUNCTIONS: 'Functions & groups',
  PROMOTION: 'Promotion',
  PRIVATE_EVENT: 'Private event'
};

export function isMenuKind(value: unknown): value is MenuKind {
  return typeof value === 'string' && (MENU_KINDS as readonly string[]).includes(value);
}

/** Kinds whose items are dishes: the seafood-origin and gluten rules apply. */
export function menuKindServesFood(kind: MenuKind): boolean {
  return kind !== 'DRINKS';
}

/** PUBLIC menus may be served by the public endpoints once published; PRIVATE never. */
export const MENU_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type MenuVisibility = (typeof MENU_VISIBILITIES)[number];

/** Non-dietary marks on an item. One meaning per mark; the legend is generated. */
export const MENU_ITEM_FLAGS = [
  { code: 'STAFF_PICK', mark: '•', label: 'Staff pick' },
  { code: 'LIMITED', mark: '**', label: 'Limited stock' },
  { code: 'ON_TAP', mark: '', label: 'On tap' },
  { code: 'NEW', mark: '', label: 'New' }
] as const;
export type MenuItemFlag = (typeof MENU_ITEM_FLAGS)[number]['code'];
export const MENU_ITEM_FLAG_CODES = MENU_ITEM_FLAGS.map((flag) => flag.code) as MenuItemFlag[];

export function sortMenuItemFlags(flags: readonly string[]): MenuItemFlag[] {
  const wanted = new Set(flags.map((flag) => (typeof flag === 'string' ? flag.trim().toUpperCase() : '')));
  return MENU_ITEM_FLAG_CODES.filter((code) => wanted.has(code));
}

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

export const MENU_PLACEMENTS = ['LEFT', 'RIGHT', 'FULL'] as const;
export type MenuPlacement = (typeof MENU_PLACEMENTS)[number];

export const MENU_SECTION_TYPES = ['STANDARD', 'HEADER_PRICED', 'SET_MENUS', 'TEXT', 'LIST', 'TABLE', 'COURSE'] as const;
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
  SET_MENUS: 'Set menus / packages (name, price pp, note)',
  TEXT: 'Text (intro, callout, conditions)',
  LIST: 'List (names only, no prices)',
  TABLE: 'Price table (several price columns)',
  COURSE: 'Course (private event — label, choices, dishes)'
};

/** Section types whose items carry no price of their own. */
export function sectionTypeIsUnpriced(type: MenuSectionType): boolean {
  return type === 'HEADER_PRICED' || type === 'LIST' || type === 'TEXT';
}

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
  /** TABLE sections: one price per column of the section, null = not offered. */
  prices: Array<number | null>;
  /** Small grey detail after the name: ABV, region, vintage, "serves three". */
  meta: string | null;
  /** Serving note under the description. */
  note: string | null;
  flags: MenuItemFlag[];
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
  /** Which sheet of a multi-page document the section prints on (1-based). */
  page: number;
  /** Short caps lead-in above the items ("Two per person", "Select from"). */
  lead: string | null;
  /** Prose for TEXT sections. */
  body: string | null;
  /** Column labels for TABLE sections ("150 mL", "250 mL", "Bottle"). */
  priceColumns: string[];
  visible: boolean;
  items: MenuItemDocument[];
};

export type MenuDocument = {
  /**
   * The italic line under the masthead rule ("À la carte", "Taco Tuesday").
   * Empty means the template's own title, so the two menus printed today keep
   * reading "À la carte" without anyone typing it.
   */
  heading: string;
  /** Card and package fields; empty = not printed. */
  subheading: string;
  whenLine: string;
  heroPriceCents: number | null;
  heroPriceUnit: string | null;
  conditions: string;
  /** false hides every item price. */
  showPrices: boolean;
  /** Sheets the document declares. Sections name the page they print on. */
  pageCount: number;
  dietaryNote: string;
  surchargeLine: string;
  sections: MenuSectionDocument[];
};

/** A published version, frozen. Everything the renderer and the diff need. */
export type MenuSnapshot = MenuDocument & {
  /** 1: before Menus V2 (no card fields, no pages). 2: current. Readers backfill. */
  schemaVersion: 1 | 2;
  menuId: string;
  menuName: string;
  templateKey: string;
  venue: { id: string; name: string; slug: string };
  versionNumber: number;
  publishedAt: string | null;
};

/** The defaults every new document field takes, so v1 snapshots read as v2. */
export const MENU_DOCUMENT_DEFAULTS = {
  heading: '',
  subheading: '',
  whenLine: '',
  heroPriceCents: null,
  heroPriceUnit: null,
  conditions: '',
  showPrices: true,
  pageCount: 1,
  dietaryNote: '',
  surchargeLine: ''
} as const;

/** A document with every field present — old snapshots and old editors omit the V2 ones. */
export function normaliseMenuDocument(doc: Partial<MenuDocument> & { sections?: Array<Partial<MenuSectionDocument> & { items?: Array<Partial<MenuItemDocument>> }> }): MenuDocument {
  return {
    heading: doc.heading ?? '',
    subheading: doc.subheading ?? '',
    whenLine: doc.whenLine ?? '',
    heroPriceCents: doc.heroPriceCents ?? null,
    heroPriceUnit: doc.heroPriceUnit ?? null,
    conditions: doc.conditions ?? '',
    showPrices: doc.showPrices ?? true,
    pageCount: Math.max(1, doc.pageCount ?? 1),
    dietaryNote: doc.dietaryNote ?? '',
    surchargeLine: doc.surchargeLine ?? '',
    sections: (doc.sections ?? []).map((section) => ({
      ...(section.id ? { id: section.id } : {}),
      title: section.title ?? '',
      headerSuffix: section.headerSuffix ?? null,
      subheading: section.subheading ?? null,
      sectionType: section.sectionType ?? 'STANDARD',
      placement: section.placement ?? 'LEFT',
      page: Math.max(1, section.page ?? 1),
      lead: section.lead ?? null,
      body: section.body ?? null,
      priceColumns: section.priceColumns ?? [],
      visible: section.visible ?? true,
      items: (section.items ?? []).map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        ...(item.dishKey ? { dishKey: item.dishKey } : {}),
        name: item.name ?? '',
        description: item.description ?? null,
        priceCents: item.priceCents ?? null,
        priceUnit: item.priceUnit ?? null,
        prices: Array.isArray(item.prices) ? item.prices.map((price) => (typeof price === 'number' ? price : null)) : [],
        meta: item.meta ?? null,
        note: item.note ?? null,
        flags: sortMenuItemFlags(item.flags ?? []),
        tags: sortMenuTags(item.tags ?? []),
        isSeafood: item.isSeafood ?? false,
        visible: item.visible ?? true,
        recipeId: item.recipeId ?? null
      }))
    }))
  };
}

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
  headingMax: 60,
  /** "Food", "Tuesday", "New Year's Eve" — the name on the module home and in the PDF filename. */
  menuNameMax: 60,
  priceUnitMax: 8,
  /** $999,999 — anything bigger is a typo. */
  priceCentsMax: 99_999_900,
  sectionsMax: 60,
  itemsPerSectionMax: 60,
  /** V2 fields. */
  whenLineMax: 120,
  conditionsMax: 1200,
  leadMax: 80,
  bodyMax: 2000,
  metaMax: 80,
  noteMax: 200,
  priceColumnsMax: 4,
  priceColumnLabelMax: 16,
  pagesMax: 24,
  eventNameMax: 120,
  organiserRefMax: 80,
  guestCountMax: 500
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
const cents = z.number().int().min(0).max(MENU_LIMITS.priceCentsMax);

export const menuTagCodeSchema = z.enum(MENU_TAG_CODES as [MenuTagCode, ...MenuTagCode[]]);
export const menuPlacementSchema = z.enum(MENU_PLACEMENTS);
export const menuSectionTypeSchema = z.enum(MENU_SECTION_TYPES);
export const menuKindSchema = z.enum(MENU_KINDS);
export const menuVisibilitySchema = z.enum(MENU_VISIBILITIES);

export const menuItemDocumentSchema = z.object({
  id: z.string().min(1).optional(),
  dishKey: z.string().min(1).max(80).optional(),
  name: trimmed(MENU_LIMITS.nameMax),
  description: optionalText(MENU_LIMITS.descriptionMax),
  priceCents: cents.nullable().default(null),
  priceUnit: optionalText(MENU_LIMITS.priceUnitMax),
  prices: z.array(cents.nullable()).max(MENU_LIMITS.priceColumnsMax).default([]),
  meta: optionalText(MENU_LIMITS.metaMax),
  note: optionalText(MENU_LIMITS.noteMax),
  flags: z.array(z.string()).default([]).transform((flags) => sortMenuItemFlags(flags)),
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
  page: z.number().int().min(1).max(MENU_LIMITS.pagesMax).default(1),
  lead: optionalText(MENU_LIMITS.leadMax),
  body: optionalText(MENU_LIMITS.bodyMax),
  priceColumns: z.array(trimmed(MENU_LIMITS.priceColumnLabelMax)).max(MENU_LIMITS.priceColumnsMax).default([]),
  visible: z.boolean().default(true),
  items: z.array(menuItemDocumentSchema).max(MENU_LIMITS.itemsPerSectionMax).default([])
});

export const menuDocumentSchema = z.object({
  heading: trimmed(MENU_LIMITS.headingMax).default(''),
  subheading: trimmed(MENU_LIMITS.subheadingMax).default(''),
  whenLine: trimmed(MENU_LIMITS.whenLineMax).default(''),
  heroPriceCents: cents.nullable().default(null),
  heroPriceUnit: optionalText(MENU_LIMITS.priceUnitMax),
  conditions: trimmed(MENU_LIMITS.conditionsMax).default(''),
  showPrices: z.boolean().default(true),
  pageCount: z.number().int().min(1).max(MENU_LIMITS.pagesMax).default(1),
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

const eventDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  })
  .pipe(z.string().nullable());

/** The private-event details, internal only. */
export const menuEventFieldsSchema = z.object({
  eventName: optionalText(MENU_LIMITS.eventNameMax),
  /** ISO date; the day the event runs. */
  eventDate: eventDate,
  organiserRef: optionalText(MENU_LIMITS.organiserRefMax),
  guestCount: z.number().int().min(1).max(MENU_LIMITS.guestCountMax).nullable().default(null)
});

/** POST /api/menus — a new menu for a venue (a Tuesday menu, an event menu). */
export const menuCreateInputSchema = z.object({
  venueId: z.string().min(1),
  name: trimmed(MENU_LIMITS.menuNameMax).min(1),
  kind: menuKindSchema.default('FOOD'),
  /** One of the venue's print templates for this kind (menuTemplatesForVenue). Omit when there is exactly one. */
  templateKey: z.string().min(1).optional(),
  /** Start the first draft from this menu's live version (its draft when nothing is live yet) instead of empty. */
  copyFromMenuId: z.string().min(1).optional(),
  /** The printed heading of the first draft; empty keeps the template's title. */
  heading: trimmed(MENU_LIMITS.headingMax).default(''),
  /** Defaults by kind: private-event menus are PRIVATE, everything else PUBLIC. */
  visibility: menuVisibilitySchema.optional(),
  eventName: optionalText(MENU_LIMITS.eventNameMax).optional(),
  eventDate: eventDate.optional(),
  organiserRef: optionalText(MENU_LIMITS.organiserRefMax).optional(),
  guestCount: z.number().int().min(1).max(MENU_LIMITS.guestCountMax).nullable().optional()
});
export type MenuCreateInput = z.infer<typeof menuCreateInputSchema>;

/** PATCH /api/menus/:menuId — rename, visibility, event details. Every field optional; the slug never changes. */
export const menuUpdateInputSchema = z
  .object({
    name: trimmed(MENU_LIMITS.menuNameMax).min(1).optional(),
    visibility: menuVisibilitySchema.optional(),
    eventName: optionalText(MENU_LIMITS.eventNameMax).optional(),
    eventDate: eventDate.optional(),
    organiserRef: optionalText(MENU_LIMITS.organiserRefMax).optional(),
    guestCount: z.number().int().min(1).max(MENU_LIMITS.guestCountMax).nullable().optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'Nothing to change.' });
export type MenuUpdateInput = z.infer<typeof menuUpdateInputSchema>;

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Dollars, with cents only when there are any, optional unit: 1700 → "17";
 * 1250 → "12.50"; 4900 + "pp" → "49 pp". Whole dollars stay the house style;
 * a drink at 12.50 prints as such rather than rounding to 13.
 */
export function formatMenuPrice(priceCents: number | null | undefined, priceUnit?: string | null): string {
  if (priceCents === null || priceCents === undefined) return '';
  const whole = Math.round(priceCents) % 100 === 0;
  const amount = whole ? String(Math.round(priceCents / 100)) : (Math.round(priceCents) / 100).toFixed(2);
  return priceUnit ? `${amount} ${priceUnit}` : amount;
}

/** The editor's numeric field: "17" → 1700, "12.5" → 1250, "" → null. Rejects anything that is not dollars with at most two decimals. */
export function parseMenuPriceInput(value: string): number | null | undefined {
  const text = value.trim().replace(/^\$/, '');
  if (!text) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return undefined;
  return Math.round(Number(text) * 100);
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
  | 'EMPTY_TEXT'
  | 'PAGE_OUT_OF_RANGE'
  | 'TABLE_NO_COLUMNS'
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
  /** Which sheet, for page-level issues. */
  page?: number;
};

export type MenuValidationResult = {
  errors: MenuValidationIssue[];
  warnings: MenuValidationIssue[];
  ok: boolean;
};

export type MenuValidationOptions = {
  /** Scopes the dietary rules: drinks menus skip the seafood and gluten rules. Defaults to FOOD. */
  kind?: MenuKind;
  /** The most pages the template allows (1 for the A4 sheets). Defaults to MENU_LIMITS.pagesMax. */
  maxPages?: number;
};

export function validateMenuDocument(doc: MenuDocument, options: MenuValidationOptions = {}): MenuValidationResult {
  const kind = options.kind ?? 'FOOD';
  const foodRules = menuKindServesFood(kind);
  const issues: MenuValidationIssue[] = [];
  const seenKeys = new Map<string, string>();
  let printable = 0;
  const maxPages = options.maxPages ?? MENU_LIMITS.pagesMax;
  if ((doc.pageCount ?? 1) > maxPages) {
    issues.push({
      level: 'error',
      code: 'PAGE_OUT_OF_RANGE',
      message: maxPages === 1 ? 'This template prints one sheet; the menu declares more than one page.' : `This template prints at most ${maxPages} pages; the menu declares ${doc.pageCount}.`
    });
  }

  doc.sections.forEach((section, sectionIndex) => {
    const at = (itemIndex?: number, dishKey?: string): Pick<MenuValidationIssue, 'sectionIndex' | 'itemIndex' | 'dishKey'> => ({
      sectionIndex,
      ...(itemIndex !== undefined ? { itemIndex } : {}),
      ...(dishKey ? { dishKey } : {})
    });
    const isText = section.sectionType === 'TEXT';

    // A hidden section is off the print: its title can wait, but say so. A
    // text block may stand without a title when it has a body.
    if (!section.title.trim() && !(isText && (section.body ?? '').trim())) {
      issues.push({
        level: section.visible ? 'error' : 'warning',
        code: 'EMPTY_SECTION_TITLE',
        message: section.visible ? `Section ${sectionIndex + 1} has no title.` : `Hidden section ${sectionIndex + 1} has no title yet.`,
        ...at()
      });
    }
    if (section.visible && section.page > doc.pageCount) {
      issues.push({
        level: 'error',
        code: 'PAGE_OUT_OF_RANGE',
        message: `${section.title.trim() || `Section ${sectionIndex + 1}`} is on page ${section.page}, but the menu has ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}.`,
        page: section.page,
        ...at()
      });
    }
    if (isText) {
      if (section.visible && !(section.body ?? '').trim()) {
        issues.push({ level: 'warning', code: 'EMPTY_TEXT', message: `${section.title.trim() || `Section ${sectionIndex + 1}`}: the text block is empty and will print nothing.`, ...at() });
      } else if (section.visible) {
        printable += 1;
      }
      // Items on a text block never print; nothing below applies.
      return;
    }
    if (section.sectionType === 'TABLE' && section.visible && section.priceColumns.length === 0) {
      issues.push({ level: 'error', code: 'TABLE_NO_COLUMNS', message: `${section.title.trim() || `Section ${sectionIndex + 1}`}: a price table needs at least one column label (e.g. "150 mL").`, ...at() });
    }

    section.items.forEach((item, itemIndex) => {
      const label = item.name.trim() || `item ${itemIndex + 1}`;
      const where = `${section.title.trim() || `section ${sectionIndex + 1}`} › ${label}`;
      const tags = new Set(sortMenuTags(item.tags));
      const place = at(itemIndex, item.dishKey);
      const printed = section.visible && item.visible;

      // Dish keys must be unique whether or not the dish prints — they are
      // the identity the diff and Menu Costing hang off.
      if (item.dishKey) {
        const existing = seenKeys.get(item.dishKey);
        if (existing) {
          issues.push({ level: 'error', code: 'DUPLICATE_DISH_KEY', message: `${where}: shares its dish key with ${existing}. Duplicate the dish instead of reusing its key.`, ...place });
        } else {
          seenKeys.set(item.dishKey, where);
        }
      }

      // Everything below is about what the guest reads. An 86'd dish or a
      // dish in a hidden section prints nothing, so a half-built next-week
      // special must not block tonight's price fix.
      if (!printed) return;

      if (!item.name.trim()) {
        issues.push({ level: 'error', code: 'EMPTY_NAME', message: `${section.title.trim() || `Section ${sectionIndex + 1}`}: item ${itemIndex + 1} has no name.`, ...place });
      }
      if (foodRules) {
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
      }
      if (doc.showPrices) {
        if (section.sectionType === 'SET_MENUS' && item.priceCents === null) {
          issues.push({ level: 'error', code: 'SET_MENU_NO_PRICE', message: `${where}: a set menu needs a price.`, ...place });
        }
        if ((section.sectionType === 'STANDARD' || section.sectionType === 'COURSE') && item.priceCents === null && section.sectionType === 'STANDARD') {
          issues.push({ level: 'warning', code: 'STANDARD_NO_PRICE', message: `${where}: no price. It will print without one.`, ...place });
        }
        if (section.sectionType === 'TABLE' && !item.prices.some((price) => price !== null)) {
          issues.push({ level: 'warning', code: 'STANDARD_NO_PRICE', message: `${where}: no price in any column. It will print with dots only.`, ...place });
        }
      }
      printable += 1;
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

export type MenuPageFill = {
  /** 1-based sheet number. */
  page: number;
  fillRatio: number;
  contentHeightPx: number;
  sheetHeightPx: number;
  overflow: boolean;
};

export type MenuFillReport = {
  /** The fullest sheet's natural content height over its fixed height. 1.0 = exactly full. */
  fillRatio: number;
  contentHeightPx: number;
  sheetHeightPx: number;
  overflow: boolean;
  /** Every sheet, in page order. Absent from reports made before V2. */
  pages?: MenuPageFill[];
};

/**
 * JavaScript evaluated inside a rendered menu page (iframe or headless Chrome).
 * For every sheet, lets it grow to its natural height for a moment, measures it
 * against its fixed height, then puts it back. The flex `margin-top:auto` on a
 * set menu band resolves to zero while the height is auto, so the measurement
 * is of content, not of the gap the layout would otherwise push to the bottom.
 * The top-level numbers describe the fullest sheet, so a one-page menu reads
 * exactly as it did before pages existed.
 */
export const MENU_FILL_PROBE_SCRIPT = `(() => {
  const sheets = Array.from(document.querySelectorAll('.menu-print-page .sheet, .food-print-page .sheet'));
  if (sheets.length === 0) return { fillRatio: 0, contentHeightPx: 0, sheetHeightPx: 0, overflow: false, pages: [] };
  const pages = sheets.map((sheet, index) => {
    const fixed = sheet.getBoundingClientRect().height;
    const prevHeight = sheet.style.height;
    const prevOverflow = sheet.style.overflow;
    sheet.style.height = 'auto';
    sheet.style.overflow = 'visible';
    const natural = sheet.getBoundingClientRect().height;
    sheet.style.height = prevHeight;
    sheet.style.overflow = prevOverflow;
    const ratio = fixed > 0 ? natural / fixed : 0;
    return { page: index + 1, fillRatio: ratio, contentHeightPx: natural, sheetHeightPx: fixed, overflow: natural > fixed + 0.5 };
  });
  const worst = pages.reduce((a, b) => (b.fillRatio > a.fillRatio ? b : a), pages[0]);
  return { fillRatio: worst.fillRatio, contentHeightPx: worst.contentHeightPx, sheetHeightPx: worst.sheetHeightPx, overflow: pages.some((p) => p.overflow), pages };
})()`;

export function overflowIssue(report: MenuFillReport, pageLabel = 'one A4 page'): MenuValidationIssue | null {
  if (!report.overflow) return null;
  const overflowing = (report.pages ?? []).filter((page) => page.overflow);
  if (overflowing.length > 0 && (report.pages?.length ?? 0) > 1) {
    const first = overflowing[0]!;
    const percent = Math.round(first.fillRatio * 100);
    return {
      level: 'error',
      code: 'OVERFLOW',
      message: `Page ${first.page} runs past the sheet (${percent}% of the page). Move a section to another page, or hide or shorten something before publishing.`,
      page: first.page
    };
  }
  const percent = Math.round(report.fillRatio * 100);
  return {
    level: 'error',
    code: 'OVERFLOW',
    message: `The menu runs past ${pageLabel} (${percent}% of the page). Hide or shorten something before publishing.`
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
  /** Detail, note or marks changed on an item (V2). */
  detailChanges: Array<MenuDishRef & { from: string; to: string }>;
  /** Items hidden (86'd) or brought back. */
  visibilityChanges: Array<MenuDishRef & { visible: boolean }>;
  /** A dish that moved to a different section. */
  moved: Array<MenuDishRef & { from: string; to: string }>;
  /** Section-level changes in words: added, removed, renamed, placement, type, page, hidden. */
  sectionChanges: string[];
  footerChanges: string[];
  /** Title-block changes in words: subheading, when line, hero price, prices shown, page count (V2). */
  headerChanges: string[];
  /** The printed heading, when it changed ("" means the template's title). */
  headingChange: { from: string; to: string } | null;
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

/** Every price an item carries, as printed: "12" or "9 · 14 · 48" for a table row. */
function itemPriceText(item: MenuItemDocument): string {
  const columns = (item.prices ?? []).map((price) => (price === null ? '·' : formatMenuPrice(price)));
  const main = formatMenuPrice(item.priceCents, item.priceUnit);
  return [main, ...columns].filter(Boolean).join(' · ');
}

function itemDetailText(item: MenuItemDocument): string {
  return [item.meta ?? '', item.note ?? '', sortMenuItemFlags(item.flags ?? []).join(' ')].filter(Boolean).join(' | ');
}

export function diffMenuDocuments(before: MenuDocument | null, after: MenuDocument): MenuDiff {
  const diff: MenuDiff = {
    added: [],
    removed: [],
    priceChanges: [],
    tagChanges: [],
    renamed: [],
    descriptionChanges: [],
    detailChanges: [],
    visibilityChanges: [],
    moved: [],
    sectionChanges: [],
    footerChanges: [],
    headerChanges: [],
    headingChange: null
  };
  const prev = before ? flatten(before) : new Map<string, FlatItem>();
  const next = flatten(after);
  // Resolved after sections are matched, so a dish in a renamed section is not "moved".
  const pendingMoves: Array<{ ref: MenuDishRef; oldSection: MenuSectionDocument; newSection: MenuSectionDocument }> = [];

  for (const [key, item] of next) {
    const ref: MenuDishRef = { dishKey: key, name: item.name, section: item.section.title };
    const old = prev.get(key);
    if (!old) {
      diff.added.push(ref);
      continue;
    }
    const oldPrice = itemPriceText(old);
    const newPrice = itemPriceText(item);
    if (oldPrice !== newPrice) diff.priceChanges.push({ ...ref, from: oldPrice || '—', to: newPrice || '—' });
    const oldTags = formatMenuTags(old.tags);
    const newTags = formatMenuTags(item.tags);
    if (oldTags !== newTags) diff.tagChanges.push({ ...ref, from: oldTags || '—', to: newTags || '—' });
    if (old.name.trim() !== item.name.trim()) diff.renamed.push({ ...ref, from: old.name, to: item.name });
    if ((old.description ?? '') !== (item.description ?? '')) {
      diff.descriptionChanges.push({ ...ref, from: old.description ?? '—', to: item.description ?? '—' });
    }
    const oldDetail = itemDetailText(old);
    const newDetail = itemDetailText(item);
    if (oldDetail !== newDetail) diff.detailChanges.push({ ...ref, from: oldDetail || '—', to: newDetail || '—' });
    if (old.visible !== item.visible) diff.visibilityChanges.push({ ...ref, visible: item.visible });
    pendingMoves.push({ ref, oldSection: old.section, newSection: item.section });
  }
  for (const [key, item] of prev) {
    if (!next.has(key)) diff.removed.push({ dishKey: key, name: item.name, section: item.section.title });
  }

  // Sections: matched by id where both sides carry one, else by title, else
  // by the dishes they share (a published snapshot carries no row ids, so a
  // renamed section is still the same section if its dishes came along).
  const beforeSections = before?.sections ?? [];
  const byId = new Map(beforeSections.map((section, index) => [sectionKey(section, index), section]));
  const byTitle = new Map(beforeSections.map((section) => [section.title.trim().toLowerCase(), section]));
  const matched = new Set<MenuSectionDocument>();
  const sectionRenames = new Map<MenuSectionDocument, MenuSectionDocument>();
  const sharesDishes = (section: MenuSectionDocument): MenuSectionDocument | undefined => {
    const keys = new Set(section.items.map((item) => item.dishKey).filter(Boolean));
    if (keys.size === 0) return undefined;
    let best: MenuSectionDocument | undefined;
    let bestShared = 0;
    for (const candidate of beforeSections) {
      if (matched.has(candidate)) continue;
      const shared = candidate.items.filter((item) => item.dishKey && keys.has(item.dishKey)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = candidate;
      }
    }
    return bestShared * 2 > keys.size ? best : undefined;
  };
  after.sections.forEach((section, index) => {
    const old =
      (section.id ? byId.get(sectionKey(section, index)) : undefined) ??
      byTitle.get(section.title.trim().toLowerCase()) ??
      sharesDishes(section);
    if (!old || matched.has(old)) {
      if (before) diff.sectionChanges.push(`Added section ${describeSection(section)}.`);
      return;
    }
    matched.add(old);
    sectionRenames.set(old, section);
    if (old.title !== section.title) diff.sectionChanges.push(`Renamed section "${old.title}" to "${section.title}".`);
    if (old.placement !== section.placement) {
      diff.sectionChanges.push(`${section.title}: moved from ${MENU_PLACEMENT_LABELS[old.placement].toLowerCase()} to ${MENU_PLACEMENT_LABELS[section.placement].toLowerCase()}.`);
    }
    if ((old.page ?? 1) !== (section.page ?? 1)) diff.sectionChanges.push(`${section.title}: moved from page ${old.page ?? 1} to page ${section.page ?? 1}.`);
    if (old.sectionType !== section.sectionType) diff.sectionChanges.push(`${section.title}: type changed to ${section.sectionType.toLowerCase().replace('_', ' ')}.`);
    if ((old.headerSuffix ?? '') !== (section.headerSuffix ?? '')) {
      diff.sectionChanges.push(`${section.title}: heading suffix "${old.headerSuffix ?? '—'}" → "${section.headerSuffix ?? '—'}".`);
    }
    if ((old.subheading ?? '') !== (section.subheading ?? '')) {
      diff.sectionChanges.push(`${section.title}: subheading "${old.subheading ?? '—'}" → "${section.subheading ?? '—'}".`);
    }
    if ((old.lead ?? '') !== (section.lead ?? '')) diff.sectionChanges.push(`${section.title}: lead-in "${old.lead ?? '—'}" → "${section.lead ?? '—'}".`);
    if ((old.body ?? '') !== (section.body ?? '')) diff.sectionChanges.push(`${section.title}: text changed.`);
    if ((old.priceColumns ?? []).join('|') !== (section.priceColumns ?? []).join('|')) {
      diff.sectionChanges.push(`${section.title}: price columns "${(old.priceColumns ?? []).join(' · ') || '—'}" → "${(section.priceColumns ?? []).join(' · ') || '—'}".`);
    }
    if (old.visible !== section.visible) diff.sectionChanges.push(`${section.title}: ${section.visible ? 'shown again' : 'hidden from the print'}.`);
  });
  for (const old of beforeSections) {
    if (!matched.has(old)) diff.sectionChanges.push(`Removed section ${describeSection(old)}.`);
  }
  for (const move of pendingMoves) {
    const stillSame = move.oldSection === move.newSection || sectionRenames.get(move.oldSection) === move.newSection;
    if (!stillSame && move.oldSection.title.trim().toLowerCase() !== move.newSection.title.trim().toLowerCase()) {
      diff.moved.push({ ...move.ref, from: move.oldSection.title, to: move.newSection.title });
    }
  }

  if (before) {
    if ((before.heading ?? '') !== (after.heading ?? '')) diff.headingChange = { from: before.heading ?? '', to: after.heading ?? '' };
    if ((before.subheading ?? '') !== (after.subheading ?? '')) diff.headerChanges.push(`Subheading: "${before.subheading ?? ''}" → "${after.subheading ?? ''}".`);
    if ((before.whenLine ?? '') !== (after.whenLine ?? '')) diff.headerChanges.push(`When: "${before.whenLine ?? ''}" → "${after.whenLine ?? ''}".`);
    const oldHero = formatMenuPrice(before.heroPriceCents, before.heroPriceUnit);
    const newHero = formatMenuPrice(after.heroPriceCents, after.heroPriceUnit);
    if (oldHero !== newHero) diff.headerChanges.push(`Price: "${oldHero || '—'}" → "${newHero || '—'}".`);
    if ((before.showPrices ?? true) !== (after.showPrices ?? true)) diff.headerChanges.push(after.showPrices ?? true ? 'Prices shown again.' : 'Prices hidden.');
    if ((before.pageCount ?? 1) !== (after.pageCount ?? 1)) diff.headerChanges.push(`Pages: ${before.pageCount ?? 1} → ${after.pageCount ?? 1}.`);
    if (before.dietaryNote !== after.dietaryNote) diff.footerChanges.push(`Dietary note: "${before.dietaryNote}" → "${after.dietaryNote}".`);
    if (before.surchargeLine !== after.surchargeLine) diff.footerChanges.push(`Surcharge line: "${before.surchargeLine}" → "${after.surchargeLine}".`);
    if ((before.conditions ?? '') !== (after.conditions ?? '')) diff.footerChanges.push('Conditions changed.');
  }

  return diff;
}

/**
 * Whether two documents hold the same content, field by field. The publish
 * diff above is for people and reports only what prints; this compares
 * everything the editor stores, including the seafood flag, the recipe link,
 * a price unit without a price and the order of empty sections. Row ids and
 * key order are ignored. Missing V2 fields read as their defaults, so a v1
 * snapshot equals its own restored draft.
 */
export function menuDocumentsEqual(a: MenuDocument, b: MenuDocument): boolean {
  const canonical = (raw: MenuDocument) => {
    const doc = normaliseMenuDocument(raw);
    return JSON.stringify({
      heading: doc.heading,
      subheading: doc.subheading,
      whenLine: doc.whenLine,
      heroPriceCents: doc.heroPriceCents,
      heroPriceUnit: doc.heroPriceUnit,
      conditions: doc.conditions,
      showPrices: doc.showPrices,
      pageCount: doc.pageCount,
      dietaryNote: doc.dietaryNote,
      surchargeLine: doc.surchargeLine,
      sections: doc.sections.map((section) => [
        section.title,
        section.headerSuffix,
        section.subheading,
        section.sectionType,
        section.placement,
        section.page,
        section.lead,
        section.body,
        section.priceColumns,
        section.visible,
        section.items.map((item) => [
          item.dishKey ?? null,
          item.name,
          item.description,
          item.priceCents,
          item.priceUnit,
          item.prices,
          item.meta,
          item.note,
          item.flags,
          item.tags,
          item.isSeafood,
          item.visible,
          item.recipeId
        ])
      ])
    });
  };
  return canonical(a) === canonical(b);
}

export function menuDiffIsEmpty(diff: MenuDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.priceChanges.length === 0 &&
    diff.tagChanges.length === 0 &&
    diff.renamed.length === 0 &&
    diff.descriptionChanges.length === 0 &&
    (diff.detailChanges?.length ?? 0) === 0 &&
    diff.visibilityChanges.length === 0 &&
    diff.moved.length === 0 &&
    diff.sectionChanges.length === 0 &&
    diff.footerChanges.length === 0 &&
    (diff.headerChanges?.length ?? 0) === 0 &&
    diff.headingChange === null
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
  count(diff.detailChanges?.length ?? 0, 'detail change');
  const hidden = diff.visibilityChanges.filter((change) => !change.visible).length;
  const shown = diff.visibilityChanges.length - hidden;
  count(hidden, "dish 86'd", "dishes 86'd");
  count(shown, 'dish back on', 'dishes back on');
  count(diff.moved.length, 'dish moved', 'dishes moved');
  count(diff.sectionChanges.length, 'section change');
  count(diff.headerChanges?.length ?? 0, 'title block change');
  count(diff.footerChanges.length, 'footer change');
  if (diff.headingChange) parts.push('heading changed');
  return parts.length ? parts.join(', ') : 'No content changes';
}

// ---------------------------------------------------------------------------
// Dish keys and slugs
// ---------------------------------------------------------------------------

/**
 * A new dish's key: a readable slug of its name plus a short random suffix, so
 * two "Churros" at two venues never collide and a key survives a rename. Pure
 * so the editor can mint one when it duplicates a dish offline.
 */
/** "Pico de piña, avocado mousse" → "pico-de-pina-avocado-mousse". Accents folded, punctuation collapsed. */
export function dishKeySlug(name: string, max = 40): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

/** A menu's public slug from its name: "Happy hour" → "happy-hour". The server de-duplicates per venue. */
export function menuSlug(name: string): string {
  return dishKeySlug(name, 60) || 'menu';
}

export function newDishKey(name: string, random: () => number = Math.random): string {
  const slug = dishKeySlug(name);
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
  /** Pages the published PDF has (1 before V2). */
  pageCount: number;
};

export const MENU_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type MenuStatus = (typeof MENU_STATUSES)[number];

export type MenuEventDetails = {
  eventName: string | null;
  /** ISO date. */
  eventDate: string | null;
  organiserRef: string | null;
  guestCount: number | null;
};

/** The promotion a card belongs to. Its when-line, hero price and conditions are the promotion's. */
export type MenuPromotionLink = { id: string; name: string; status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ENDED' };

export type MenuSummary = {
  id: string;
  name: string;
  /** The immutable public identifier, unique per venue. */
  slug: string;
  kind: MenuKind;
  visibility: MenuVisibility;
  templateKey: string;
  /** Set when this menu is a promotion's card: the editor shows the promotion-owned fields read-only. */
  promotion: MenuPromotionLink | null;
  /** ARCHIVED menus are off the module home; their versions and PDFs stay. */
  status: MenuStatus;
  /** The italic title line as it prints: the live version's heading (the draft's when nothing is live), else the template's title. */
  printedHeading: string;
  venue: { id: string; name: string; slug: string };
  event: MenuEventDetails;
  published: MenuVersionSummary | null;
  draft: MenuVersionSummary | null;
  /** The newest write of any kind — publish or draft save. */
  lastEdited: { at: string; by: MenuActor } | null;
};

/** A venue as the "New menu" form sees it: which print templates it can use. */
export type MenuVenueSummary = {
  id: string;
  name: string;
  slug: string;
  templates: Array<{ key: string; label: string; title: string; kinds: MenuKind[]; format: string; multiPage: boolean }>;
};

/** GET /api/menus */
export type MenuListPayload = {
  menus: MenuSummary[];
  archived: MenuSummary[];
  venues: MenuVenueSummary[];
  renderer: { ok: boolean; message: string };
};

export type MenuHeader = Pick<MenuSummary, 'id' | 'name' | 'slug' | 'kind' | 'visibility' | 'templateKey' | 'venue' | 'promotion'>;

export type MenuDraftPayload = {
  menu: MenuHeader;
  version: MenuVersionSummary;
  document: MenuDocument;
  /** The document this draft is being compared against in the publish summary. */
  publishedDocument: MenuDocument | null;
  publishedVersion: MenuVersionSummary | null;
};

export type MenuVersionPayload = {
  menu: MenuHeader;
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

// ---------------------------------------------------------------------------
// Public read API (what the website receives) — published snapshots only
// ---------------------------------------------------------------------------

export type PublicMenuSummary = {
  slug: string;
  kind: MenuKind;
  name: string;
  heading: string;
  format: string;
  pageCount: number;
  publishedAt: string;
  /** Stable per publish: the website appends it as a cache-buster. */
  versionId: string;
  /** Absolute or API-relative URLs of the live PDF and JSON. */
  pdfUrl: string;
  jsonUrl: string;
};

export type PublicMenuDocument = PublicMenuSummary & {
  venue: { name: string; slug: string };
  document: MenuDocument;
};

/** Who may publish: managers, admins and the head chef. Mirrors the API's rule. */
export function canPublishMenus(user: {
  role?: string | null;
  isAdmin?: boolean | null;
  roleTitle?: string | null;
  accountType?: string | null;
  appAccess?: Array<{ appId: string; status: string; role: string; permissions?: unknown }> | null;
} | null | undefined): boolean {
  if (!user || user.accountType === 'VENUE_DEVICE') return false;
  if (user.isAdmin || user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  if ((user.roleTitle ?? '').toLowerCase().includes('head chef')) return true;
  return Boolean(
    user.appAccess?.some((access) => {
      if (access.appId !== 'MENUS' || access.status !== 'ENABLED') return false;
      if (access.role === 'MANAGER' || access.role === 'ADMIN') return true;
      // The one Staff-app toggle for this module: a USER-role grant with it ticked may publish.
      const permissions = access.permissions;
      return Boolean(permissions && typeof permissions === 'object' && (permissions as { menusPublish?: unknown }).menusPublish === true);
    })
  );
}

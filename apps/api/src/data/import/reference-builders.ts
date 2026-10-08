/**
 * Builders shared by the reference-menu import specs (the functions document,
 * the set-menu pack, the Tuesday card, the A5 cards). Every builder emits the
 * complete shape the zod schema produces — every field present, null where
 * nothing is printed, tags already in print order — so a spec's document
 * round-trips through `menuDocumentSchema.parse` unchanged and the importer
 * never has to normalise it.
 *
 * Dish keys are readable and stable: `<prefix>-<slug of the printed name>`,
 * scoped with `keyText` when the same name prints twice in one document (the
 * same package on two occasion rows, "Per person" in three tiers).
 */
import {
  dishKeySlug,
  MENU_DOCUMENT_DEFAULTS,
  type MenuDocument,
  type MenuItemDocument,
  type MenuItemFlag,
  type MenuPlacement,
  type MenuSectionDocument,
  type MenuSectionType,
  type MenuTagCode
} from '@alma/shared';

export type ItemInput = {
  name: string;
  /** Dollars as printed; omitted = no price printed. */
  price?: number;
  /** "pp" on packages and per-person add-ons. */
  unit?: string;
  description?: string;
  note?: string;
  /** Small grey qualifier after the name ("With a set menu", "on request"). */
  meta?: string;
  /** In MENU_TAGS print order. */
  tags?: MenuTagCode[];
  flags?: MenuItemFlag[];
  /** TABLE rows: dollars per column, null = not offered ("·"). */
  prices?: Array<number | null>;
  /** The seafood-origin rule applies (needs an A or I tag on food kinds). */
  seafood?: boolean;
  /** What the dish key is minted from when the printed name repeats in the document. */
  keyText?: string;
};

export type SectionInput = {
  page: number;
  title: string;
  type?: MenuSectionType;
  /** Only the A4 food sheet reads it; the paged families print every section full width. */
  placement?: MenuPlacement;
  headerSuffix?: string;
  subheading?: string;
  lead?: string;
  body?: string;
  priceColumns?: string[];
  items?: MenuItemDocument[];
};

export function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function makeReferenceBuilders(prefix: string) {
  function dishKey(text: string): string {
    return `${prefix}-${dishKeySlug(text, 60)}`;
  }

  function item(input: ItemInput): MenuItemDocument {
    return {
      dishKey: dishKey(input.keyText ?? input.name),
      name: input.name,
      description: input.description ?? null,
      priceCents: input.price === undefined ? null : cents(input.price),
      priceUnit: input.unit ?? null,
      prices: (input.prices ?? []).map((price) => (price === null ? null : cents(price))),
      meta: input.meta ?? null,
      note: input.note ?? null,
      flags: input.flags ?? [],
      tags: input.tags ?? [],
      isSeafood: input.seafood ?? false,
      visible: true,
      recipeId: null
    };
  }

  function section(input: SectionInput): MenuSectionDocument {
    return {
      title: input.title,
      headerSuffix: input.headerSuffix ?? null,
      subheading: input.subheading ?? null,
      sectionType: input.type ?? 'STANDARD',
      placement: input.placement ?? 'FULL',
      page: input.page,
      lead: input.lead ?? null,
      body: input.body ?? null,
      priceColumns: input.priceColumns ?? [],
      visible: true,
      items: input.items ?? []
    };
  }

  /** A prose block; blank lines separate paragraphs. Untitled when the source prints no head over it. */
  function text(page: number, body: string, title = '', headerSuffix?: string): MenuSectionDocument {
    return section({ page, title, type: 'TEXT', body, ...(headerSuffix ? { headerSuffix } : {}) });
  }

  /** The title block and footer, every field present, over the sections. */
  function document(fields: Partial<Omit<MenuDocument, 'sections'>> & { sections: MenuSectionDocument[] }): MenuDocument {
    return { ...MENU_DOCUMENT_DEFAULTS, ...fields };
  }

  return { dishKey, item, section, text, document };
}

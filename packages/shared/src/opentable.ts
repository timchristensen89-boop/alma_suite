import { z } from 'zod';
import type { MenuItemDocument, MenuKind, MenuSectionDocument, MenuSnapshot } from './menus.js';

/**
 * OpenTable free-API mapping — Menus API (publish + retrieve) and Profile
 * Content API (post). Pure: no I/O, no secrets, no database. Everything here
 * is derived from https://docs.opentable.com/ as read on 16 Oct 2026 and
 * written up in docs/opentable/02-api-capability-matrix.md. Where that
 * document says a value is unverified, the constant below says so too.
 *
 * Alma Suite is the source of truth. OpenTable receives a full copy of the
 * venue's PUBLISHED, PUBLIC menus on an explicit human action; nothing here
 * ever reads a draft.
 */

// ---------------------------------------------------------------------------
// Menus API payload (POST /v1/partnermenu/{partner}/location/{rid}/menus)
// ---------------------------------------------------------------------------

export type OpenTableRelation = { id: string; ordinal: number };

export type OpenTablePriceMetadata =
  | { priceType: 'PRICE'; minPrice: number; maxPrice: number; unit?: string }
  | { priceType: 'CUSTOM_PRICE_TEXT'; customPriceText: string }
  | { priceType: 'SIZE_PRICE' };

export type OpenTableItemMetadata = {
  enabled: boolean;
  tags?: string[];
  dietaryTags?: string[];
  allergens?: string[];
};

export type OpenTableMenuObject = {
  id: string;
  name: string;
  description?: string;
  type: 'DINE_IN';
  defaultCurrency: string;
  ordinal: number;
  updatedAt?: string;
  groups: OpenTableRelation[];
  footnote?: string;
  metadata: { enabled: boolean };
};

export type OpenTableGroup = {
  id: string;
  name: string;
  description?: string;
  items: OpenTableRelation[];
  metadata: { enabled: boolean };
};

export type OpenTableItem = {
  id: string;
  name: string;
  description?: string;
  priceMetadata?: OpenTablePriceMetadata;
  /** Required by the docs; always present, `[]` when the item has none. */
  modifierGroups: OpenTableRelation[];
  sizes?: OpenTableRelation[];
  metadata: OpenTableItemMetadata;
};

export type OpenTableItemSize = {
  id: string;
  name: string;
  priceMetadata: OpenTablePriceMetadata;
  metadata: { enabled: boolean };
};

/**
 * The documented envelope: one array element that holds every menu object
 * keyed by its id *beside* the shared entity maps. The docs show exactly one
 * menu; several menus share the maps (ids are globally unique). Confirmed to
 * be ambiguous in the capability matrix — the first production push checks
 * it with OpenTable.
 */
export type OpenTableMenusPayload = {
  menus: Array<
    Record<string, OpenTableMenuObject> & {
      groups: Record<string, OpenTableGroup>;
      items: Record<string, OpenTableItem>;
      itemSizes: Record<string, OpenTableItemSize>;
      modifierGroups: Record<string, never>;
      modifiers: Record<string, never>;
      preModifierGroups: Record<string, never>;
      preModifiers: Record<string, never>;
    }
  >;
};

/** What the API layer hands the builder for each candidate menu. */
export type OpenTableMenuSource = {
  slug: string;
  kind: MenuKind;
  name: string;
  status: string;
  visibility: string;
  /** The PUBLISHED version's frozen document; null when nothing is published. */
  snapshot: MenuSnapshot | null;
};

export type OpenTableIncludedMenu = {
  slug: string;
  kind: MenuKind;
  name: string;
  displayName: string;
  versionNumber: number;
  publishedAt: string | null;
  groups: number;
  items: number;
};

export type OpenTableExcludedMenu = { slug: string; name: string; reason: string };

export type OpenTableMenusBuild = {
  payload: OpenTableMenusPayload;
  included: OpenTableIncludedMenu[];
  excluded: OpenTableExcludedMenu[];
  /** Warnings that do not block publishing (e.g. items without a price). */
  warnings: string[];
};

export const OPENTABLE_MENU_KINDS: readonly MenuKind[] = ['FOOD', 'DRINKS', 'PROMOTION', 'FUNCTIONS'];

const KIND_ORDINAL: Record<MenuKind, number> = { FOOD: 100, DRINKS: 200, PROMOTION: 300, FUNCTIONS: 400, PRIVATE_EVENT: 900 };

/**
 * Alma dietary codes → OpenTable metadata. The docs say `dietaryTags` and
 * `allergens` are lists of strings and show only VEGETARIAN, VEGAN, HALAL,
 * KETO, PLANT_BASED and MILK, MUSTARD as examples. Everything marked
 * `verified: false` is our best reading of that convention and is kept in
 * this one table so it can change without touching the mapper.
 */
export const OPENTABLE_DIETARY_MAP: Readonly<
  Record<string, { dietaryTag?: string; allergen?: string; tag?: string; verified: boolean }>
> = {
  V: { dietaryTag: 'VEGETARIAN', verified: true },
  VG: { dietaryTag: 'VEGAN', verified: true },
  GF: { dietaryTag: 'GLUTEN_FREE', verified: false },
  GFA: { dietaryTag: 'GLUTEN_FREE_AVAILABLE', verified: false },
  DF: { dietaryTag: 'DAIRY_FREE', verified: false },
  N: { allergen: 'NUTS', verified: false },
  A: { tag: 'Australian', verified: true },
  I: { tag: 'Imported', verified: true }
};

export const OPENTABLE_FLAG_TAGS: Readonly<Record<string, string>> = {
  STAFF_PICK: 'Staff pick',
  LIMITED: 'Limited',
  NEW: 'New',
  ON_TAP: 'On tap'
};

export function openTableSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'x';
}

function joinText(parts: Array<string | null | undefined>, separator = ' · '): string | undefined {
  const text = parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(separator);
  return text ? text : undefined;
}

/** Cents → major units with two decimals, as a number (the API types prices as double). */
export function centsToOpenTablePrice(cents: number): number {
  return Math.round(cents) / 100;
}

function pricePair(cents: number, unit: string | null): OpenTablePriceMetadata {
  const amount = centsToOpenTablePrice(cents);
  const trimmed = (unit ?? '').trim();
  return trimmed ? { priceType: 'PRICE', minPrice: amount, maxPrice: amount, unit: trimmed } : { priceType: 'PRICE', minPrice: amount, maxPrice: amount };
}

function itemMetadata(item: MenuItemDocument): OpenTableItemMetadata {
  const tags: string[] = [];
  const dietary: string[] = [];
  const allergens: string[] = [];
  for (const code of item.tags ?? []) {
    const mapped = OPENTABLE_DIETARY_MAP[code];
    if (!mapped) continue;
    if (mapped.dietaryTag) dietary.push(mapped.dietaryTag);
    if (mapped.allergen) allergens.push(mapped.allergen);
    if (mapped.tag) tags.push(mapped.tag);
  }
  for (const flag of item.flags ?? []) {
    const label = OPENTABLE_FLAG_TAGS[flag];
    if (label) tags.push(label);
  }
  const metadata: OpenTableItemMetadata = { enabled: true };
  if (tags.length) metadata.tags = tags;
  if (dietary.length) metadata.dietaryTags = dietary;
  if (allergens.length) metadata.allergens = allergens;
  return metadata;
}

function sectionGroupName(section: MenuSectionDocument): string {
  const suffix = (section.headerSuffix ?? '').trim();
  return suffix ? `${section.title.trim()} / ${suffix}` : section.title.trim();
}

/**
 * Build the full-replace payload for one restaurant from its menus. Only
 * ACTIVE, PUBLIC menus of a publishable kind with a published snapshot are
 * sent; everything else is listed under `excluded` with the reason, so the
 * dashboard can say why a menu is not on OpenTable.
 */
export function buildOpenTableMenusPayload(sources: OpenTableMenuSource[], options: { currency?: string } = {}): OpenTableMenusBuild {
  const currency = options.currency ?? 'AUD';
  const element: OpenTableMenusPayload['menus'][number] = {
    groups: {},
    items: {},
    itemSizes: {},
    modifierGroups: {},
    modifiers: {},
    preModifierGroups: {},
    preModifiers: {}
  } as OpenTableMenusPayload['menus'][number];
  const included: OpenTableIncludedMenu[] = [];
  const excluded: OpenTableExcludedMenu[] = [];
  const warnings: string[] = [];

  const candidates = [...sources].sort((a, b) => KIND_ORDINAL[a.kind] - KIND_ORDINAL[b.kind] || a.slug.localeCompare(b.slug));
  let ordinal = 0;

  for (const source of candidates) {
    if (source.status !== 'ACTIVE') {
      excluded.push({ slug: source.slug, name: source.name, reason: 'archived' });
      continue;
    }
    if (source.visibility !== 'PUBLIC') {
      excluded.push({ slug: source.slug, name: source.name, reason: 'private menu' });
      continue;
    }
    if (!OPENTABLE_MENU_KINDS.includes(source.kind)) {
      excluded.push({ slug: source.slug, name: source.name, reason: `${source.kind.toLowerCase().replace('_', ' ')} menus are never sent` });
      continue;
    }
    const snapshot = source.snapshot;
    if (!snapshot) {
      excluded.push({ slug: source.slug, name: source.name, reason: 'nothing published yet' });
      continue;
    }

    ordinal += 1;
    const menuId = `alma-menu-${openTableSlug(source.slug)}`;
    const displayName = (snapshot.heading || source.name).trim() || source.name;
    const groupRefs: OpenTableRelation[] = [];
    let groupOrdinal = 0;
    let itemCount = 0;
    const seenGroupIds = new Set<string>();

    for (const section of snapshot.sections) {
      if (!section.visible) continue;
      if (section.sectionType === 'TEXT') continue;
      const visibleItems = section.items.filter((item) => item.visible && item.name.trim());
      if (!visibleItems.length) continue;
      groupOrdinal += 1;
      let groupId = `alma-group-${openTableSlug(source.slug)}-${openTableSlug(section.title)}`;
      if (seenGroupIds.has(groupId)) groupId = `${groupId}-${groupOrdinal}`;
      seenGroupIds.add(groupId);

      const itemRefs: OpenTableRelation[] = [];
      let itemOrdinal = 0;
      for (const item of visibleItems) {
        itemOrdinal += 1;
        itemCount += 1;
        const key = item.dishKey ? openTableSlug(item.dishKey) : `${groupOrdinal}-${itemOrdinal}-${openTableSlug(item.name)}`;
        const itemId = `alma-item-${openTableSlug(source.slug)}-${key}`;
        const entry: OpenTableItem = {
          id: itemId,
          name: item.name.trim(),
          modifierGroups: [],
          metadata: itemMetadata(item)
        };
        const description = joinText([item.description, item.meta, item.note]);
        if (description) entry.description = description;

        const priced = snapshot.showPrices && section.sectionType !== 'HEADER_PRICED' && section.sectionType !== 'LIST';
        if (priced && section.sectionType === 'TABLE' && section.priceColumns.length) {
          const sizeRefs: OpenTableRelation[] = [];
          section.priceColumns.forEach((column, index) => {
            const cents = item.prices?.[index];
            if (cents === null || cents === undefined || !Number.isFinite(cents)) return;
            const sizeId = `${itemId}-size-${index + 1}`;
            element.itemSizes[sizeId] = {
              id: sizeId,
              name: column.trim() || `Size ${index + 1}`,
              priceMetadata: pricePair(cents, null),
              metadata: { enabled: true }
            };
            sizeRefs.push({ id: sizeId, ordinal: sizeRefs.length + 1 });
          });
          if (sizeRefs.length) {
            entry.priceMetadata = { priceType: 'SIZE_PRICE' };
            entry.sizes = sizeRefs;
          } else {
            warnings.push(`${displayName} › ${section.title} › ${item.name}: no price in any column, sent without a price`);
          }
        } else if (priced && item.priceCents !== null && item.priceCents !== undefined && Number.isFinite(item.priceCents)) {
          entry.priceMetadata = pricePair(item.priceCents, item.priceUnit);
        } else if (priced && section.sectionType === 'STANDARD') {
          warnings.push(`${displayName} › ${section.title} › ${item.name}: no price, sent without a price`);
        }

        element.items[itemId] = entry;
        itemRefs.push({ id: itemId, ordinal: itemOrdinal });
      }

      const group: OpenTableGroup = { id: groupId, name: sectionGroupName(section), items: itemRefs, metadata: { enabled: true } };
      const groupDescription = joinText([section.subheading, section.lead]);
      if (groupDescription) group.description = groupDescription;
      element.groups[groupId] = group;
      groupRefs.push({ id: groupId, ordinal: groupOrdinal });
    }

    if (!groupRefs.length) {
      ordinal -= 1;
      excluded.push({ slug: source.slug, name: source.name, reason: 'published version has no visible items' });
      continue;
    }

    const menu: OpenTableMenuObject = {
      id: menuId,
      name: displayName,
      type: 'DINE_IN',
      defaultCurrency: currency,
      ordinal: KIND_ORDINAL[source.kind] + ordinal,
      groups: groupRefs,
      metadata: { enabled: true }
    };
    const description = joinText([snapshot.subheading, snapshot.whenLine], ' — ');
    if (description) menu.description = description;
    const footnote = joinText([snapshot.dietaryNote, snapshot.surchargeLine, snapshot.conditions], ' ');
    if (footnote) menu.footnote = footnote;
    if (snapshot.publishedAt) menu.updatedAt = snapshot.publishedAt;
    element[menuId] = menu;

    included.push({
      slug: source.slug,
      kind: source.kind,
      name: source.name,
      displayName,
      versionNumber: snapshot.versionNumber,
      publishedAt: snapshot.publishedAt,
      groups: groupRefs.length,
      items: itemCount
    });
  }

  return { payload: { menus: [element] }, included, excluded, warnings };
}

// ---------------------------------------------------------------------------
// Canonical JSON (for hashing) and payload diff
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = sortKeys(inner);
    }
    return out;
  }
  return value;
}

export type OpenTableMenusDiff = {
  menusAdded: string[];
  menusRemoved: string[];
  menusChanged: string[];
  items: Array<{ menu: string; group: string; item: string; change: 'added' | 'removed' | 'changed'; fields: string[] }>;
  unchanged: boolean;
};

type FlatItem = { menu: string; group: string; name: string; description: string; price: string; sizes: string; dietary: string };

function flattenPayload(payload: OpenTableMenusPayload | null | undefined): { menus: Map<string, string>; items: Map<string, FlatItem> } {
  const menus = new Map<string, string>();
  const items = new Map<string, FlatItem>();
  const element = payload?.menus?.[0];
  if (!element) return { menus, items };
  for (const [key, value] of Object.entries(element)) {
    if (['groups', 'items', 'itemSizes', 'modifierGroups', 'modifiers', 'preModifierGroups', 'preModifiers'].includes(key)) continue;
    const menu = value as OpenTableMenuObject;
    menus.set(menu.id, menu.name);
    for (const groupRef of menu.groups) {
      const group = element.groups[groupRef.id];
      if (!group) continue;
      for (const itemRef of group.items) {
        const item = element.items[itemRef.id];
        if (!item) continue;
        const sizes = (item.sizes ?? [])
          .map((ref) => element.itemSizes[ref.id])
          .filter((size): size is OpenTableItemSize => Boolean(size))
          .map((size) => `${size.name}=${priceText(size.priceMetadata)}`)
          .join(',');
        items.set(item.id, {
          menu: menu.name,
          group: group.name,
          name: item.name,
          description: item.description ?? '',
          price: priceText(item.priceMetadata),
          sizes,
          dietary: [...(item.metadata.dietaryTags ?? []), ...(item.metadata.allergens ?? []), ...(item.metadata.tags ?? [])].join(',')
        });
      }
    }
  }
  return { menus, items };
}

function priceText(price: OpenTablePriceMetadata | undefined): string {
  if (!price) return '';
  if (price.priceType === 'PRICE') return `${price.minPrice}${price.unit ? ` ${price.unit}` : ''}`;
  if (price.priceType === 'CUSTOM_PRICE_TEXT') return price.customPriceText;
  return 'sizes';
}

/** What changes between the last accepted payload and the next one. */
export function diffOpenTableMenus(previous: OpenTableMenusPayload | null | undefined, next: OpenTableMenusPayload): OpenTableMenusDiff {
  const before = flattenPayload(previous);
  const after = flattenPayload(next);
  const diff: OpenTableMenusDiff = { menusAdded: [], menusRemoved: [], menusChanged: [], items: [], unchanged: false };
  for (const [id, name] of after.menus) if (!before.menus.has(id)) diff.menusAdded.push(name);
  for (const [id, name] of before.menus) if (!after.menus.has(id)) diff.menusRemoved.push(name);
  const changedMenus = new Set<string>();
  for (const [id, item] of after.items) {
    const prior = before.items.get(id);
    if (!prior) {
      if (!diff.menusAdded.includes(item.menu)) diff.items.push({ menu: item.menu, group: item.group, item: item.name, change: 'added', fields: [] });
      changedMenus.add(item.menu);
      continue;
    }
    const fields = (['name', 'description', 'price', 'sizes', 'dietary', 'group'] as const).filter((field) => prior[field] !== item[field]);
    if (fields.length) {
      diff.items.push({ menu: item.menu, group: item.group, item: item.name, change: 'changed', fields: [...fields] });
      changedMenus.add(item.menu);
    }
  }
  for (const [id, item] of before.items) {
    if (!after.items.has(id)) {
      if (!diff.menusRemoved.includes(item.menu)) diff.items.push({ menu: item.menu, group: item.group, item: item.name, change: 'removed', fields: [] });
      changedMenus.add(item.menu);
    }
  }
  diff.menusChanged = [...changedMenus].filter((name) => !diff.menusAdded.includes(name) && !diff.menusRemoved.includes(name)).sort();
  diff.unchanged = !diff.menusAdded.length && !diff.menusRemoved.length && !diff.items.length;
  return diff;
}

// ---------------------------------------------------------------------------
// Remote comparison (GET /v1/menus/rid/{rid})
// ---------------------------------------------------------------------------

/** The documented GET response, loosely typed: the docs show only an example. */
export type OpenTableRemoteMenus = {
  rid?: number;
  restaurantMenuUrl?: string;
  menus?: Array<{
    menu: { id: string; name: string; description?: string; currency?: string; updatedAt?: string; ordinal?: number; groups?: string[] };
    groups?: Array<{ id: string; name: string; description?: string; ordinal?: number; items?: string[] }>;
    items?: Array<{ id: string; name: string; description?: string; ordinal?: number; price?: { amount?: number }; tags?: string[] }>;
  }>;
};

export type OpenTableRemoteComparison = {
  /** OpenTable serves a hosted web menu instead of native menus. */
  hostedMenuUrl: string | null;
  menusOnlyInAlma: string[];
  menusOnlyOnOpenTable: string[];
  itemsMissingOnOpenTable: Array<{ menu: string; group: string; item: string }>;
  itemsOnlyOnOpenTable: Array<{ menu: string; group: string; item: string }>;
  priceDifferences: Array<{ menu: string; item: string; alma: string; opentable: string }>;
  descriptionDifferences: Array<{ menu: string; item: string; alma: string; opentable: string }>;
  inSync: boolean;
};

const norm = (value: string | undefined | null) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Compare what Alma would send with what OpenTable returns. Matching is by
 * normalised menu + item name (OpenTable's ids are its own). Nothing here is
 * ever turned into a deletion.
 */
export function compareWithRemote(local: OpenTableMenusPayload, remote: OpenTableRemoteMenus | null | undefined): OpenTableRemoteComparison {
  const result: OpenTableRemoteComparison = {
    hostedMenuUrl: remote?.restaurantMenuUrl ?? null,
    menusOnlyInAlma: [],
    menusOnlyOnOpenTable: [],
    itemsMissingOnOpenTable: [],
    itemsOnlyOnOpenTable: [],
    priceDifferences: [],
    descriptionDifferences: [],
    inSync: false
  };
  const localFlat = flattenPayload(local);
  const localByMenu = new Map<string, Map<string, FlatItem>>();
  for (const item of localFlat.items.values()) {
    const bucket = localByMenu.get(norm(item.menu)) ?? new Map<string, FlatItem>();
    bucket.set(norm(item.name), item);
    localByMenu.set(norm(item.menu), bucket);
  }
  const remoteByMenu = new Map<string, { name: string; items: Map<string, { group: string; name: string; description: string; price: string }> }>();
  for (const entry of remote?.menus ?? []) {
    const items = new Map<string, { group: string; name: string; description: string; price: string }>();
    const groupById = new Map((entry.groups ?? []).map((group) => [group.id, group]));
    const groupOfItem = new Map<string, string>();
    for (const group of entry.groups ?? []) for (const id of group.items ?? []) groupOfItem.set(id, group.name);
    for (const item of entry.items ?? []) {
      items.set(norm(item.name), {
        group: groupOfItem.get(item.id) ?? '',
        name: item.name,
        description: item.description ?? '',
        price: item.price?.amount !== undefined && item.price?.amount !== null ? String(item.price.amount) : ''
      });
    }
    void groupById;
    remoteByMenu.set(norm(entry.menu.name), { name: entry.menu.name, items });
  }

  for (const [menuKey, localItems] of localByMenu) {
    const remoteMenu = remoteByMenu.get(menuKey);
    const menuName = localItems.values().next().value?.menu ?? menuKey;
    if (!remoteMenu) {
      result.menusOnlyInAlma.push(menuName);
      continue;
    }
    for (const [itemKey, item] of localItems) {
      const match = remoteMenu.items.get(itemKey);
      if (!match) {
        result.itemsMissingOnOpenTable.push({ menu: item.menu, group: item.group, item: item.name });
        continue;
      }
      const localPrice = item.price.split(' ')[0] ?? '';
      if (localPrice && match.price && Number(localPrice) !== Number(match.price)) {
        result.priceDifferences.push({ menu: item.menu, item: item.name, alma: item.price, opentable: match.price });
      }
      if (norm(item.description) !== norm(match.description)) {
        result.descriptionDifferences.push({ menu: item.menu, item: item.name, alma: item.description, opentable: match.description });
      }
    }
    for (const [itemKey, match] of remoteMenu.items) {
      if (!localItems.has(itemKey)) result.itemsOnlyOnOpenTable.push({ menu: remoteMenu.name, group: match.group, item: match.name });
    }
  }
  for (const [menuKey, remoteMenu] of remoteByMenu) if (!localByMenu.has(menuKey)) result.menusOnlyOnOpenTable.push(remoteMenu.name);

  result.inSync =
    !result.hostedMenuUrl &&
    !result.menusOnlyInAlma.length &&
    !result.menusOnlyOnOpenTable.length &&
    !result.itemsMissingOnOpenTable.length &&
    !result.itemsOnlyOnOpenTable.length &&
    !result.priceDifferences.length &&
    !result.descriptionDifferences.length;
  return result;
}

// ---------------------------------------------------------------------------
// Profile Content API (POST /v2/partnerrestaurants/rid/{rid})
// ---------------------------------------------------------------------------

export const OPENTABLE_DINING_STYLES = ['Fine Dining', 'Casual Dining', 'Home Style', 'Casual Elegant', 'Elegant Dining'] as const;
export const OPENTABLE_DRESS_CODES = ['Casual Dress', 'Jacket Required', 'Business Casual', 'Jacket and Tie Required', 'Formal Attire', 'Jacket Preferred', 'Smart Casual', 'Resort Casual'] as const;
export const OPENTABLE_PAYMENT_OPTIONS = ['AMEX', 'Cash Only', 'Discover', 'MasterCard', 'Carte Blanche', 'Cheque Gourmet', 'Eurocheque Card', 'Sodexo Pass', 'Cash not accepted', 'Diners Club', 'JCB', 'Visa'] as const;
export const OPENTABLE_BEVERAGES = ['Beer', 'Cocktails', 'Wine', 'BYO Liquor', 'Corkage Fee', 'BYO Wine', 'Full Bar'] as const;
export const OPENTABLE_DIETARY_OPTIONS = ['Gluten-free Options', 'Kosher', 'Vegan'] as const;
export const OPENTABLE_SMOKING_OPTIONS = ['Indoor Smoking Area', 'Non-Smoking', 'Outdoor Smoking Area'] as const;
export const OPENTABLE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type OpenTableDay = (typeof OPENTABLE_DAYS)[number];

/** The documented cuisine list (docs.opentable.com → Profile Content API → Cuisines), verbatim. */
export const OPENTABLE_CUISINES = [
  'Afghan', 'Afternoon Tea', 'Algerian', 'American', 'Andean', 'Argentinean', 'Asian', 'Australian', 'Austrian', 'Bar / Lounge / Bottle Service', 'Barbecue', 'Basque', 'Balkan Style', 'Beer Garden', 'Bistro', 'Bottle Service', 'Brazilian', 'Brazilian Steakhouse', 'British', 'Brewery', 'British / American', 'Bulgarian', 'Cajun', 'Cambodian', 'Catalan', 'Central Asian', 'Chinese', 'Chinese (Beijing)', 'Chinese (Canton)', 'Chinese (Shanghai)', 'Chinese (Sichuan)', 'Chinese (Taiwan)', 'Contemporary American', 'Contemporary Asian', 'Contemporary British', 'Contemporary Canadian', 'Contemporary European', 'Contemporary French', 'Contemporary French / American', 'Contemporary German', 'Contemporary Italian', 'Contemporary Japanese', 'Contemporary Korean', 'Contemporary Latin', 'Contemporary Mexican', 'Contemporary Southern', 'Contemporary Spanish', 'Contemporary Swedish', 'Contemporary Vegan', 'Continental', 'Creole', 'Creole / Cajun / Southern', 'Creative Japanese', 'Creative Western', 'Cuban', 'Czech', 'Danish', 'Deli', 'Dessert', 'Dim Sum', 'Distillery', 'Dutch', 'East Asian', 'Eastern European', 'Ecuadorian', 'Eritrean', 'Ethiopian', 'European', 'Farm-to-table', 'Filipino', 'Fine cuts', 'French', 'French / American', 'French / Canadian', 'French / Indian', 'French / Japanese', 'Fusion / Eclectic', 'Georgian', 'German', 'Global, International', 'Greek', 'Grill', 'Hawaiian', 'Halal', 'Hibachi', 'Home Cooking', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian / Malaysian', 'International', 'Irish', 'Israeli', 'Italian', 'Izakaya', 'Japanese', 'Japanese Speciality', 'Jugoslavian', 'Kappou', 'Kaiseki', 'Kosher', 'Korean', 'Laotian', 'Latin / Spanish', 'Lebanese', 'Low Country', 'Lounge', 'Mediterranean', 'Mexican', 'Mexican / Southwestern', 'Mexican (Baja Med)', 'Middle Eastern', 'Modern Australian', 'Modern European', 'Modern Tuscan', 'Moroccan', 'Native American', 'Nepali', 'New Zealand', 'Northwest', 'Northwest British', 'Northwest Germany', 'Okonomiyaki', 'Okinawan', 'Organic', 'Ottoman', 'Pacific Rim', 'Pakistani', 'Pan-Asian', 'Panamanian', 'Palestinian', 'Peruvian', 'Persian', 'Pizzeria', 'Polish', 'Prime Rib', 'Puerto Rican', 'Pub', 'Quality Dining', 'Quebec', 'Regional French', 'Regional Italian (Sardinia)', 'Regional Japanese', 'Regional Mexican', 'Regional Mexican (Baja Med)', 'Regional Spanish', 'Regional German (Berlin)', 'Russian', 'Ramen', 'Salads', 'Scandinavian', 'Seafood', 'Serbian', 'Sicilian', 'Soul Food', 'Southern', 'Southern British', 'Southern German', 'Southern Spain', 'Spanish', 'Speakeasy', 'Steak', 'Steakhouse', 'Sushi', 'Swiss', 'Tapas / Small Plates', 'Tempura', 'Teppanyaki', 'Tex-Mex', 'Traditional French', 'Traditional Mexican', 'Turkish', 'Unspecified', 'Uruguayan', 'Vegan', 'Vegetarian', 'Vietnamese', 'Wine Bar', 'Winery', 'Yakitori', 'Yakiniku', 'Yoshoku', 'Yum Cha'
] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const openingRange = z.object({ start: hhmm, end: hhmm });
const trimmed = (max: number) => z.string().trim().max(max);
const optionalTrimmed = (max: number) => trimmed(max).optional().or(z.literal('').transform(() => undefined));
const httpUrl = z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL');

/**
 * The Alma-side profile a venue keeps for OpenTable. Every enum is the
 * documented list; anything else is refused at save time so a publish never
 * sends a value OpenTable cannot accept.
 */
export const almaVenueProfileSchema = z.object({
  name: trimmed(120).min(1),
  description: optionalTrimmed(2000),
  primaryCuisine: z.enum(OPENTABLE_CUISINES).optional(),
  otherCuisines: z.array(z.enum(OPENTABLE_CUISINES)).max(5).default([]),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'International format, e.g. +61414379158')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  website: httpUrl.optional().or(z.literal('').transform(() => undefined)),
  locale: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default('en-AU'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('AUD'),
  timeZone: z.string().trim().min(1).default('Australia/Sydney'),
  priceBandId: z.number().int().min(1).max(4).optional(),
  diningStyle: z.enum(OPENTABLE_DINING_STYLES).optional(),
  dressCode: z.enum(OPENTABLE_DRESS_CODES).optional(),
  publicTransit: optionalTrimmed(1000),
  privateEventDetails: optionalTrimmed(350),
  cateringDetails: optionalTrimmed(350),
  executiveChef: optionalTrimmed(120),
  crossStreet: optionalTrimmed(120),
  menuUrl: httpUrl.optional().or(z.literal('').transform(() => undefined)),
  profileImageUrl: httpUrl.optional().or(z.literal('').transform(() => undefined)),
  imageUrls: z.array(httpUrl).max(30).default([]),
  tags: z.array(trimmed(40).min(1)).max(20).default([]),
  openingTimes: z.record(z.enum(OPENTABLE_DAYS), z.array(openingRange).max(3)).default({}),
  paymentOptions: z.array(z.enum(OPENTABLE_PAYMENT_OPTIONS)).default([]),
  beverages: z.array(z.enum(OPENTABLE_BEVERAGES)).default([]),
  dietaryOptions: z.array(z.enum(OPENTABLE_DIETARY_OPTIONS)).default([]),
  smokingOptions: z.array(z.enum(OPENTABLE_SMOKING_OPTIONS)).default([]),
  /** Shown in the docs' example only, not in its field table: held back unless explicitly managed. */
  location: z
    .object({
      street: trimmed(200).min(1),
      city: trimmed(80).min(1),
      province: trimmed(40).min(1),
      country: trimmed(40).min(1),
      latitude: z.string().trim().optional(),
      longitude: z.string().trim().optional(),
      neighborhoodName: trimmed(80).optional()
    })
    .optional()
});
export type AlmaVenueProfile = z.infer<typeof almaVenueProfileSchema>;

/** Every field the Profile Content API documents, with the label the dashboard shows. */
export const OPENTABLE_PROFILE_FIELDS = [
  { key: 'name', label: 'Restaurant name', documented: true },
  { key: 'description', label: 'Description', documented: true },
  { key: 'primaryCuisine', label: 'Primary cuisine', documented: true },
  { key: 'otherCuisines', label: 'Other cuisines', documented: true },
  { key: 'phone', label: 'Phone', documented: true },
  { key: 'website', label: 'Website', documented: true },
  { key: 'locale', label: 'Locale', documented: true },
  { key: 'currency', label: 'Currency', documented: true },
  { key: 'timeZone', label: 'Time zone (format unconfirmed)', documented: true },
  { key: 'priceBandId', label: 'Price band (1–4)', documented: true },
  { key: 'diningStyle', label: 'Dining style', documented: true },
  { key: 'dressCode', label: 'Dress code', documented: true },
  { key: 'publicTransit', label: 'Public transit', documented: true },
  { key: 'privateEventDetails', label: 'Private event details', documented: true },
  { key: 'cateringDetails', label: 'Catering details', documented: true },
  { key: 'executiveChef', label: 'Executive chef', documented: true },
  { key: 'crossStreet', label: 'Cross street', documented: true },
  { key: 'menuUrl', label: 'Menu URL', documented: true },
  { key: 'profileImageUrl', label: 'Profile image', documented: true },
  { key: 'imageUrls', label: 'Gallery images', documented: true },
  { key: 'tags', label: 'Tags', documented: true },
  { key: 'openingTimes', label: 'Opening times', documented: true },
  { key: 'paymentOptions', label: 'Payment options', documented: true },
  { key: 'beverages', label: 'Beverages', documented: true },
  { key: 'dietaryOptions', label: 'Dietary options', documented: true },
  { key: 'smokingOptions', label: 'Smoking options', documented: true },
  { key: 'location', label: 'Address (in the docs example only)', documented: false }
] as const;
export type OpenTableProfileFieldKey = (typeof OPENTABLE_PROFILE_FIELDS)[number]['key'];
export const OPENTABLE_PROFILE_FIELD_KEYS = OPENTABLE_PROFILE_FIELDS.map((field) => field.key) as OpenTableProfileFieldKey[];

/** The Profile Content API request body. Only managed fields are present. */
export type OpenTableProfilePayload = { id: string } & Record<string, unknown>;

export function buildOpenTableProfilePayload(profile: AlmaVenueProfile, managedFields: readonly string[], venueSlug: string): { payload: OpenTableProfilePayload; sentFields: string[]; skippedFields: string[] } {
  const managed = new Set(managedFields);
  const payload: OpenTableProfilePayload = { id: venueSlug };
  const sent: string[] = [];
  const skipped: string[] = [];
  // `key` is the Alma profile field (what managedFields names); `wireKey` is the
  // OpenTable attribute when the two differ (menuUrl → menu).
  const put = (key: string, value: unknown, wireKey: string = key) => {
    if (!managed.has(key)) {
      skipped.push(key);
      return;
    }
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === '') {
      // Managed but empty: the docs say an empty attribute clears the value on OpenTable. Send it explicitly.
      payload[wireKey] = Array.isArray(value) ? [] : '';
    } else {
      payload[wireKey] = value;
    }
    sent.push(key);
  };
  put('name', profile.name);
  put('description', profile.description);
  put('primaryCuisine', profile.primaryCuisine);
  put('otherCuisines', profile.otherCuisines);
  put('phone', profile.phone);
  put('website', profile.website);
  put('locale', profile.locale);
  put('currency', profile.currency);
  put('timeZone', profile.timeZone);
  put('priceBandId', profile.priceBandId);
  put('diningStyle', profile.diningStyle);
  put('dressCode', profile.dressCode);
  put('publicTransit', profile.publicTransit);
  put('privateEventDetails', profile.privateEventDetails);
  put('cateringDetails', profile.cateringDetails);
  put('executiveChef', profile.executiveChef);
  put('crossStreet', profile.crossStreet);
  put('menuUrl', profile.menuUrl, 'menu');
  if (managed.has('profileImageUrl')) {
    payload.profileImage = profile.profileImageUrl ? { url: profile.profileImageUrl } : {};
    sent.push('profileImageUrl');
  } else skipped.push('profileImageUrl');
  if (managed.has('imageUrls')) {
    payload.images = profile.imageUrls.map((url) => ({ url }));
    sent.push('imageUrls');
  } else skipped.push('imageUrls');
  put('tags', profile.tags);
  if (managed.has('openingTimes')) {
    const standard: Record<string, Array<{ start: string; end: string }>> = {};
    for (const day of OPENTABLE_DAYS) {
      const ranges = profile.openingTimes[day];
      if (ranges && ranges.length) standard[day.toUpperCase()] = ranges.map((range) => ({ start: range.start, end: range.end }));
    }
    payload.openingTimes = { standardOpeningTimes: standard };
    sent.push('openingTimes');
  } else skipped.push('openingTimes');
  put('paymentOptions', profile.paymentOptions);
  put('beverages', profile.beverages);
  put('dietaryOptions', profile.dietaryOptions);
  put('smokingOptions', profile.smokingOptions);
  if (managed.has('location') && profile.location) {
    const { street, city, province, country, latitude, longitude, neighborhoodName } = profile.location;
    const location: Record<string, unknown> = { address: { street, city, province, country } };
    if (latitude && longitude) location.coordinates = { latitude, longitude };
    if (neighborhoodName) location.neighborhoodName = neighborhoodName;
    payload.location = location;
    sent.push('location');
  } else skipped.push('location');
  return { payload, sentFields: sent, skippedFields: skipped };
}

/** Field-by-field comparison of the Alma profile with what OpenTable last received. */
export type OpenTableProfileComparison = Array<{
  key: string;
  label: string;
  managed: boolean;
  alma: string;
  lastSent: string | null;
  state: 'in_sync' | 'pending' | 'never_sent' | 'unmanaged';
}>;

export function compareOpenTableProfile(profile: AlmaVenueProfile, managedFields: readonly string[], lastSent: OpenTableProfilePayload | null): OpenTableProfileComparison {
  const next = buildOpenTableProfilePayload(profile, OPENTABLE_PROFILE_FIELD_KEYS, 'compare').payload;
  const managed = new Set(managedFields);
  const payloadKey = (key: string) => (key === 'menuUrl' ? 'menu' : key === 'profileImageUrl' ? 'profileImage' : key === 'imageUrls' ? 'images' : key);
  return OPENTABLE_PROFILE_FIELDS.map((field) => {
    const key = payloadKey(field.key);
    const almaValue = next[key];
    const sentValue = lastSent ? lastSent[key] : undefined;
    const alma = renderValue(almaValue);
    const sentText = sentValue === undefined ? null : renderValue(sentValue);
    let state: OpenTableProfileComparison[number]['state'];
    if (!managed.has(field.key)) state = 'unmanaged';
    else if (sentValue === undefined) state = 'never_sent';
    else state = canonicalJson(almaValue ?? '') === canonicalJson(sentValue ?? '') ? 'in_sync' : 'pending';
    return { key: field.key, label: field.label, managed: managed.has(field.key), alma, lastSent: sentText, state };
  });
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === 'object' && entry && 'url' in entry ? String((entry as { url: string }).url) : renderValue(entry))).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 0) return '';
    if ('standardOpeningTimes' in record) {
      const times = record.standardOpeningTimes as Record<string, Array<{ start: string; end: string }>>;
      return Object.entries(times)
        .map(([day, ranges]) => `${day.slice(0, 3)} ${ranges.map((range) => `${range.start}–${range.end}`).join(', ')}`)
        .join('; ');
    }
    if ('url' in record) return String(record.url);
    return canonicalJson(record);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Dashboard vocabulary
// ---------------------------------------------------------------------------

export const OPENTABLE_CAPABILITY_STATES = ['NOT_CONFIGURED', 'AWAITING_APPROVAL', 'CONNECTED', 'SYNCED', 'OUT_OF_DATE', 'ERROR'] as const;
export type OpenTableCapabilityState = (typeof OPENTABLE_CAPABILITY_STATES)[number];

export const OPENTABLE_SYNC_KINDS = ['MENUS', 'PROFILE', 'CONNECTION', 'READ'] as const;
export type OpenTableSyncKind = (typeof OPENTABLE_SYNC_KINDS)[number];
export const OPENTABLE_SYNC_STATUSES = ['PREPARED', 'SKIPPED', 'SUBMITTED', 'ACCEPTED', 'PARTIAL', 'FAILED'] as const;
export type OpenTableSyncStatus = (typeof OPENTABLE_SYNC_STATUSES)[number];

export const openTableVenueSettingsInputSchema = z.object({
  rid: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/, 'The OpenTable restaurant id is a number')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  enabled: z.boolean().optional(),
  menusEnabled: z.boolean().optional(),
  profileEnabled: z.boolean().optional()
});
export type OpenTableVenueSettingsInput = z.infer<typeof openTableVenueSettingsInputSchema>;

export const openTableProfileInputSchema = z.object({
  profile: almaVenueProfileSchema,
  managedFields: z.array(z.enum(OPENTABLE_PROFILE_FIELD_KEYS as [OpenTableProfileFieldKey, ...OpenTableProfileFieldKey[]])).default([])
});

export const openTableMenusPublishInputSchema = z.object({
  /** The payload hash the user previewed; publishing refuses when it no longer matches. */
  hash: z.string().trim().min(8),
  /** Menu display names the user has acknowledged will disappear from OpenTable. */
  confirmRemovals: z.array(z.string()).default([]),
  force: z.boolean().default(false)
});

export const openTableProfilePublishInputSchema = z.object({ hash: z.string().trim().min(8), force: z.boolean().default(false) });

// ---------------------------------------------------------------------------
// Dashboard payloads (API → admin-web). Booleans and masked values only: the
// browser never sees a client id, secret or token.
// ---------------------------------------------------------------------------

export type OpenTableRunSummary = {
  id: string;
  kind: OpenTableSyncKind;
  status: OpenTableSyncStatus;
  summary: string;
  payloadHash: string | null;
  requestKey: string | null;
  requestId: string | null;
  httpStatus: number | null;
  attempts: number;
  error: string | null;
  triggeredByName: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type OpenTableConnectionStatus = {
  state: OpenTableCapabilityState;
  detail: string;
  environment: 'preprod' | 'production';
  /** Which env values are present — names only. */
  configured: { clientId: boolean; clientSecret: boolean; partnerName: boolean; rid: boolean };
  flags: { api: boolean; menusWrite: boolean; menusRead: boolean; profileWrite: boolean };
  lastCheckAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
};

export type OpenTableMenusStatus = {
  state: OpenTableCapabilityState;
  detail: string;
  currentHash: string;
  lastAcceptedHash: string | null;
  lastAcceptedAt: string | null;
  lastRequestId: string | null;
  included: OpenTableIncludedMenu[];
  excluded: OpenTableExcludedMenu[];
  warnings: string[];
  /** Local payload vs the last ACCEPTED payload; null when nothing was ever accepted. */
  diff: OpenTableMenusDiff | null;
  /** Menu names that would disappear from OpenTable with the next publish. */
  removals: string[];
  /** What the GET endpoint last returned, compared with the current local payload. */
  remote: { readAt: string; comparison: OpenTableRemoteComparison } | null;
  /** The signed-in user may push this venue's menus (canPublishMenus for the venue). */
  canPublish: boolean;
};

export type OpenTableProfileStatus = {
  state: OpenTableCapabilityState;
  detail: string;
  profile: AlmaVenueProfile;
  managedFields: string[];
  currentHash: string;
  lastAcceptedHash: string | null;
  lastAcceptedAt: string | null;
  lastRequestId: string | null;
  comparison: OpenTableProfileComparison;
  /** Values the public website currently publishes, for the first fill. Read-only hints. */
  websiteHints: Partial<Record<string, string>>;
};

export type OpenTableVenueStatus = {
  venue: { id: string; name: string; slug: string };
  rid: string | null;
  enabled: boolean;
  menusEnabled: boolean;
  profileEnabled: boolean;
  connection: OpenTableConnectionStatus;
  menus: OpenTableMenusStatus;
  profile: OpenTableProfileStatus;
  activity: OpenTableRunSummary[];
  /** Links the operator needs when the API cannot do something. */
  links: { restaurantCentre: string; docs: string };
};

export type OpenTableOverview = {
  venues: Array<{ id: string; name: string; slug: string; rid: string | null; enabled: boolean }>;
  environment: 'preprod' | 'production';
  apiEnabled: boolean;
};

export type OpenTableMenusPreview = {
  hash: string;
  payload: OpenTableMenusPayload;
  included: OpenTableIncludedMenu[];
  excluded: OpenTableExcludedMenu[];
  warnings: string[];
  diff: OpenTableMenusDiff | null;
  removals: string[];
};

export type OpenTableProfilePreview = {
  hash: string;
  payload: OpenTableProfilePayload;
  sentFields: string[];
  skippedFields: string[];
};

export type OpenTablePublishResult = {
  run: OpenTableRunSummary;
  /** Plain-language outcome for the screen; never says "live on OpenTable". */
  message: string;
};
export type OpenTableMenusPublishInput = z.infer<typeof openTableMenusPublishInputSchema>;
export type OpenTableProfilePublishInput = z.infer<typeof openTableProfilePublishInputSchema>;

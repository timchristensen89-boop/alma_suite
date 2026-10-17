import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  almaVenueProfileSchema,
  buildOpenTableMenusPayload,
  buildOpenTableProfilePayload,
  canonicalJson,
  compareOpenTableProfile,
  compareWithRemote,
  diffOpenTableMenus,
  MENU_DOCUMENT_DEFAULTS,
  OPENTABLE_DIETARY_MAP,
  type MenuItemDocument,
  type MenuSectionDocument,
  type MenuSnapshot,
  type OpenTableMenuSource,
  type OpenTableMenusPayload,
  type OpenTableRemoteMenus,
  validateOpenTableMenusPayload
} from '@alma/shared';

/**
 * The Alma → OpenTable mapping, against documented shapes only
 * (docs/opentable/02-api-capability-matrix.md). No network, no database.
 */

function item(name: string, over: Partial<MenuItemDocument> = {}): MenuItemDocument {
  return {
    dishKey: `dk-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
    recipeId: null,
    ...over
  };
}

function section(title: string, items: MenuItemDocument[], over: Partial<MenuSectionDocument> = {}): MenuSectionDocument {
  return { title, headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, items, ...over };
}

function snapshot(venueSlug: string, menuSlug: string, sections: MenuSectionDocument[], over: Partial<MenuSnapshot> = {}): MenuSnapshot {
  return {
    ...MENU_DOCUMENT_DEFAULTS,
    schemaVersion: 2,
    menuId: `m-${menuSlug}`,
    menuName: menuSlug === 'food' ? 'Food' : menuSlug,
    templateKey: 'freshwater_alacarte',
    venue: { id: `v-${venueSlug}`, name: venueSlug, slug: venueSlug },
    versionNumber: 1,
    publishedAt: '2026-10-09T05:01:54.998Z',
    sections,
    ...over
  } as MenuSnapshot;
}

const stAlmaFood = (): OpenTableMenuSource => ({
  slug: 'food',
  kind: 'FOOD',
  name: 'Food',
  status: 'ACTIVE',
  visibility: 'PUBLIC',
  snapshot: snapshot('st-alma', 'food', [
    section('To start', [
      item('Guacamole', { priceCents: 1700, description: 'Salsa macha, tostadas', tags: ['VG', 'GFA', 'DF', 'N'] }),
      item('Kingfish ceviche', { priceCents: 3300, tags: ['GF', 'DF', 'A'], isSeafood: true, flags: ['STAFF_PICK'] }),
      item('Hidden dish', { priceCents: 100, visible: false })
    ]),
    section('Tacos', [item('Barramundi'), item('Beef birria')], { sectionType: 'HEADER_PRICED', headerSuffix: '9 each' }),
    section('Trust our chef', [item('Grazing', { priceCents: 4900, priceUnit: 'pp' })], { sectionType: 'SET_MENUS', subheading: 'For the whole table.' }),
    section('Notes', [], { sectionType: 'TEXT', body: 'Print-only prose' }),
    section('Empty', [item('Gone', { visible: false })]),
    section('Off', [item('Never')], { visible: false })
  ], { heading: 'À la carte', dietaryNote: 'Dietaries catered with notice.', surchargeLine: 'A surcharge of 10% applies on weekends.' })
});

const stAlmaDrinks = (): OpenTableMenuSource => ({
  slug: 'drinks',
  kind: 'DRINKS',
  name: 'Drinks',
  status: 'ACTIVE',
  visibility: 'PUBLIC',
  snapshot: snapshot('st-alma', 'drinks', [
    section('Wine by the glass', [
      item('Atlas Riesling', { prices: [1400, 6500], meta: '2024 · Eden Valley, SA' }),
      item('House Rosé', { prices: [1200, null] }),
      item('No price at all', { prices: [null, null] })
    ], { sectionType: 'TABLE', priceColumns: ['150 mL', 'Bottle'] })
  ], { heading: 'Drinks' })
});

describe('buildOpenTableMenusPayload', () => {
  it('sends only ACTIVE, PUBLIC, publishable menus with a published snapshot, and says why the rest are excluded', () => {
    const build = buildOpenTableMenusPayload([
      stAlmaFood(),
      { slug: 'party', kind: 'PRIVATE_EVENT', name: 'Smith wedding', status: 'ACTIVE', visibility: 'PRIVATE', snapshot: snapshot('st-alma', 'party', [section('A', [item('x')])]) },
      { slug: 'old', kind: 'FOOD', name: 'Old', status: 'ARCHIVED', visibility: 'PUBLIC', snapshot: snapshot('st-alma', 'old', [section('A', [item('x')])]) },
      { slug: 'tuesday', kind: 'FOOD', name: 'Tuesday', status: 'ACTIVE', visibility: 'PUBLIC', snapshot: null },
      { slug: 'secret', kind: 'FOOD', name: 'Secret', status: 'ACTIVE', visibility: 'PRIVATE', snapshot: snapshot('st-alma', 'secret', [section('A', [item('x')])]) }
    ]);
    assert.deepEqual(build.included.map((menu) => menu.slug), ['food']);
    assert.deepEqual(
      build.excluded.map((menu) => `${menu.slug}:${menu.reason}`).sort(),
      ['old:archived', 'party:private menu', 'secret:private menu', 'tuesday:nothing published yet']
    );
    const element = build.payload.menus[0]!;
    assert.equal(Object.keys(element).filter((key) => key.startsWith('alma-menu-')).length, 1);
  });

  it('maps a menu to the documented envelope: groups, items, prices, dietary metadata, footnote', () => {
    const build = buildOpenTableMenusPayload([stAlmaFood()]);
    const element = build.payload.menus[0]!;
    const menu = element['alma-menu-food']!;
    assert.equal(menu.name, 'À la carte');
    assert.equal(menu.type, 'DINE_IN');
    assert.equal(menu.defaultCurrency, 'AUD');
    assert.equal(menu.footnote, 'Dietaries catered with notice. A surcharge of 10% applies on weekends.');
    assert.equal(menu.updatedAt, '2026-10-09T05:01:54.998Z');
    // TEXT, empty and hidden sections are not groups.
    assert.deepEqual(menu.groups.map((ref) => element.groups[ref.id]!.name), ['To start', 'Tacos / 9 each', 'Trust our chef']);
    assert.deepEqual(menu.groups.map((ref) => ref.ordinal), [1, 2, 3]);

    const guac = element.items['alma-item-food-dk-guacamole']!;
    assert.deepEqual(guac.priceMetadata, { priceType: 'PRICE', minPrice: 17, maxPrice: 17 });
    assert.equal(guac.description, 'Salsa macha, tostadas');
    assert.deepEqual(guac.modifierGroups, []);
    assert.deepEqual(guac.metadata.dietaryTags, ['VEGAN', 'GLUTEN_FREE_AVAILABLE', 'DAIRY_FREE']);
    assert.deepEqual(guac.metadata.allergens, ['NUTS']);
    assert.equal(guac.metadata.tags, undefined);

    const ceviche = element.items['alma-item-food-dk-kingfish-ceviche']!;
    assert.deepEqual(ceviche.metadata.tags, ['Australian', 'Staff pick']);
    assert.ok(!('isSeafood' in ceviche), 'isSeafood is not an OpenTable field');
    assert.equal(element.items['alma-item-food-dk-hidden-dish'], undefined, '86d items are not sent');

    // HEADER_PRICED rows carry no price: the group name has the suffix.
    assert.equal(element.items['alma-item-food-dk-barramundi']!.priceMetadata, undefined);
    // Set menus keep their unit.
    assert.deepEqual(element.items['alma-item-food-dk-grazing']!.priceMetadata, { priceType: 'PRICE', minPrice: 49, maxPrice: 49, unit: 'pp' });
    assert.equal(element.groups['alma-group-food-trust-our-chef']!.description, 'For the whole table.');
    assert.equal(build.warnings.length, 0);
  });

  it('turns TABLE price columns into item sizes and omits null columns', () => {
    const build = buildOpenTableMenusPayload([stAlmaDrinks()]);
    const element = build.payload.menus[0]!;
    const riesling = element.items['alma-item-drinks-dk-atlas-riesling']!;
    assert.deepEqual(riesling.priceMetadata, { priceType: 'SIZE_PRICE' });
    assert.deepEqual(riesling.sizes, [
      { id: 'alma-item-drinks-dk-atlas-riesling-size-1', ordinal: 1 },
      { id: 'alma-item-drinks-dk-atlas-riesling-size-2', ordinal: 2 }
    ]);
    assert.deepEqual(element.itemSizes['alma-item-drinks-dk-atlas-riesling-size-2'], {
      id: 'alma-item-drinks-dk-atlas-riesling-size-2',
      name: 'Bottle',
      priceMetadata: { priceType: 'PRICE', minPrice: 65, maxPrice: 65 },
      metadata: { enabled: true }
    });
    assert.equal(riesling.description, '2024 · Eden Valley, SA');
    const rose = element.items['alma-item-drinks-dk-house-ros']!;
    assert.equal(rose.sizes!.length, 1, 'a null column is not a size');
    const none = element.items['alma-item-drinks-dk-no-price-at-all']!;
    assert.equal(none.priceMetadata, undefined);
    assert.equal(none.sizes, undefined);
    assert.match(build.warnings.join('\n'), /No price at all: no price in any column/);
  });

  it('never sends prices when the version hides them, and orders menus by kind', () => {
    const hidden = stAlmaFood();
    hidden.snapshot = { ...hidden.snapshot!, showPrices: false };
    const build = buildOpenTableMenusPayload([stAlmaDrinks(), hidden]);
    const element = build.payload.menus[0]!;
    for (const entry of Object.values(element.items)) {
      if (entry.id.startsWith('alma-item-food-')) assert.equal(entry.priceMetadata, undefined, entry.id);
    }
    assert.deepEqual(build.included.map((menu) => menu.kind), ['FOOD', 'DRINKS']);
    assert.ok(element['alma-menu-food']!.ordinal < element['alma-menu-drinks']!.ordinal);
  });

  it('produces the same bytes for the same input (hashable) and different bytes for a price change', () => {
    const a = canonicalJson(buildOpenTableMenusPayload([stAlmaFood()]).payload);
    const b = canonicalJson(buildOpenTableMenusPayload([stAlmaFood()]).payload);
    assert.equal(a, b);
    const changed = stAlmaFood();
    changed.snapshot!.sections[0]!.items[0]!.priceCents = 1800;
    assert.notEqual(canonicalJson(buildOpenTableMenusPayload([changed]).payload), a);
  });

  it('documents which dietary mappings are unverified', () => {
    assert.equal(OPENTABLE_DIETARY_MAP.V!.verified, true);
    assert.equal(OPENTABLE_DIETARY_MAP.GF!.verified, false);
  });
});

describe('diffOpenTableMenus', () => {
  it('reports added, removed and changed items with the fields that moved, and removed menus', () => {
    const before = buildOpenTableMenusPayload([stAlmaFood(), stAlmaDrinks()]).payload;
    const next = stAlmaFood();
    next.snapshot!.sections[0]!.items[0]!.priceCents = 1800; // Guacamole 17 → 18
    next.snapshot!.sections[0]!.items.push(item('Prawn tostada', { priceCents: 2300 }));
    next.snapshot!.sections[2]!.items = []; // Trust our chef disappears
    const after = buildOpenTableMenusPayload([next]).payload; // drinks menu gone
    const diff = diffOpenTableMenus(before, after);
    assert.deepEqual(diff.menusRemoved, ['Drinks']);
    assert.deepEqual(diff.menusAdded, []);
    assert.deepEqual(diff.menusChanged, ['À la carte']);
    assert.ok(diff.items.some((entry) => entry.item === 'Guacamole' && entry.change === 'changed' && entry.fields.includes('price')));
    assert.ok(diff.items.some((entry) => entry.item === 'Prawn tostada' && entry.change === 'added'));
    assert.ok(diff.items.some((entry) => entry.item === 'Grazing' && entry.change === 'removed'));
    assert.ok(!diff.items.some((entry) => entry.menu === 'Drinks'), 'items of a removed menu are summarised by the menu, not listed');
    assert.equal(diff.unchanged, false);
    assert.equal(diffOpenTableMenus(before, before).unchanged, true);
    assert.deepEqual(diffOpenTableMenus(null, after).menusAdded, ['À la carte']);
  });
});

describe('compareWithRemote', () => {
  const local = buildOpenTableMenusPayload([stAlmaFood()]).payload;
  const remote: OpenTableRemoteMenus = {
    rid: 211307,
    menus: [
      {
        menu: { id: 'r1', name: 'À la carte', groups: ['g1', 'g2'] },
        groups: [
          { id: 'g1', name: 'To start', items: ['i1', 'i2', 'i9'] },
          { id: 'g2', name: 'Tacos / 9 each', items: ['i3'] }
        ],
        items: [
          { id: 'i1', name: 'Guacamole', description: 'Salsa macha, tostadas', price: { amount: 16 } },
          { id: 'i2', name: 'Kingfish Ceviche', description: 'Old wording', price: { amount: 33 } },
          { id: 'i9', name: 'Octopus', price: { amount: 39 } },
          { id: 'i3', name: 'Barramundi' }
        ]
      },
      { menu: { id: 'r2', name: 'Cocktails', groups: [] }, groups: [], items: [] }
    ]
  };

  it('matches by name, reports price and description drift, and never treats partial data as a deletion', () => {
    const result = compareWithRemote(local, remote);
    assert.equal(result.hostedMenuUrl, null);
    assert.deepEqual(result.menusOnlyOnOpenTable, ['Cocktails']);
    assert.deepEqual(result.menusOnlyInAlma, []);
    assert.deepEqual(result.priceDifferences, [{ menu: 'À la carte', item: 'Guacamole', alma: '17', opentable: '16' }]);
    assert.deepEqual(result.descriptionDifferences.map((entry) => entry.item), ['Kingfish ceviche']);
    assert.deepEqual(result.itemsMissingOnOpenTable.map((entry) => entry.item), ['Beef birria', 'Grazing']);
    assert.deepEqual(result.itemsOnlyOnOpenTable.map((entry) => entry.item), ['Octopus']);
    assert.equal(result.inSync, false);
    assert.ok(!JSON.stringify(result).includes('delete'));
  });

  it('flags a hosted web menu and an empty response', () => {
    assert.equal(compareWithRemote(local, { restaurantMenuUrl: 'https://example.com/menu.pdf', menus: [] }).hostedMenuUrl, 'https://example.com/menu.pdf');
    const empty = compareWithRemote(local, null);
    assert.deepEqual(empty.menusOnlyInAlma, ['À la carte']);
    assert.equal(empty.inSync, false);
  });
});

describe('profile mapping', () => {
  const profile = almaVenueProfileSchema.parse({
    name: 'St Alma',
    description: 'Mexican-inspired restaurant and bar in Freshwater.',
    primaryCuisine: 'Mexican',
    otherCuisines: ['Modern Australian'],
    phone: '+61405901794',
    website: 'https://almagroup.com.au/st-alma',
    priceBandId: 3,
    diningStyle: 'Casual Dining',
    dressCode: 'Smart Casual',
    menuUrl: 'https://api.almagroup.com.au/api/public/menus/st-alma/food.pdf',
    profileImageUrl: 'https://almagroup.com.au/images/st-alma-interior.jpg',
    imageUrls: ['https://almagroup.com.au/images/st-alma-hero.jpg'],
    tags: ['Margaritas'],
    openingTimes: { tuesday: [{ start: '17:00', end: '22:00' }], friday: [{ start: '12:00', end: '22:00' }] },
    paymentOptions: ['Visa', 'MasterCard', 'AMEX'],
    beverages: ['Cocktails', 'Wine', 'Full Bar'],
    dietaryOptions: ['Gluten-free Options', 'Vegan'],
    location: { street: '20 Albert Street', city: 'Freshwater', province: 'NSW', country: 'AU' }
  });

  it('refuses values outside the documented lists and bad phone numbers', () => {
    assert.throws(() => almaVenueProfileSchema.parse({ name: 'X', diningStyle: 'Relaxed' }));
    assert.throws(() => almaVenueProfileSchema.parse({ name: 'X', primaryCuisine: 'Tex Mex' }));
    assert.throws(() => almaVenueProfileSchema.parse({ name: 'X', phone: '0405 901 794' }));
    assert.throws(() => almaVenueProfileSchema.parse({ name: 'X', openingTimes: { monday: [{ start: '9:00', end: '17:00' }] } }));
    assert.throws(() => almaVenueProfileSchema.parse({ name: 'X', privateEventDetails: 'x'.repeat(351) }));
  });

  it('sends only managed fields, in the documented shapes, and holds back location unless managed', () => {
    const built = buildOpenTableProfilePayload(profile, ['name', 'phone', 'openingTimes', 'profileImageUrl', 'imageUrls', 'menuUrl'], 'st-alma');
    assert.equal(built.payload.id, 'st-alma');
    assert.equal(built.payload.name, 'St Alma');
    assert.equal(built.payload.phone, '+61405901794');
    assert.deepEqual(built.payload.openingTimes, { standardOpeningTimes: { TUESDAY: [{ start: '17:00', end: '22:00' }], FRIDAY: [{ start: '12:00', end: '22:00' }] } });
    assert.deepEqual(built.payload.profileImage, { url: 'https://almagroup.com.au/images/st-alma-interior.jpg' });
    assert.deepEqual(built.payload.images, [{ url: 'https://almagroup.com.au/images/st-alma-hero.jpg' }]);
    assert.equal(built.payload.menu, 'https://api.almagroup.com.au/api/public/menus/st-alma/food.pdf');
    assert.equal('description' in built.payload, false, 'unmanaged fields are never sent');
    assert.equal('location' in built.payload, false);
    assert.ok(built.skippedFields.includes('location'));
  });

  it('clears a managed field that is empty, as the docs describe', () => {
    const cleared = almaVenueProfileSchema.parse({ name: 'St Alma', executiveChef: '' });
    const built = buildOpenTableProfilePayload(cleared, ['executiveChef', 'tags'], 'st-alma');
    assert.equal(built.payload.executiveChef, '');
    assert.deepEqual(built.payload.tags, []);
  });

  it('compares field by field against what was last sent', () => {
    const lastSent = buildOpenTableProfilePayload(profile, ['name', 'phone'], 'st-alma').payload;
    const changed = { ...profile, phone: '+61400000000' };
    const rows = compareOpenTableProfile(changed, ['name', 'phone', 'description'], lastSent);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.name!.state, 'in_sync');
    assert.equal(byKey.phone!.state, 'pending');
    assert.equal(byKey.phone!.lastSent, '+61405901794');
    assert.equal(byKey.description!.state, 'never_sent');
    assert.equal(byKey.dressCode!.state, 'unmanaged');
    assert.equal(byKey.openingTimes!.alma, 'TUE 17:00–22:00; FRI 12:00–22:00');
  });
});

describe('validateOpenTableMenusPayload', () => {
  it('passes a built payload and catches dangling relations, empty menus and bad prices', () => {
    const good = buildOpenTableMenusPayload([stAlmaFood(), stAlmaDrinks()]).payload;
    assert.deepEqual(validateOpenTableMenusPayload(good), []);

    const broken: OpenTableMenusPayload = JSON.parse(JSON.stringify(good));
    const element = broken.menus[0]!;
    delete element.items['alma-item-food-dk-guacamole'];
    (element.items['alma-item-food-dk-kingfish-ceviche']!.priceMetadata as { minPrice: number }).minPrice = -1;
    element['alma-menu-drinks']!.groups = [];
    const errors = validateOpenTableMenusPayload(broken);
    assert.ok(errors.some((error) => /alma-item-food-dk-guacamole is referenced but not defined/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /Kingfish ceviche: price -1/.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /Drinks: menu has no groups/.test(error)), errors.join('\n'));
    assert.deepEqual(validateOpenTableMenusPayload({ menus: [] } as unknown as OpenTableMenusPayload), ['The payload holds no menus.']);
  });
});

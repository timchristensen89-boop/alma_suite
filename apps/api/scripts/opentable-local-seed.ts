// Local-only seed for the OpenTable dashboard screenshots. Not for production.
// Creates two venues, an admin, an Avalon-limited publisher, and published menu
// versions written directly as snapshots (no PDF render needed).
//   DATABASE_URL=postgresql://…/alma_opentable_dev npx tsx scripts/opentable-local-seed.ts
import bcrypt from 'bcryptjs';
import { prisma } from '@alma/db';
import { MENU_DOCUMENT_DEFAULTS } from '@alma/shared';

const PASSWORD = 'opentable-dev-2026';

type Item = { dishKey: string; name: string; description?: string | null; priceCents?: number | null; priceUnit?: string | null; prices?: Array<number | null>; meta?: string | null; tags?: string[]; flags?: string[]; isSeafood?: boolean; visible?: boolean };
type Section = { title: string; sectionType?: string; headerSuffix?: string | null; subheading?: string | null; priceColumns?: string[]; items: Item[]; visible?: boolean };

function item(entry: Item) {
  return { description: null, priceCents: null, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: [], isSeafood: false, visible: true, recipeId: null, ...entry };
}
function section(entry: Section) {
  return { headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, ...entry, items: entry.items.map(item) };
}

async function publishedMenu(venue: { id: string; name: string; slug: string }, spec: { name: string; slug: string; kind: string; visibility?: string; status?: string; templateKey?: string; heading?: string; sections: Section[]; extra?: Record<string, unknown>; draftOnly?: boolean }) {
  const menu = await prisma.menu.upsert({
    where: { venueId_slug: { venueId: venue.id, slug: spec.slug } },
    update: {},
    create: { venueId: venue.id, name: spec.name, slug: spec.slug, kind: spec.kind, visibility: spec.visibility ?? 'PUBLIC', status: spec.status ?? 'ACTIVE', templateKey: spec.templateKey ?? 'freshwater_alacarte', versionCounter: 1 }
  });
  const existing = await prisma.menuVersion.findFirst({ where: { menuId: menu.id } });
  if (existing) return menu;
  if (spec.draftOnly) {
    await prisma.menuVersion.create({ data: { menuId: menu.id, versionNumber: 1, state: 'DRAFT' } });
    return menu;
  }
  const publishedAt = new Date('2026-10-09T05:01:54.998Z');
  await prisma.menuVersion.create({
    data: {
      menuId: menu.id,
      versionNumber: 1,
      state: 'PUBLISHED',
      publishedAt,
      publishedByName: 'Tim Christensen',
      heading: spec.heading ?? '',
      snapshotJson: {
        ...MENU_DOCUMENT_DEFAULTS,
        schemaVersion: 2,
        menuId: menu.id,
        menuName: spec.name,
        templateKey: spec.templateKey ?? 'freshwater_alacarte',
        venue,
        versionNumber: 1,
        publishedAt: publishedAt.toISOString(),
        heading: spec.heading ?? '',
        dietaryNote: 'Please let us know of any dietary requirements.',
        surchargeLine: 'A 10% surcharge applies on Sundays and public holidays.',
        ...(spec.extra ?? {}),
        sections: spec.sections.map(section)
      }
    }
  });
  return menu;
}

async function main() {
  const stAlma = await prisma.venue.upsert({ where: { slug: 'st-alma' }, update: {}, create: { name: 'St Alma', slug: 'st-alma', address: '20 Albert Street, Freshwater NSW 2096' } });
  const avalon = await prisma.venue.upsert({ where: { slug: 'alma-avalon' }, update: {}, create: { name: 'Alma Avalon', slug: 'alma-avalon', address: '1/8 Old Barrenjoey Road, Avalon Beach NSW 2107' } });
  const hash = await bcrypt.hash(PASSWORD, 10);

  await prisma.staffProfile.upsert({
    where: { email: 'admin@alma.local' },
    update: { passwordHash: hash },
    create: { firstName: 'Tim', lastName: 'Christensen', roleTitle: 'Owner', email: 'admin@alma.local', passwordHash: hash, isAdmin: true, appAccess: { create: [{ appId: 'SETTINGS', status: 'ENABLED', role: 'ADMIN' }, { appId: 'MENUS', status: 'ENABLED', role: 'ADMIN' }] } }
  });
  await prisma.staffProfile.upsert({
    where: { email: 'trystan@alma.local' },
    update: { passwordHash: hash },
    create: {
      firstName: 'Trystan',
      lastName: 'Avalon',
      roleTitle: 'Venue Manager',
      email: 'trystan@alma.local',
      passwordHash: hash,
      venue: 'Alma Avalon',
      appAccess: { create: [{ appId: 'SETTINGS', status: 'ENABLED', role: 'ADMIN' }, { appId: 'MENUS', status: 'ENABLED', role: 'MANAGER', permissions: { menusPublish: true, menusVenueAlmaAvalon: true } }] }
    }
  });

  await publishedMenu(stAlma, {
    name: 'Food',
    slug: 'food',
    kind: 'FOOD',
    heading: 'À la carte',
    sections: [
      { title: 'To start', items: [
        { dishKey: 'guacamole', name: 'Guacamole', description: 'Salsa macha, tostadas', priceCents: 1700, tags: ['VG', 'GFA', 'N'] },
        { dishKey: 'kingfish-ceviche', name: 'Kingfish ceviche', description: 'Leche de tigre, sweet potato, coriander', priceCents: 3300, tags: ['GF', 'DF', 'A'], isSeafood: true, flags: ['STAFF_PICK'] },
        { dishKey: 'prawn-tostada', name: 'Prawn tostada', description: 'Chipotle mayo, pickled onion', priceCents: 2300, isSeafood: true }
      ] },
      { title: 'Tacos', sectionType: 'HEADER_PRICED', headerSuffix: '9 each', items: [
        { dishKey: 'barramundi-taco', name: 'Barramundi', description: 'Pico de gallo, lime crema', isSeafood: true },
        { dishKey: 'beef-birria', name: 'Beef birria', description: 'Consommé, onion, coriander' },
        { dishKey: 'mushroom-taco', name: 'Mushroom al pastor', description: 'Pineapple, salsa verde', tags: ['VG'] }
      ] },
      { title: 'Trust our chef', sectionType: 'SET_MENUS', subheading: 'For the whole table.', items: [
        { dishKey: 'grazing', name: 'Grazing', description: 'Five courses', priceCents: 4900, priceUnit: 'pp' },
        { dishKey: 'feasting', name: 'Feasting', description: 'Seven courses', priceCents: 7900, priceUnit: 'pp' }
      ] }
    ]
  });
  await publishedMenu(stAlma, {
    name: 'Drinks',
    slug: 'drinks',
    kind: 'DRINKS',
    heading: 'Drinks',
    templateKey: 'drinks_binder',
    sections: [
      { title: 'Wine by the glass', sectionType: 'TABLE', priceColumns: ['150 mL', 'Bottle'], items: [
        { dishKey: 'atlas-riesling', name: 'Atlas Riesling', meta: '2024 · Eden Valley, SA', prices: [1400, 6500], tags: ['A'] },
        { dishKey: 'house-rose', name: 'House Rosé', meta: '2024 · Provence, France', prices: [1300, 6000], tags: ['I'] }
      ] },
      { title: 'Margaritas', items: [
        { dishKey: 'classic-margarita', name: 'Classic margarita', description: 'Blanco, lime, agave', priceCents: 2200, flags: ['STAFF_PICK'] },
        { dishKey: 'spicy-margarita', name: 'Spicy margarita', description: 'Chilli-infused blanco, lime, agave', priceCents: 2300 }
      ] }
    ]
  });
  await publishedMenu(stAlma, { name: 'Smith wedding', slug: 'smith-wedding', kind: 'PRIVATE_EVENT', visibility: 'PRIVATE', sections: [{ title: 'Canapés', items: [{ dishKey: 'x', name: 'Oysters', priceCents: 600 }] }] });
  await publishedMenu(stAlma, { name: 'Taco Tuesday', slug: 'tuesday', kind: 'PROMOTION', draftOnly: true, sections: [] });

  await publishedMenu(avalon, {
    name: 'Food',
    slug: 'food',
    kind: 'FOOD',
    heading: 'À la carte',
    sections: [
      { title: 'To start', items: [
        { dishKey: 'guacamole', name: 'Guacamole', description: 'Salsa macha, tostadas', priceCents: 1700, tags: ['VG', 'GFA', 'N'] },
        { dishKey: 'octopus', name: 'Grilled octopus', description: 'Black bean, chorizo, chimichurri', priceCents: 3600, tags: ['GF'], isSeafood: true }
      ] },
      { title: 'Mains', items: [
        { dishKey: 'short-rib', name: 'Beef short rib', description: 'Mole negro, pickled shallot', priceCents: 4400, tags: ['GF'] },
        { dishKey: 'whole-fish', name: 'Whole market fish', description: 'Salsa verde, charred lime', priceCents: 5200, isSeafood: true, flags: ['LIMITED'] }
      ] }
    ]
  });
  await publishedMenu(avalon, {
    name: 'Happy hour',
    slug: 'happy-hour',
    kind: 'PROMOTION',
    heading: 'Happy hour',
    templateKey: 'promo_card',
    extra: { subheading: 'Margaritas, tacos and tunes.', whenLine: 'Wed–Fri · 4–6pm', conditions: 'Dine-in only.' },
    sections: [{ title: 'While it lasts', items: [{ dishKey: 'hh-margarita', name: 'Margarita', priceCents: 1400 }, { dishKey: 'hh-tacos', name: 'Two tacos', priceCents: 1200 }] }]
  });

  console.log('seeded: venues st-alma, alma-avalon; users admin@alma.local (admin), trystan@alma.local (Avalon publisher)');
}

main().finally(() => prisma.$disconnect());

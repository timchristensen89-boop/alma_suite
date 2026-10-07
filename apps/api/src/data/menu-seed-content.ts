/**
 * The current printed menus, as data. Transcribed from the website's print
 * content (alma-web-platform apps/web/app/print/_food/menus.ts — St Alma at
 * the 13 Jul 2026 print state, Alma Avalon at 22 Aug 2026, prices +$1 from
 * Sep 2026) and checked line by line against the brief.
 *
 * Dish keys are readable slugs here so the first version's keys are stable and
 * recognisable; dishes added in the editor get a slug plus a random suffix.
 */
import type { MenuDocument, MenuItemDocument, MenuSectionDocument, MenuTagCode } from '@alma/shared';
import type { MenuTemplateKey } from '@alma/shared';

export type MenuSeed = {
  venueSlug: string;
  venueName: string;
  menuName: string;
  templateKey: MenuTemplateKey;
  document: MenuDocument;
};

function slug(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

type DishSpec = {
  name: string;
  tags: MenuTagCode[];
  price?: number | null;
  unit?: string;
  description?: string;
  seafood?: boolean;
};

function dish(prefix: string, spec: DishSpec): MenuItemDocument {
  return {
    dishKey: `${prefix}-${slug(spec.name)}`,
    name: spec.name,
    description: spec.description ?? null,
    priceCents: spec.price === undefined || spec.price === null ? null : spec.price * 100,
    priceUnit: spec.unit ?? null,
    tags: spec.tags,
    isSeafood: Boolean(spec.seafood),
    visible: true,
    recipeId: null
  };
}

function section(
  prefix: string,
  spec: Omit<MenuSectionDocument, 'items' | 'visible' | 'headerSuffix' | 'subheading'> & {
    headerSuffix?: string;
    subheading?: string;
    items: DishSpec[];
  }
): MenuSectionDocument {
  return {
    title: spec.title,
    headerSuffix: spec.headerSuffix ?? null,
    subheading: spec.subheading ?? null,
    sectionType: spec.sectionType,
    placement: spec.placement,
    visible: true,
    items: spec.items.map((item) => dish(prefix, item))
  };
}

const SURCHARGE = 'A surcharge of 10% applies on weekends and 15% on public holidays.';

const trustOurChef = (prefix: string, placement: 'FULL' | 'RIGHT') =>
  section(prefix, {
    title: 'Trust our chef',
    subheading: 'For the whole table.',
    sectionType: 'SET_MENUS',
    placement,
    items: [
      { name: 'Grazing', tags: [], price: 49, unit: 'pp', description: 'A lighter spread to start and share.' },
      { name: 'Feasting', tags: [], price: 79, unit: 'pp', description: 'The full table feast, chosen by the kitchen.' },
      { name: 'Agave pairing', tags: [], price: 45, unit: 'pp', description: 'A flight or matched pours.' }
    ]
  });

export const ST_ALMA_FRESHWATER_SEED: MenuSeed = {
  venueSlug: 'st-alma',
  venueName: 'St Alma',
  menuName: 'Food',
  templateKey: 'freshwater_alacarte',
  document: {
    dietaryNote: 'Dietaries catered with notice. Please advise your server of any allergies.',
    surchargeLine: SURCHARGE,
    sections: [
      section('fw', {
        title: 'To start',
        sectionType: 'STANDARD',
        placement: 'LEFT',
        items: [
          { name: 'Guacamole', tags: ['VG', 'GFA', 'DF', 'N'], price: 17, description: 'Salsa macha, tostadas' },
          { name: 'Kingfish ceviche', tags: ['GF', 'DF', 'A'], seafood: true, price: 33, description: 'Apple, cucumber, strawberry & basil aguachile, roe' },
          { name: 'Prawn tostada', tags: ['GFA', 'DF', 'I'], seafood: true, price: 23, description: 'Avocado, salmon and guajillo pâté' },
          { name: 'Chicken tinga empanadas', tags: ['GFA', 'DF'], price: 22, description: 'Morita salsa, pickled onions, three pieces' },
          { name: 'Mushroom carnita empanadas', tags: ['V', 'GFA', 'DF'], price: 22, description: 'Morita salsa, pickled onions, three pieces' }
        ]
      }),
      section('fw', {
        title: 'Tacos',
        headerSuffix: '9 each',
        sectionType: 'HEADER_PRICED',
        placement: 'LEFT',
        items: [
          { name: 'Barramundi, guacamole, pickled cabbage, chipotle aioli', tags: ['GFA', 'DF', 'A'], seafood: true },
          { name: 'Beef birria, morita salsa, crispy chickpeas', tags: ['GF', 'DF'] },
          { name: 'Nopal, avocado salsa, fried potatoes', tags: ['VG', 'GF', 'DF'] },
          { name: 'Chorizo and potato, refried beans, tomatillo salsa', tags: ['GF', 'DF'] }
        ]
      }),
      section('fw', {
        title: 'From the grill',
        sectionType: 'STANDARD',
        placement: 'RIGHT',
        items: [
          { name: 'Grilled snapper', tags: ['GF', 'A'], seafood: true, price: 40, description: 'Chipotle & cauliflower purée, fennel, green apple pico' },
          { name: 'Roasted cabbage', tags: ['VG', 'GF', 'N'], price: 33, description: 'Pepita mole, shishito peppers · allow 30 minutes' },
          { name: 'Grilled octopus', tags: ['GFA', 'DF', 'I'], seafood: true, price: 39, description: 'Chimichurri, refried bean purée, crunchy lentils' },
          { name: 'Roast chicken', tags: ['GF', 'N'], price: 43, description: 'Esquites, salsa macha' },
          { name: 'Agave beef short rib', tags: ['GF', 'DF'], price: 49, description: 'Grilled cos, pickled carrots, tortillas' }
        ]
      }),
      section('fw', {
        title: 'Sides',
        sectionType: 'STANDARD',
        placement: 'RIGHT',
        items: [
          { name: 'Polenta and Parmesan fries', tags: ['V', 'GFA'], price: 19, description: 'Chipotle aioli' },
          { name: 'Roasted baby beetroot', tags: ['V', 'GF', 'N'], price: 20, description: 'Grapefruit, goat cheese cream, hazelnut' },
          { name: 'Green leaf salad', tags: ['V', 'GF', 'DF', 'N'], price: 17, description: 'Roasted hazelnut, orange segments, citrus vinaigrette' },
          { name: 'Broccolini', tags: ['VG', 'GF', 'DF', 'N'], price: 20, description: 'Almond mole' }
        ]
      }),
      section('fw', {
        title: 'Sweet',
        sectionType: 'STANDARD',
        placement: 'FULL',
        items: [
          { name: 'Dairy free pavlova', tags: ['V', 'GF', 'DF'], price: 19, description: 'Passion fruit, charred mezcal pineapple' },
          { name: 'Churros', tags: ['V', 'N'], price: 19, description: 'Almond and white chocolate ganache, ice cream' }
        ]
      }),
      trustOurChef('fw', 'FULL')
    ]
  }
};

export const ALMA_AVALON_SEED: MenuSeed = {
  venueSlug: 'alma-avalon',
  venueName: 'Alma Avalon',
  menuName: 'Food',
  templateKey: 'avalon_alacarte',
  document: {
    dietaryNote: 'Dietaries catered with notice. Dishes may contain traces of allergens. Please advise your server of any allergies.',
    surchargeLine: SURCHARGE,
    sections: [
      section('av', {
        title: 'To start',
        sectionType: 'STANDARD',
        placement: 'LEFT',
        items: [
          { name: 'Guacamole', tags: ['VG', 'GFA', 'DF'], price: 17, description: 'Corn chips, wakame' },
          { name: 'Mexican shrimp cocktail', tags: ['GF', 'DF', 'I'], seafood: true, price: 22, description: 'Avocado, onion and cucumber salsa' },
          { name: 'Salmon sashimi hard shell taco', tags: ['GFA', 'DF', 'N', 'A'], seafood: true, price: 22, description: 'Pico de gallo, guacachile, three pieces' },
          { name: 'Sweet corn', tags: ['V', 'GFA'], price: 17, description: 'Panko, cotija cheese, chipotle, four pieces' },
          { name: 'Halloumi', tags: ['V', 'GF', 'N'], price: 19, description: 'Agave glaze, salsa macha, three pieces' },
          { name: 'Chicken tinga empanadas', tags: ['GFA', 'DF'], price: 22, description: 'Salsa roja, three pieces' }
        ]
      }),
      section('av', {
        title: 'Tacos',
        headerSuffix: '9 each',
        sectionType: 'HEADER_PRICED',
        placement: 'LEFT',
        items: [
          { name: 'Barramundi, coleslaw, chipotle aioli', tags: ['GF', 'DF', 'A'], seafood: true },
          { name: 'Pork belly, guacamole, pineapple salsa', tags: ['GF', 'DF'] },
          { name: 'Zucchini, salsa macha, avocado', tags: ['VG', 'GF', 'DF', 'N'] },
          { name: 'Carne asada, avocado, onions', tags: ['GF', 'DF'] }
        ]
      }),
      section('av', {
        title: 'To share',
        sectionType: 'STANDARD',
        placement: 'LEFT',
        items: [
          { name: 'Fish of the day al pastor', tags: ['GF', 'DF', 'A'], seafood: true, price: 47, description: 'Pico de piña, avocado mousse' },
          { name: 'Agave beef short rib', tags: ['GF', 'DF'], price: 49, description: 'Grilled cos, baby carrots, tortillas' },
          { name: 'Cauliflower steak', tags: ['V', 'GF'], price: 33, description: 'Butter bean cream, roast pepita salsa' }
        ]
      }),
      section('av', {
        title: 'Sides',
        sectionType: 'STANDARD',
        placement: 'RIGHT',
        items: [
          { name: 'Broccolini', tags: ['VG', 'GF', 'DF', 'N'], price: 20, description: 'Pipián mole, pepitas' },
          { name: 'Shoestring fries', tags: ['V', 'GF', 'DF'], price: 11, description: 'Paprika, chipotle aioli' },
          { name: 'Nashi pear', tags: ['V', 'GF'], price: 19, description: 'Goat’s cheese' }
        ]
      }),
      section('av', {
        title: 'Sweet',
        sectionType: 'STANDARD',
        placement: 'RIGHT',
        items: [
          { name: 'Churros', tags: ['V', 'N'], price: 19, description: 'Dulce de leche, chocolate ice cream' },
          { name: 'Pistachio flan', tags: ['V', 'GF', 'N'], price: 17, description: 'Pistachio, white chocolate ganache' }
        ]
      }),
      trustOurChef('av', 'RIGHT')
    ]
  }
};

export const MENU_SEEDS: MenuSeed[] = [ST_ALMA_FRESHWATER_SEED, ALMA_AVALON_SEED];

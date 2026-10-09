/**
 * Every reference menu the importer knows, in the order the Menus home will
 * list them. Each spec is a complete, validated MenuDocument transcribed
 * from a reference (the website's print sheets, the design folder's PDFs)
 * with its source, how sure we are that it is current, and what the owner
 * must check before publishing. Nothing here is approved content: the
 * importer creates reviewable drafts and never publishes.
 */
import { AVALON_BOTTOMLESS_IMPORT, AVALON_HAPPY_HOUR_IMPORT, AVALON_LUNCH_SPECIAL_IMPORT } from './avalon-cards.js';
import { AVALON_DRINKS_IMPORT } from './avalon-drinks.js';
import { GROUP_FUNCTIONS_IMPORT } from './group-functions.js';
import { GROUP_SET_MENU_PACK_IMPORT } from './group-set-menu-pack.js';
import { ST_ALMA_BOTTOMLESS_IMPORT } from './st-alma-cards.js';
import { ST_ALMA_DRINKS_IMPORT } from './st-alma-drinks.js';
import { ST_ALMA_TUESDAY_IMPORT } from './st-alma-tuesday.js';
import type { MenuImportSpec } from './types.js';

export type { MenuImportConfidence, MenuImportSource, MenuImportSpec } from './types.js';

export const MENU_IMPORTS: readonly MenuImportSpec[] = [
  ST_ALMA_DRINKS_IMPORT,
  ST_ALMA_TUESDAY_IMPORT,
  ST_ALMA_BOTTOMLESS_IMPORT,
  AVALON_DRINKS_IMPORT,
  AVALON_HAPPY_HOUR_IMPORT,
  AVALON_BOTTOMLESS_IMPORT,
  AVALON_LUNCH_SPECIAL_IMPORT,
  GROUP_FUNCTIONS_IMPORT,
  GROUP_SET_MENU_PACK_IMPORT
];

/**
 * The website's What's On events, as promotions. Listing copy, schedule and
 * booking details are the website's (apps/web/data/whats-on.ts at the
 * reference commit); the price and conditions come from the linked card
 * where one exists, because the card is what the promotion prints. Photos
 * are the website's files, attached when the importer can read them.
 */
export type PromotionImportSpec = {
  venueSlug: string;
  slug: string;
  name: string;
  publicTitle: string;
  summary: string;
  dayLabel: string;
  cadenceLabel: string;
  timeLabel: string;
  validDays: number[];
  startTime: string | null;
  priceLabel: string;
  /** The card's slug on the same venue, when the promotion prints one. */
  cardSlug: string | null;
  /** Path of the listing photo, relative to the website's public/ folder. */
  image: { path: string; alt: string } | null;
  confidence: MenuImportSpec['confidence'];
  review: string[];
};

export const PROMOTION_IMPORTS: readonly PromotionImportSpec[] = [
  {
    venueSlug: 'alma-avalon',
    slug: 'happy-hour',
    name: 'Happy hour',
    publicTitle: 'Happy hour',
    summary: 'Early drinks, snacks and Avalon afternoons that roll into dinner.',
    dayLabel: 'Wed–Sun',
    cadenceLabel: 'Weekly',
    timeLabel: 'Wed–Thu · 5–6pm · Fri–Sun · 4–6pm',
    validDays: [0, 3, 4, 5, 6],
    startTime: '17:00',
    priceLabel: 'Walk-in',
    cardSlug: 'happy-hour',
    image: { path: 'images/alma-avalon-margarita-pour.jpeg', alt: 'A margarita being poured at Alma Avalon' },
    confidence: 'medium',
    review: ['The website says Wed–Sun; the A5 card says Tue–Thu / Fri–Sun; the recurring strip says Wed–Thu 5–6 and Fri–Sun 4–6. Confirm the hours before publishing.']
  },
  {
    venueSlug: 'alma-avalon',
    slug: 'bottomless-lunch',
    name: 'Bottomless lunch',
    publicTitle: 'Bottomless lunch',
    summary: 'A shared feast for the table, guacamole and corn chips, a shared starter, then a shared main with a side, alongside bottomless margaritas. Dishes move with the season.',
    dayLabel: 'Sat–Sun',
    cadenceLabel: 'Weekly',
    timeLabel: 'Sat & Sun · 12–4pm',
    validDays: [0, 6],
    startTime: '12:00',
    priceLabel: '',
    cardSlug: 'bottomless',
    image: { path: 'images/alma-avalon-table-drinks.jpeg', alt: 'Drinks on a long table at Alma Avalon' },
    confidence: 'high',
    review: ['The website copy ends "$99 pp"; the price now comes from the promotion, so the sentence was dropped from the summary.']
  },
  {
    venueSlug: 'alma-avalon',
    slug: 'taco-wednesday',
    name: 'Taco Wednesday',
    publicTitle: 'Taco Wednesday',
    summary: '$5 tacos and $15 margaritas all night long, every Wednesday at Alma Avalon.',
    dayLabel: 'Wed',
    cadenceLabel: 'Weekly',
    timeLabel: 'Every Wednesday · all night',
    validDays: [3],
    startTime: '17:00',
    priceLabel: '$5 tacos',
    cardSlug: null,
    image: { path: 'images/most-ordered-sashimi-taco.jpg', alt: 'A sashimi taco' },
    confidence: 'medium',
    review: ['No printed card exists for Taco Wednesday in the design folder; the listing has no PDF until one is made.']
  },
  {
    venueSlug: 'st-alma',
    slug: 'taco-tuesday',
    name: 'Taco Tuesday',
    publicTitle: 'Taco Tuesday',
    summary: '$5 tacos and midweek margaritas every Tuesday night at St Alma.',
    dayLabel: 'Tue',
    cadenceLabel: 'Weekly',
    timeLabel: 'Every Tuesday · from 5pm',
    validDays: [2],
    startTime: '17:00',
    priceLabel: '$5 tacos',
    cardSlug: null,
    image: { path: 'images/taco-tuesday.jpg', alt: 'Tacos at St Alma' },
    confidence: 'medium',
    review: ['The Tuesday menu is imported as a FOOD menu (the A4 sheet "Tuesday"), not as a card, so this listing links no PDF. Decide whether Tuesday should print as the A4 sheet or an A5 card.']
  },
  {
    venueSlug: 'st-alma',
    slug: 'bottomless-lunch',
    name: 'Bottomless lunch',
    publicTitle: 'Bottomless lunch',
    summary: 'A shared feast for the table, guacamole and corn chips, a shared starter, then a shared main with a side, alongside bottomless margaritas. Dishes move with the season.',
    dayLabel: 'Fri–Sun',
    cadenceLabel: 'Weekly',
    timeLabel: 'Fri–Sun · 12–4pm',
    validDays: [0, 5, 6],
    startTime: '12:00',
    priceLabel: '',
    cardSlug: 'bottomless',
    image: { path: 'images/st-alma-cocktails-bar.jpeg', alt: 'Cocktails at the St Alma bar' },
    confidence: 'high',
    review: ['The website serves the 8 Nov 2025 card; the imported card is the 15 Nov 2025 one from the design folder (two lines differ).']
  }
];

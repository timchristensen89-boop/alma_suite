/**
 * Decide which POS course each dish of a set menu fires on.
 *
 * Service order at both venues, as Tim put it: all drinks fire now, dips and
 * chips fire now, then the rest flow through Course 1, 2, 3 ... with the mains
 * and the sides landing together.
 *
 * The register reads `SetMenuCourse.posCourse` when the banquet picker commits
 * a table. Without it every course fell back to its own NAME, and since the
 * seeder names courses after the dish, a table of four came out as fourteen
 * one-dish "courses" on the fire screen — which is what this fixes.
 *
 * This is a guess made once, not a rule. Everything it decides is editable per
 * course in Stock, and the seeder never overwrites a course somebody has
 * already set by hand.
 */

/** Fires immediately — the drinks and the thing on the table when guests sit. */
export const NOW = 'NOW';

/**
 * The register's own course cycle (posService.listCourses seeds exactly these,
 * and pos-web falls back to them). A set menu that needs more than six
 * sittings does not exist, so the last one absorbs any overflow.
 */
export const COURSE_NAMES = ['Course 1', 'Course 2', 'Course 3', 'Course 4', 'Course 5', 'Course 6'];
const LAST_COURSE = 'Course 6';

export const TIER_NOW = 0;
export const TIER_STARTER = 1;
export const TIER_TACO = 2;
/** Mains and sides share a tier on purpose: they go down together. */
export const TIER_MAIN = 3;

/**
 * The same test the register uses to route a line to the bar rather than the
 * kitchen (`kindBucket` in apps/api/src/services/pos.service.ts). Kept in step
 * by hand — the two apps do not share code — because a drink the register
 * sends to the bar and this sends to Course 2 would be worse than either.
 */
const DRINK = /bar|bev|cocktail|drink|wine|beer|spirit|liquor|coffee|tea|juice|margarita|mezcal|tequila|vodka|gin|whiskey/;

/** Guacamole and the tostadas it comes with — on the table before anything else. */
const DIPS_AND_CHIPS = /guacamole|guac\b|tostada|corn chip|totopo|salsa|queso|nacho|\bdips?\b/;

/** Cold and small, before the tacos. */
const STARTER = /ceviche|tiradito|aguachile|escabeche|empanada|croquet|oyster|entrada|starter|snack/;

const TACO = /taco/;

export type CourseDish = {
  title: string;
  kind?: string | null;
  category?: string | null;
};

/**
 * Which sitting a dish belongs to. Anything unrecognised lands with the mains:
 * a dish that arrives late is a dish somebody notices and moves, where one
 * that fires early is already on the pass.
 */
export function courseTier(dish: CourseDish): number {
  // Kind and category only, never the title: "beer-battered" and "tequila
  // prawns" are food, and the register agrees because it asks the same way.
  if (DRINK.test(`${dish.kind ?? ''} ${dish.category ?? ''}`.toLowerCase())) return TIER_NOW;
  const title = (dish.title ?? '').toLowerCase();
  if (DIPS_AND_CHIPS.test(title)) return TIER_NOW;
  if (TACO.test(title)) return TIER_TACO;
  if (STARTER.test(title)) return TIER_STARTER;
  return TIER_MAIN;
}

/**
 * Name the POS course for each dish, in the order the dishes were given.
 *
 * Only the sittings a menu actually uses get numbered, so the Bottomless menu
 * — which stops after the tacos — reads Course 1 then Course 2, not Course 1
 * then Course 3. A gap in the numbering is the kind of small wrongness staff
 * stop trusting.
 */
export function planCourseFlow(dishes: CourseDish[]): string[] {
  const tiers = dishes.map(courseTier);
  const used = [...new Set(tiers.filter((tier) => tier !== TIER_NOW))].sort((a, b) => a - b);
  const named = new Map<number, string>();
  used.forEach((tier, index) => named.set(tier, COURSE_NAMES[index] ?? LAST_COURSE));
  return tiers.map((tier) => (tier === TIER_NOW ? NOW : named.get(tier) ?? NOW));
}

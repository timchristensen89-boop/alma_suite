/**
 * Matching the printed menus against the register's dishes — pure, so the
 * rules that decide whether two names are the same dish can be tested rather
 * than trusted. Covered by dish-dietary.test.ts.
 *
 * This one is held to a higher bar than the wine matcher, because the payload
 * is allergen data. A wrong wine price is an argument at the till; a wrong
 * `gf` tag is a coeliac handed a plate of tortillas. So:
 *
 *   - Matching NEVER crosses venues. The two kitchens print the same dish name
 *     for different food: St Alma's guacamole is salsa macha and carries a nut
 *     mark, Avalon's is wakame and does not. Name alone is not identity.
 *   - A near miss is reported, never applied. There is no "best guess" branch
 *     in here on purpose — ambiguity comes back for a human to settle.
 *   - Nothing is inferred from a dish's name. Tags come from the printed menu
 *     and nowhere else.
 */

/**
 * The printed key, mapped onto DISH_DIETARY ids.
 *
 * A (australian) and I (imported) are provenance and are absent on purpose —
 * they say where the food is from, not what is in it, and importing them as
 * dietary tags would be inventing a claim the menu never made.
 */
export const PRINTED_MARKS: Record<string, string> = {
  V: 'veg',
  VG: 'vgn',
  GF: 'gf',
  GFA: 'gfo',
  DF: 'df',
  N: 'nuts'
};

/** Marks that are deliberately not dietary tags. */
export const PROVENANCE_MARKS = new Set(['A', 'I']);

/** Size and count words that describe the serve rather than the dish. */
const NOISE = new Set([
  'the', 'and', 'with', 'a', 'of', 'on',
  'pc', 'pcs', 'piece', 'pieces', 'one', 'two', 'three', 'four',
  'each', 'ea', 'serve', 'serves', 'side'
]);

/**
 * Words the register adds that the menu does not, and vice versa.
 *
 * "Barramundi Taco Grilled" and "Barramundi taco" are the same dish; so are
 * "Chicken Tinga Empanada (1pc)" and "Chicken tinga empanadas". Singular and
 * plural are folded rather than listed, so a new dish does not need a new
 * entry here to match.
 */
function fold(word: string): string {
  if (word.length > 3 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Down to comparable tokens: accents folded, bracketed asides dropped,
 * punctuation gone, plurals normalised, noise removed.
 *
 * Bracketed text goes because the register uses it for kitchen asides —
 * "(1pc)", "(Mixed Greens)", "(Al Pastor base)" — which the menu never prints.
 */
export function dishTokens(title: string): string[] {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(fold)
    .filter((word) => word && !NOISE.has(word));
}

export type DishMatch =
  | { kind: 'matched'; registerTitle: string; score: number }
  | { kind: 'ambiguous'; candidates: Array<{ registerTitle: string; score: number }> }
  | { kind: 'unmatched'; closest: { registerTitle: string; score: number } | null };

/**
 * How much of the menu dish's meaning the register title carries.
 *
 * Asymmetric like the wine matcher, and for the same reason: the register
 * title is usually the longer of the two ("Broccolini, almond mole" against
 * "Broccolini"), so scoring by intersection over the MENU's tokens asks the
 * right question — is everything the menu named present in the register item?
 * Symmetric scoring would punish the register for carrying more detail.
 */
export function scoreDish(menuTitle: string, registerTitle: string): number {
  const menu = dishTokens(menuTitle);
  const register = new Set(dishTokens(registerTitle));
  if (!menu.length || !register.size) return 0;
  const hits = menu.filter((token) => register.has(token)).length;
  return hits / menu.length;
}

/**
 * Pick the register dish a menu line refers to, within one venue.
 *
 * `MIN` is the floor for considering anything a match at all, and `LEAD` is
 * how far clear the winner has to be from the runner-up. Both exist so that
 * "Grilled snapper" cannot quietly attach itself to "Grilled Snapper (Al
 * Pastor base)" while a second snapper dish sits alongside it — that comes
 * back as ambiguous and a human decides.
 */
const MIN = 0.6;
const LEAD = 0.15;

export function matchDish(menuTitle: string, registerTitles: string[]): DishMatch {
  const scored = registerTitles
    .map((registerTitle) => ({ registerTitle, score: scoreDish(menuTitle, registerTitle) }))
    .sort((a, b) => b.score - a.score || a.registerTitle.localeCompare(b.registerTitle));

  const best = scored[0];
  if (!best || best.score < MIN) return { kind: 'unmatched', closest: best?.score ? best : null };

  const tied = scored.filter((row) => row.score > best.score - LEAD);
  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied.slice(0, 4) };

  return { kind: 'matched', registerTitle: best.registerTitle, score: best.score };
}

/**
 * Parse a `printed` cell into tag ids, keeping what was dropped.
 *
 * Anything unrecognised is returned in `unknown` rather than ignored, so a new
 * mark appearing on a reprint shows up as a question instead of silently
 * meaning nothing.
 */
export function parsePrintedMarks(printed: string): {
  tags: string[];
  provenance: string[];
  unknown: string[];
} {
  const tags: string[] = [];
  const provenance: string[] = [];
  const unknown: string[] = [];
  // Split on the menu's interpunct as well as commas and slashes.
  for (const raw of printed.split(/[·,/]/)) {
    const mark = raw.trim().toUpperCase();
    if (!mark) continue;
    if (PRINTED_MARKS[mark]) tags.push(PRINTED_MARKS[mark]);
    else if (PROVENANCE_MARKS.has(mark)) provenance.push(mark);
    else unknown.push(raw.trim());
  }
  return { tags, provenance, unknown };
}

/**
 * What a dish is, dietary-wise — and whether it answers what a guest asked for.
 *
 * This is allergen-adjacent, so the rules live in one tested place rather than
 * being re-derived by the register, the Stock editor and the kitchen printer.
 *
 * THE SAFETY RULE, which every function here obeys: an unmarked dish is
 * UNKNOWN, never safe. Nobody has walked the menu yet, so most dishes carry no
 * tags at all; a filter that treated "no tags" as "no gluten" would hand a
 * coeliac a plate of tortillas. Unknown dishes are excluded from a "suits this
 * guest" filter and the UI says so.
 */

/**
 * A dish's tags. Two different kinds of claim, kept apart on purpose:
 *
 *   SUITS    — this dish is fine for that diet as it leaves the pass.
 *   ON ASK   — the kitchen can make it fine, with notice.
 *   CONTAINS — this dish has the allergen in it.
 *
 * "Contains" is not the negation of "suits". A dish with no nut tag is a dish
 * nobody has checked for nuts, which is exactly why the two are separate: you
 * can only ever rule a dish OUT on a contains tag, never rule it IN on the
 * absence of one.
 */
export const DISH_DIETARY = [
  { id: 'gf', label: 'Gluten free', short: 'GF', kind: 'suits' },
  { id: 'gfo', label: 'Gluten free on ask', short: 'GFo', kind: 'onAsk' },
  { id: 'df', label: 'Dairy free', short: 'DF', kind: 'suits' },
  { id: 'dfo', label: 'Dairy free on ask', short: 'DFo', kind: 'onAsk' },
  { id: 'veg', label: 'Vegetarian', short: 'V', kind: 'suits' },
  { id: 'vgn', label: 'Vegan', short: 'VG', kind: 'suits' },
  { id: 'vgno', label: 'Vegan on ask', short: 'VGo', kind: 'onAsk' },
  { id: 'nuts', label: 'Contains nuts', short: 'Nuts', kind: 'contains' },
  { id: 'shellfish', label: 'Contains shellfish', short: 'Shellfish', kind: 'contains' }
] as const;

export type DishDietaryId = (typeof DISH_DIETARY)[number]['id'];

const BY_ID = new Map(DISH_DIETARY.map((tag) => [tag.id, tag]));

/** Drop anything that is not a tag we know, so a typo cannot become a claim. */
export function parseDishDietary(value: unknown): DishDietaryId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim().toLowerCase();
    if (BY_ID.has(id as DishDietaryId)) seen.add(id);
  }
  // Stable order, so two dishes tagged the same read the same on the docket.
  return DISH_DIETARY.filter((tag) => seen.has(tag.id)).map((tag) => tag.id);
}

export function dietaryLabel(id: DishDietaryId): string {
  return BY_ID.get(id)?.label ?? id;
}

export function dietaryShort(id: DishDietaryId): string {
  return BY_ID.get(id)?.short ?? id;
}

/** 'suits' | 'onAsk' | 'contains' — what kind of claim this tag makes. */
export function dietaryKind(id: DishDietaryId): string {
  return BY_ID.get(id)?.kind ?? 'suits';
}

/**
 * How a dish answers one guest requirement.
 *
 *   'yes'     — tagged as suiting it.
 *   'ask'     — the kitchen can do it with notice.
 *   'no'      — tagged as containing the thing they cannot have.
 *   'unknown' — nobody has marked this dish. NOT a yes.
 *
 * The guest tags are the ones the booking parser already produces from
 * SevenRooms free text (pos.service DIETARY_PATTERNS), so a table's
 * requirement and a dish's label are the same vocabulary rather than two that
 * nearly match.
 */
export type DietaryVerdict = 'yes' | 'ask' | 'no' | 'unknown';

const GUEST_TO_DISH: Record<string, { suits: DishDietaryId[]; onAsk: DishDietaryId[]; excludedBy: DishDietaryId[] }> = {
  GF: { suits: ['gf'], onAsk: ['gfo'], excludedBy: [] },
  DF: { suits: ['df'], onAsk: ['dfo'], excludedBy: [] },
  Vegan: { suits: ['vgn'], onAsk: ['vgno'], excludedBy: [] },
  // A vegan dish is vegetarian; the reverse is not true.
  Vegetarian: { suits: ['veg', 'vgn'], onAsk: ['vgno'], excludedBy: [] },
  'Nut allergy': { suits: [], onAsk: [], excludedBy: ['nuts'] },
  'Shellfish allergy': { suits: [], onAsk: [], excludedBy: ['shellfish'] }
};

/** Every guest requirement this can actually answer. */
export function answerableGuestTags(): string[] {
  return Object.keys(GUEST_TO_DISH);
}

/**
 * Whether a guest requirement is an ALLERGY — answerable only by ruling out.
 *
 * A diet (GF, vegan) can be answered 'yes': a suits tag is a positive claim
 * someone made about the dish. An allergy has no suits tag to make — the only
 * claims in the vocabulary are contains tags, so the best a dish can ever be
 * is "not marked as containing it". A filter for an allergy must therefore
 * EXCLUDE the marked dishes and present the rest as unverified, never as safe.
 */
export function guestTagIsAllergy(guestTag: string): boolean {
  const rule = GUEST_TO_DISH[guestTag];
  return Boolean(rule && rule.suits.length === 0 && rule.excludedBy.length > 0);
}

export function dishAnswersGuest(dishTags: readonly string[], guestTag: string): DietaryVerdict {
  const rule = GUEST_TO_DISH[guestTag];
  if (!rule) return 'unknown';
  const tags = parseDishDietary(dishTags);

  // Ruling OUT comes first and beats everything: a dish that contains nuts is
  // no good to a nut allergy however else it is tagged.
  if (rule.excludedBy.some((id) => tags.includes(id))) return 'no';

  // An allergy can NEVER be answered 'yes' here. This used to treat "tagged
  // for anything else" as "checked for the allergen" — but a dish walked for
  // the printed GF/DF/V marks has not been checked for shellfish at all, so a
  // prawn tostada tagged gf·df read as SUITABLE for a shellfish allergy. The
  // absence of a contains tag is not a safety claim; the verdict stays
  // unknown and the UI presents un-marked dishes as unverified, not safe.
  if (rule.suits.length === 0) return 'unknown';

  if (rule.suits.some((id) => tags.includes(id))) return 'yes';
  if (rule.onAsk.some((id) => tags.includes(id))) return 'ask';
  return 'unknown';
}

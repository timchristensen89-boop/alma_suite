/**
 * The three ways an Alma gift card is finished, from the Claude Design
 * project "Gift card redesign with fish" (AlmaCard.dc.html).
 *
 * heritage — gold foil on deep green, the classic
 * bold     — green on blush, so a big numeral lands
 * minimal  — mauve on bone, so the lockup can breathe
 *
 * The design ships a separately recoloured PNG of the wordmark and the ghosted
 * "a" for every palette. Here they are one white alpha mask each, painted
 * through with the palette's own colour — which is how the gold comes out as
 * an actual foil gradient rather than a flat approximation of one, and means
 * a fourth palette costs no new artwork.
 */

export const GIFT_CARD_PALETTES = ['heritage', 'bold', 'minimal'] as const;
export type GiftCardPalette = (typeof GIFT_CARD_PALETTES)[number];

export function isGiftCardPalette(value: unknown): value is GiftCardPalette {
  return typeof value === 'string' && (GIFT_CARD_PALETTES as readonly string[]).includes(value);
}

const ART = '/card-art';

/** The foil. A flat gold reads as mustard; the banding is what makes it foil. */
export const GOLD_FOIL =
  'linear-gradient(150deg,#8a6b2e 0%,#d9b268 22%,#f6e7b2 42%,#b58f3c 58%,#f4e4a8 76%,#8f6d2f 100%)';

export type PaletteTokens = {
  label: string;
  tagline: string;
  /** Card background. */
  bg: string;
  /** Panel fill for the split layout. */
  panel: string;
  /** The salmon, already coloured for this palette. */
  salmon: string;
  /** What the wordmark and glyph masks get painted with. */
  ink: string;
  /** Foil or flat — drives whether the wordmark gets a shadow. */
  wordShadow: string;
  label10: string;
  group: string;
  quote: string;
  quoteHi: string;
  frame: string;
  pillBorder: string;
  pillColor: string;
  /** Amounts and greetings are painted with this. */
  valueInk: string;
  glyphOpacity: number;
  grainBlend: 'multiply' | 'overlay';
  dark: boolean;
  /** Swatches for the picker. */
  swatchBg: string;
  swatchFg: string;
};

export const PALETTES: Record<GiftCardPalette, PaletteTokens> = {
  heritage: {
    label: 'Heritage',
    tagline: 'Gold foil on green',
    bg: 'radial-gradient(135% 120% at 26% 18%,#2f3f2b 0%,#243421 44%,#1a2717 78%,#121c10 100%)',
    panel: 'linear-gradient(160deg,#243421,#16210f)',
    salmon: `${ART}/salmon-foilgold.png`,
    ink: GOLD_FOIL,
    wordShadow: 'drop-shadow(0 3px 8px rgba(0,0,0,.45))',
    label10: '#cdb488',
    group: '#e7cd8b',
    quote: '#d9c9b6',
    quoteHi: '#e9ddcb',
    frame: 'rgba(214,180,110,.4)',
    pillBorder: 'rgba(214,180,110,.6)',
    pillColor: '#e7cd8b',
    valueInk: GOLD_FOIL,
    glyphOpacity: 0.06,
    grainBlend: 'overlay',
    dark: true,
    swatchBg: 'linear-gradient(160deg,#2f3f2b,#121c10)',
    swatchFg: '#e7cd8b'
  },
  bold: {
    label: 'Bold',
    tagline: 'Green on blush',
    bg: 'linear-gradient(155deg,#f9e4d6 0%,#f5dcce 55%,#eecdbb 100%)',
    panel: 'linear-gradient(160deg,#f2d8c8,#e9c9b6)',
    salmon: `${ART}/salmon-green.png`,
    ink: 'linear-gradient(#22301f,#22301f)',
    wordShadow: 'none',
    label10: '#6a7a5c',
    group: '#4a5c40',
    quote: '#4a5c40',
    quoteHi: '#33452c',
    frame: 'rgba(74,92,64,.35)',
    pillBorder: 'rgba(74,92,64,.5)',
    pillColor: '#3a4a30',
    valueInk: 'linear-gradient(#22301f,#22301f)',
    glyphOpacity: 0.08,
    grainBlend: 'multiply',
    dark: false,
    swatchBg: 'linear-gradient(160deg,#f9e4d6,#eecdbb)',
    swatchFg: '#22301f'
  },
  minimal: {
    label: 'Minimal',
    tagline: 'Mauve on bone',
    bg: 'linear-gradient(155deg,#f6f1e7 0%,#efe8db 52%,#e6dccb 100%)',
    panel: 'linear-gradient(160deg,#ece3d2,#e2d6c1)',
    salmon: `${ART}/salmon-mauve.png`,
    ink: 'linear-gradient(#4a3f3a,#4a3f3a)',
    wordShadow: 'none',
    label10: '#9a857c',
    group: '#8a736b',
    quote: '#6a5f57',
    quoteHi: '#5a4f47',
    frame: 'rgba(138,115,107,.3)',
    pillBorder: 'rgba(138,115,107,.5)',
    pillColor: '#6a5049',
    valueInk: 'linear-gradient(#4a3f3a,#4a3f3a)',
    glyphOpacity: 0.08,
    grainBlend: 'multiply',
    dark: false,
    swatchBg: 'linear-gradient(160deg,#f6f1e7,#e6dccb)',
    swatchFg: '#8a736b'
  }
};

export const CARD_W = 900;
export const CARD_H = 567;
export const GRAIN = `${ART}/grain.png`;
export const WORD_MASK = `${ART}/alma-word.png`;
export const GLYPH_MASK = `${ART}/alma-glyph.png`;

import { GIFT_CARD_DESIGNS, type GiftCardDesign } from '@alma/shared';
import { AlmaCard, type GiftCardLayout } from './cardArt/AlmaCard';
import type { GiftCardEmblem } from './cardArt/emblems';
import { PALETTES, type GiftCardPalette } from './cardArt/palettes';

/**
 * What a buyer picks, expressed in the AlmaCard artwork.
 *
 * The rest of the app — the picker, the preview, the printable sheet — speaks
 * in a single `design` string, because that is what a gift card row stores.
 * This maps each of those to a palette, a layout, and for the greetings the
 * words and emblem that go on it.
 */

type DesignSpec = {
  label: string;
  tagline: string;
  palette: GiftCardPalette;
  layout: GiftCardLayout;
  greeting?: string;
  greetEyebrow?: string;
  emblem?: GiftCardEmblem;
};

const SPECS: Record<GiftCardDesign, DesignSpec> = {
  // The design project's own three picks: each layout in the palette that
  // flatters it — faithful stays heritage, the watermark gets room to breathe
  // in minimal, and the big numeral lands in bold.
  heritage: { label: 'Heritage', tagline: 'Gold foil on green', palette: 'heritage', layout: '1' },
  minimal: { label: 'Minimal', tagline: 'Mauve on bone', palette: 'minimal', layout: '2' },
  bold: { label: 'Bold', tagline: 'Green on blush', palette: 'bold', layout: '6' },

  thanks: {
    label: 'Thank you', tagline: 'With our thanks', palette: 'heritage', layout: 'greet',
    greeting: 'Thank You', greetEyebrow: 'with our thanks', emblem: 'none'
  },
  birthday: {
    label: 'Birthday', tagline: 'Many happy returns', palette: 'bold', layout: 'greet',
    greeting: 'Happy Birthday', greetEyebrow: 'many happy returns', emblem: 'none'
  },
  congrats: {
    label: 'Congratulations', tagline: 'With warm wishes', palette: 'minimal', layout: 'greet',
    greeting: 'Congratulations', greetEyebrow: 'with warm wishes', emblem: 'none'
  },
  love: {
    label: 'With love', tagline: 'For someone special', palette: 'heritage', layout: 'greet',
    greeting: 'With Love', greetEyebrow: 'for someone special', emblem: 'heart'
  },
  celebrate: {
    label: 'Cheers', tagline: 'Just because', palette: 'bold', layout: 'greet',
    greeting: 'Cheers', greetEyebrow: 'just because', emblem: 'glass'
  }
};

/**
 * Designs retired when the new artwork landed. Nothing issued was using them,
 * but an old row, a bookmarked link or a stale cache can still name one — and
 * a card that renders as nothing is worse than one that renders as the house
 * design.
 */
const RETIRED: Record<string, GiftCardDesign> = {
  forest: 'heritage',
  avalon: 'heritage',
  shell: 'minimal',
  stalma: 'minimal',
  summer: 'bold'
};

export const DEFAULT_GIFT_CARD_DESIGN: GiftCardDesign = 'heritage';

export function isGiftCardDesign(value: unknown): value is GiftCardDesign {
  return typeof value === 'string' && (GIFT_CARD_DESIGNS as readonly string[]).includes(value);
}

/** Whatever a row says, resolved to a design that can actually be drawn. */
export function resolveGiftCardDesign(value: unknown): GiftCardDesign {
  if (isGiftCardDesign(value)) return value;
  if (typeof value === 'string' && RETIRED[value]) return RETIRED[value];
  return DEFAULT_GIFT_CARD_DESIGN;
}

export const GIFT_CARD_DESIGN_META = Object.fromEntries(
  GIFT_CARD_DESIGNS.map((design) => {
    const spec = SPECS[design];
    const palette = PALETTES[spec.palette];
    return [design, {
      label: spec.label,
      tagline: spec.tagline,
      swatchBg: palette.swatchBg,
      swatchFg: palette.swatchFg
    }];
  })
) as Record<GiftCardDesign, { label: string; tagline: string; swatchBg: string; swatchFg: string }>;

export type GiftCardArtProps = {
  design: GiftCardDesign | string;
  /**
   * The old artwork printed a separate back carrying the code. The new cards
   * put the redeem line on the front, so no back is drawn — the prop stays so
   * existing callers need not change, and 'back' renders the same card.
   */
  side?: 'front' | 'back';
  amount: number | string;
  code?: string;
  recipient?: string;
  /** Omit to fill the container, which is what every surface here does. */
  width?: number;
  /** Off for print, where rounded corners and a drop shadow bleed. */
  chrome?: boolean;
};

export function GiftCardArt({ design, amount, recipient, width, chrome = true }: GiftCardArtProps) {
  const spec = SPECS[resolveGiftCardDesign(design)];
  return (
    <AlmaCard
      layout={spec.layout}
      palette={spec.palette}
      amount={amount}
      greeting={spec.greeting}
      greetEyebrow={
        // A named recipient is the most personal thing on the card, so on a
        // greeting it takes the eyebrow line.
        spec.layout === 'greet' && recipient ? `for ${recipient}` : spec.greetEyebrow
      }
      emblem={spec.emblem}
      width={width}
      chrome={chrome}
    />
  );
}

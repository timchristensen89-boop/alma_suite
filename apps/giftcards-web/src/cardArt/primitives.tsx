import type { CSSProperties, ReactNode } from 'react';
import { GLYPH_MASK, WORD_MASK, type PaletteTokens } from './palettes';

/**
 * The pieces every layout is built from.
 *
 * The wordmark and the ghosted "a" are white alpha masks painted through with
 * the palette's ink, so the heritage gold arrives as a real foil gradient
 * rather than a flat colour standing in for one.
 */

/** Text painted with a gradient — the foil, or a flat colour in the other two. */
export function Ink({
  ink,
  children,
  style
}: {
  ink: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    // backgroundImage, not the `background` shorthand: the shorthand resets
    // background-clip to border-box, which beat the class and painted the
    // gradient across the whole box instead of clipping it to the glyphs.
    <span className="alma-card-ink" style={{ backgroundImage: ink, ...style }}>
      {children}
    </span>
  );
}

function Masked({ mask, ink, width, filter, style }: {
  mask: string;
  ink: string;
  width: number;
  filter?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'block',
        width,
        // The mask files carry their own aspect; height follows from it.
        aspectRatio: mask === WORD_MASK ? '1046 / 401' : '486 / 495',
        background: ink,
        WebkitMaskImage: `url(${mask})`,
        maskImage: `url(${mask})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        filter,
        ...style
      }}
    />
  );
}

/** The "alma" wordmark. */
export function Word({ t, width, style }: { t: PaletteTokens; width: number; style?: CSSProperties }) {
  return <Masked mask={WORD_MASK} ink={t.ink} width={width} filter={t.wordShadow} style={style} />;
}

/** The letterspaced GROUP under the wordmark. */
export function Group({ t, size = 15, style }: { t: PaletteTokens; size?: number; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'block',
        fontSize: size,
        letterSpacing: '.52em',
        textTransform: 'uppercase',
        color: t.group,
        ...style
      }}
    >
      Group
    </span>
  );
}

/** The ghosted "a" that sits behind several layouts. */
export function Glyph({ t, height, style }: { t: PaletteTokens; height: number; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        height,
        width: (height * 486) / 495,
        background: t.ink,
        opacity: t.glyphOpacity,
        WebkitMaskImage: `url(${GLYPH_MASK})`,
        maskImage: `url(${GLYPH_MASK})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        pointerEvents: 'none',
        ...style
      }}
    />
  );
}

/** A small letterspaced label — the eyebrow used all over the design. */
export function Label({
  t,
  size = 10,
  tracking = '.34em',
  faded = false,
  children,
  style
}: {
  t: PaletteTokens;
  size?: number;
  tracking?: string;
  faded?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontSize: size,
        letterSpacing: tracking,
        textTransform: 'uppercase',
        color: t.label10,
        opacity: faded ? 0.85 : 1,
        ...style
      }}
    >
      {children}
    </span>
  );
}

/** The salmon, positioned by whichever layout is using it. */
export function Salmon({ t, style }: { t: PaletteTokens; style?: CSSProperties }) {
  return <img src={t.salmon} alt="" aria-hidden style={{ position: 'absolute', pointerEvents: 'none', ...style }} />;
}

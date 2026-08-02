import type { CSSProperties } from 'react';
import { Emblem, type GiftCardEmblem } from './emblems';
import { Glyph, Group, Ink, Label, Salmon, Word } from './primitives';
import {
  CARD_H,
  CARD_W,
  GRAIN,
  PALETTES,
  type GiftCardPalette,
  type PaletteTokens
} from './palettes';

/**
 * The Alma gift card, ported from the Claude Design project "Gift card
 * redesign with fish" (AlmaCard.dc.html).
 *
 * Twelve compositions across three palettes, all drawn from the same
 * vocabulary: the eyebrow, the $ pill, alma + GROUP, the italic quote, the
 * redeem line, EST. 2017 and the ghosted "a".
 *
 * Rendered at a fixed 900x567 and scaled by the caller, so a card looks
 * identical in a picker, in an email and on a printed sheet — the alternative
 * is three drifting copies of the same artwork.
 */

export const GIFT_CARD_LAYOUTS = [
  'hero', 'greet', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'
] as const;
export type GiftCardLayout = (typeof GIFT_CARD_LAYOUTS)[number];

export function isGiftCardLayout(value: unknown): value is GiftCardLayout {
  return typeof value === 'string' && (GIFT_CARD_LAYOUTS as readonly string[]).includes(value);
}

export type AlmaCardProps = {
  layout?: GiftCardLayout;
  palette?: GiftCardPalette;
  amount?: string | number;
  quote?: string;
  /** greet layout */
  greeting?: string;
  greetEyebrow?: string;
  emblem?: GiftCardEmblem;
  /** Drop the salmon for the ghosted glyph instead. */
  noFish?: boolean;
  /** Rounded corners and a drop shadow — off for print, where it bleeds. */
  chrome?: boolean;
  /** Rendered width; the card scales to it. */
  width?: number;
  className?: string;
};

const SERIF = "'Cormorant Garamond', 'Hoefler Text', Georgia, serif";
const SANS = "'Jost', 'Avenir LT Std', system-ui, sans-serif";

const REDEEM = 'Redeem at any alma venue';
const EST = 'Est. 2017';

/** Longer greetings step down so they never wrap off the card. */
function greetSize(greeting: string) {
  if (greeting.length > 14) return 68;
  if (greeting.length > 9) return 88;
  return 108;
}

export function AlmaCard({
  layout = 'hero',
  palette = 'heritage',
  amount = '100',
  quote = "Slow afternoons, a long table, somebody else's cooking.",
  greeting = 'Thank You',
  greetEyebrow = 'with our thanks',
  emblem = 'none',
  noFish = false,
  chrome = true,
  width = CARD_W,
  className
}: AlmaCardProps) {
  const t = PALETTES[palette] ?? PALETTES.heritage;
  const scale = width / CARD_W;

  return (
    <div
      className={className}
      style={{
        width,
        height: CARD_H * scale,
        flex: 'none',
        // The whole card is authored at 900x567 and scaled as one unit, so
        // every inset, type size and shadow keeps its exact relationship.
        ...(scale !== 1 ? { position: 'relative', overflow: 'hidden' } : null)
      }}
    >
      <div
        style={{
          width: CARD_W,
          height: CARD_H,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: chrome ? 32 : 0,
          boxShadow: chrome
            ? '0 50px 90px -34px rgba(20,26,16,.6),0 8px 22px -10px rgba(20,26,16,.45)'
            : 'none',
          fontFamily: SANS,
          color: '#efe0cf',
          background: t.bg
        }}
      >
        {layout === 'hero' ? <Hero t={t} amount={amount} /> : null}
        {layout === 'greet' ? (
          <Greet t={t} greeting={greeting} eyebrow={greetEyebrow} emblem={emblem} noFish={noFish} />
        ) : null}
        {layout !== 'hero' && layout !== 'greet' ? (
          <Numbered n={layout} t={t} amount={amount} quote={quote} />
        ) : null}

        <img
          src={GRAIN}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.4,
            mixBlendMode: t.grainBlend,
            pointerEvents: 'none'
          }}
        />
        {t.dark ? (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(118deg,transparent 34%,rgba(255,251,238,.08) 49%,rgba(255,251,238,.13) 51%,transparent 64%)',
              pointerEvents: 'none'
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Hero({ t, amount }: { t: PaletteTokens; amount: string | number }) {
  return (
    <>
      <Salmon t={t} style={{ left: '50%', top: '47%', transform: 'translate(-50%,-50%)', width: '82%', opacity: 0.42 }} />
      <Word t={t} width={420} style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'absolute', left: 58, right: 58, top: 46, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label t={t} size={10} tracking=".42em">{EST}</Label>
        <Label t={t} size={11} tracking=".5em">Gift Card</Label>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 48, textAlign: 'center' }}>
        <Label t={t} size={10} tracking=".46em" style={{ display: 'block', marginBottom: 6 }}>Gift value</Label>
        <Ink ink={t.valueInk} style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 62, lineHeight: 0.9, display: 'block' }}>
          ${amount}
        </Ink>
      </div>
    </>
  );
}

function Greet({
  t, greeting, eyebrow, emblem, noFish
}: { t: PaletteTokens; greeting: string; eyebrow: string; emblem: GiftCardEmblem; noFish: boolean }) {
  return (
    <>
      {noFish ? (
        <Glyph t={t} height={430} style={{ left: '50%', top: '54%', transform: 'translate(-50%,-50%)' }} />
      ) : (
        <Salmon t={t} style={{ left: '50%', bottom: -78, transform: 'translateX(-50%)', width: '66%', opacity: 0.24 }} />
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 56, display: 'flex', justifyContent: 'center' }}>
        <Word t={t} width={150} />
      </div>
      <div style={{ position: 'absolute', left: 60, right: 60, top: '50%', transform: 'translateY(-50%)', textAlign: 'center' }}>
        {emblem !== 'none' ? (
          <div style={{ color: t.label10, marginBottom: 18, display: 'flex', justifyContent: 'center' }}>
            <Emblem name={emblem} />
          </div>
        ) : null}
        <Label t={t} size={11} tracking=".5em" style={{ display: 'block', marginBottom: 14 }}>{eyebrow}</Label>
        <Ink
          ink={t.valueInk}
          style={{
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontWeight: 500,
            fontSize: greetSize(greeting),
            lineHeight: 0.98,
            display: 'block',
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.15))'
          }}
        >
          {greeting}
        </Ink>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 50, textAlign: 'center' }}>
        <Label t={t} size={10} tracking=".4em" faded>{REDEEM} · {EST}</Label>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */

const abs = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });

function Quote({ t, size, style, children }: { t: PaletteTokens; size: number; style?: CSSProperties; children: string }) {
  return (
    <p style={{ margin: 0, fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: size, lineHeight: 1.32, color: t.quote, ...style }}>
      “{children}”
    </p>
  );
}

function Value({ t, amount, size, style }: { t: PaletteTokens; amount: string | number; size: number; style?: CSSProperties }) {
  return (
    <Ink ink={t.valueInk} style={{ fontFamily: SERIF, fontWeight: 500, fontSize: size, lineHeight: 0.9, display: 'block', ...style }}>
      ${amount}
    </Ink>
  );
}

function Numbered({
  n, t, amount, quote
}: { n: string; t: PaletteTokens; amount: string | number; quote: string }) {
  switch (n) {
    // 01 · Faithful original
    case '1':
      return (
        <>
          <Glyph t={t} height={340} style={{ right: 44, bottom: -46 }} />
          <Salmon t={t} style={{ right: 52, top: 118, width: 300, opacity: 0.5 }} />
          <div style={abs({ inset: 22, border: `1px solid ${t.frame}`, borderRadius: 20, pointerEvents: 'none' })} />
          <Label t={t} size={12} style={abs({ left: 58, top: 52 })}>Alma Group · Gift Card</Label>
          <div style={abs({ left: 58, top: 196 })}>
            <Word t={t} width={290} />
            <Group t={t} style={{ margin: '12px 0 0 6px' }} />
          </div>
          <Quote t={t} size={25} style={abs({ left: 60, bottom: 120, maxWidth: 420 })}>{quote}</Quote>
          <Label t={t} faded style={abs({ left: 60, bottom: 52 })}>{REDEEM}</Label>
          <Label t={t} faded style={abs({ right: 58, bottom: 52 })}>{EST}</Label>
        </>
      );

    // 02 · Watermark lockup
    case '2':
      return (
        <>
          <Salmon t={t} style={{ left: '50%', top: '48%', transform: 'translate(-50%,-50%)', width: '88%', opacity: 0.4 }} />
          <div style={abs({ left: '50%', top: '45%', transform: 'translate(-50%,-50%)', textAlign: 'center' })}>
            <Word t={t} width={440} />
            <Group t={t} size={16} style={{ marginTop: 14, letterSpacing: '.62em', paddingLeft: '.62em' }} />
          </div>
          <Label t={t} size={11} tracking=".4em" style={abs({ left: 58, top: 46 })}>Gift Card</Label>
          <div style={abs({ left: 0, right: 0, bottom: 46, textAlign: 'center' })}>
            <Label t={t} size={10} tracking=".36em" faded>{REDEEM} · {EST}</Label>
          </div>
        </>
      );

    // 03 · Bottom bleed
    case '3':
      return (
        <>
          <Salmon t={t} style={{ left: -40, bottom: -70, width: 640, opacity: 0.55 }} />
          <div style={abs({ left: 58, top: 56 })}>
            <Word t={t} width={250} />
            <Group t={t} size={13} style={{ margin: '10px 0 0 4px', letterSpacing: '.5em' }} />
          </div>
          <div style={abs({ right: 56, top: 56, textAlign: 'right' })}>
            <Label t={t} size={10} tracking=".46em" style={{ display: 'block', marginBottom: 6 }}>Gift value</Label>
            <Value t={t} amount={amount} size={70} style={{ lineHeight: 0.86 }} />
          </div>
          <Quote t={t} size={24} style={abs({ right: 56, bottom: 56, textAlign: 'right', maxWidth: 360 })}>{quote}</Quote>
        </>
      );

    // 04 · Vertical split
    case '4':
      return (
        <>
          <div style={abs({ left: 0, top: 0, bottom: 0, width: '44%', background: t.panel, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 54px' })}>
            <Word t={t} width={230} />
            <Group t={t} size={13} style={{ margin: '12px 0 30px 4px', letterSpacing: '.5em' }} />
            <Label t={t} size={10} tracking=".44em" style={{ display: 'block', marginBottom: 4 }}>Gift value</Label>
            <Value t={t} amount={amount} size={58} />
          </div>
          <Salmon t={t} style={{ right: '2%', top: '50%', transform: 'translateY(-50%)', width: '52%', opacity: 0.92 }} />
          <Label t={t} size={11} tracking=".4em" style={abs({ right: 44, top: 46, color: t.group })}>Gift Card</Label>
          <Label t={t} size={10} tracking=".36em" faded style={abs({ right: 44, bottom: 46 })}>{EST}</Label>
        </>
      );

    // 05 · Ghost glyph
    case '5':
      return (
        <>
          <Glyph t={t} height={520} style={{ left: '50%', top: '52%', transform: 'translate(-50%,-50%)' }} />
          <Salmon t={t} style={{ left: '50%', top: '56%', transform: 'translate(-50%,-50%)', width: '56%', opacity: 0.68 }} />
          <div style={abs({ left: 0, right: 0, top: 64, display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
            <Word t={t} width={230} />
            <Group t={t} size={13} style={{ marginTop: 10, letterSpacing: '.56em', paddingLeft: '.56em' }} />
          </div>
          <Label t={t} size={10} tracking=".36em" faded style={abs({ left: 58, bottom: 52 })}>{REDEEM}</Label>
          <Value t={t} amount={amount} size={40} style={abs({ right: 58, bottom: 52, lineHeight: 1 })} />
        </>
      );

    // 06 · Amount hero
    case '6':
      return (
        <>
          <Salmon t={t} style={{ left: '50%', top: '56%', transform: 'translate(-50%,-50%)', width: '80%', opacity: 0.26 }} />
          <div style={abs({ left: 0, right: 0, top: 52, display: 'flex', justifyContent: 'center' })}>
            <Word t={t} width={180} />
          </div>
          <div style={abs({ left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', textAlign: 'center' })}>
            <Ink ink={t.valueInk} style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 96, lineHeight: 0.9, display: 'block', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.15))' }}>
              ${amount}
            </Ink>
          </div>
          <div style={abs({ left: 0, right: 0, bottom: 50, textAlign: 'center' })}>
            <Label t={t} size={10} tracking=".4em" faded>{REDEEM} · {EST}</Label>
          </div>
        </>
      );

    // 07 · Editorial top
    case '7':
      return (
        <>
          <Salmon t={t} style={{ left: '50%', top: -64, transform: 'translateX(-50%)', width: '70%', opacity: 0.62 }} />
          <div style={abs({ left: 58, right: 58, top: 210, height: 1, background: `linear-gradient(90deg,transparent,${t.pillBorder},transparent)` })} />
          <div style={abs({ left: 58, top: 238 })}>
            <Word t={t} width={250} />
            <Group t={t} size={13} style={{ margin: '10px 0 0 4px', letterSpacing: '.5em' }} />
          </div>
          <div style={abs({ right: 56, top: 250, textAlign: 'right' })}>
            <Label t={t} size={10} tracking=".44em" style={{ display: 'block', marginBottom: 4 }}>Gift value</Label>
            <Value t={t} amount={amount} size={58} />
          </div>
          <Quote t={t} size={23} style={abs({ left: 60, right: 60, bottom: 52, textAlign: 'center' })}>{quote}</Quote>
        </>
      );

    // 08 · Medallion
    case '8':
      return (
        <>
          <div style={abs({ left: '50%', top: '44%', transform: 'translate(-50%,-50%)', width: 300, height: 300, borderRadius: '50%', border: `1.5px solid ${t.pillBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
            <div style={{ width: 274, height: 274, borderRadius: '50%', border: `1px solid ${t.frame}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src={t.salmon} alt="" aria-hidden style={{ width: 230, opacity: 0.92 }} />
            </div>
          </div>
          <div style={abs({ left: 0, right: 0, top: 38, textAlign: 'center' })}>
            <Label t={t} size={11} tracking=".46em">Alma Group · {EST}</Label>
          </div>
          <div style={abs({ left: 0, right: 0, bottom: 74, display: 'flex', justifyContent: 'center' })}>
            <Word t={t} width={230} />
          </div>
          <div style={abs({ left: 0, right: 0, bottom: 46, textAlign: 'center' })}>
            <Value t={t} amount={amount} size={22} style={{ display: 'inline-block' }} />
          </div>
        </>
      );

    // 09 · Diagonal corner
    case '9':
      return (
        <>
          <Salmon t={t} style={{ right: -70, top: -40, width: 560, opacity: 0.55, transform: 'rotate(-8deg)' }} />
          <div style={abs({ right: 56, top: 44, border: `1px solid ${t.pillBorder}`, borderRadius: 20, padding: '7px 18px', fontSize: 13, color: t.pillColor })}>
            ${amount}
          </div>
          <div style={abs({ left: 58, bottom: 120 })}>
            <Word t={t} width={340} />
            <Group t={t} size={16} style={{ margin: '14px 0 0 6px', letterSpacing: '.54em' }} />
          </div>
          <Label t={t} size={10} tracking=".36em" faded style={abs({ left: 60, bottom: 52 })}>{REDEEM}</Label>
          <Label t={t} size={10} tracking=".36em" faded style={abs({ right: 58, bottom: 52 })}>{EST}</Label>
        </>
      );

    // 10 · Quote-led
    case '10':
      return (
        <>
          <Salmon t={t} style={{ left: '50%', bottom: -80, transform: 'translateX(-50%)', width: '64%', opacity: 0.28 }} />
          <div style={abs({ left: 0, right: 0, top: 52, display: 'flex', justifyContent: 'center' })}>
            <Word t={t} width={170} />
          </div>
          <p style={abs({ left: 80, right: 80, top: '50%', transform: 'translateY(-50%)', margin: 0, textAlign: 'center', fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 38, lineHeight: 1.3, color: t.quoteHi })}>
            “{quote}”
          </p>
          <Value t={t} amount={amount} size={34} style={abs({ left: 58, bottom: 50 })} />
          <Label t={t} size={10} tracking=".36em" faded style={abs({ right: 58, bottom: 56 })}>{EST}</Label>
        </>
      );

    default:
      return null;
  }
}

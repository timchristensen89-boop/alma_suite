/**
 * Alma Group — Gift card artwork.
 * Source: Claude Design bundle alma-suite-design-system/project/
 * gift-card-art.jsx. Six designs, each with front + back.
 *
 * The amount, recipient, and code are passed in so the live preview on
 * the buy page and the confirmation screen show the buyer's real values
 * instead of the sample $100 / ALMA-7C92F0 that ships with the design.
 *
 * CR-80 aspect ratio (1.586 : 1) is locked at the wrapper level. Each
 * design renders inside that frame.
 */
import type { CSSProperties } from 'react';
import { GIFT_CARD_DESIGNS, type GiftCardDesign } from '@alma/shared';

const SHELL = '#F5DCCE';
const COCOA = '#684A4A';
const COCOA_DEEP = '#3D2A2A';
const FOREST_DEEP = '#14241A';
const PEACH_ONDARK = '#FFF1E6';

const sansFont = '"Avenir LT Std", "Manrope", sans-serif';
const serifFont = '"Cormorant Garamond", "Hoefler Text", Georgia, serif';
const monoFont = '"IBM Plex Mono", ui-monospace, monospace';

export type GiftCardArtProps = {
  design: GiftCardDesign;
  side?: 'front' | 'back';
  amount: number;
  code?: string;
  recipient?: string;
};

export const GIFT_CARD_DESIGN_META: Record<GiftCardDesign, {
  label: string;
  tagline: string;
  swatchBg: string;
  swatchFg: string;
}> = {
  forest:  { label: 'Forest classic',   tagline: 'House',          swatchBg: 'linear-gradient(160deg, #233628 0%, #14241A 100%)', swatchFg: SHELL },
  shell:   { label: 'Coastal shell',    tagline: 'For dinner',     swatchBg: 'linear-gradient(160deg, #F5DCCE 0%, #ECBFA8 100%)', swatchFg: COCOA_DEEP },
  avalon:  { label: 'alma Avalon',      tagline: 'Restaurant & Bar', swatchBg: 'linear-gradient(160deg, #3D5C3F 0%, #244F2A 100%)', swatchFg: SHELL },
  stalma:  { label: 'st.alma Newport',  tagline: 'Counter restaurant', swatchBg: 'linear-gradient(160deg, #684A4A 0%, #3D2A2A 100%)', swatchFg: SHELL },
  thanks:  { label: 'Thank you',        tagline: 'Quiet bone',     swatchBg: 'linear-gradient(160deg, #EFE8DC 0%, #E2D9C5 100%)', swatchFg: FOREST_DEEP },
  summer:  { label: 'Long afternoons',  tagline: 'Summer ’26',     swatchBg: 'linear-gradient(160deg, #C9764C 0%, #A85432 100%)', swatchFg: PEACH_ONDARK }
};

export function isGiftCardDesign(value: unknown): value is GiftCardDesign {
  return typeof value === 'string' && (GIFT_CARD_DESIGNS as readonly string[]).includes(value);
}

export function GiftCardArt({ design, side = 'front', amount, code = 'ALMA-XXXXXX', recipient }: GiftCardArtProps) {
  const amountLabel = `$${amount}`;
  switch (design) {
    case 'forest':  return side === 'front' ? <ForestFront amount={amountLabel} /> : <ForestBack code={code} />;
    case 'shell':   return side === 'front' ? <ShellFront amount={amountLabel} /> : <ShellBack code={code} />;
    case 'avalon':  return side === 'front' ? <AvalonFront amount={amountLabel} /> : <AvalonBack code={code} />;
    case 'stalma':  return side === 'front' ? <StAlmaFront amount={amountLabel} /> : <StAlmaBack code={code} />;
    case 'thanks':  return side === 'front' ? <ThanksFront amount={amountLabel} recipient={recipient} /> : <ThanksBack code={code} />;
    case 'summer':  return side === 'front' ? <SummerFront amount={amountLabel} /> : <SummerBack code={code} />;
  }
}

function Frame({ bg, fg, accent, sheen = 'light', children }: { bg: string; fg: string; accent: string; sheen?: 'light' | 'dark'; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative',
      width: '100%', height: '100%',
      borderRadius: 14,
      background: bg,
      color: fg,
      overflow: 'hidden',
      boxShadow: '0 30px 70px -30px rgba(20,36,26,0.45), 0 1px 0 rgba(255,255,255,0.08) inset',
      fontFamily: sansFont
    }}>
      <div style={{ position: 'absolute', inset: 10, border: `1px solid ${accent}`, borderRadius: 10, pointerEvents: 'none' }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: sheen === 'dark'
          ? 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.20) 100%)'
          : 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.06) 100%)'
      }} />
      {children}
    </div>
  );
}

function Eyebrow({ children, color, size = 10, tracking = '0.42em', style }: { children: React.ReactNode; color: string; size?: number; tracking?: string; style?: CSSProperties }) {
  return (
    <div style={{ fontFamily: sansFont, fontWeight: 700, fontSize: size, letterSpacing: tracking, textTransform: 'uppercase', color, ...style }}>{children}</div>
  );
}

function Wordmark({ children, color, size = 80 }: { children: React.ReactNode; color: string; size?: number }) {
  return (
    <div style={{ fontFamily: serifFont, fontStyle: 'italic', fontWeight: 500, fontSize: size, lineHeight: 1, letterSpacing: '-0.005em', color }}>{children}</div>
  );
}

function AmountPill({ amount, dark }: { amount: string; dark?: boolean }) {
  return (
    <span style={{
      padding: '5px 12px 4px',
      borderRadius: 9999,
      background: dark ? COCOA_DEEP : 'transparent',
      color: dark ? SHELL : 'currentColor',
      border: dark ? 'none' : '1px solid currentColor',
      fontFamily: sansFont, fontWeight: 700, fontSize: 9.5, letterSpacing: '0.32em', textTransform: 'uppercase'
    }}>{amount}</span>
  );
}

function CodeBlock({ code, fg, bg, borderColor }: { code: string; fg: string; bg: string; borderColor: string }) {
  return (
    <div style={{
      marginTop: 8,
      padding: '10px 14px',
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      fontFamily: monoFont, fontSize: 14,
      color: fg,
      letterSpacing: '0.24em',
      textAlign: 'center'
    }}>{code}</div>
  );
}

/* ============================================================
   1) Forest classic
   ============================================================ */
function ForestFront({ amount }: { amount: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #233628 0%, #14241A 100%)" fg={SHELL} accent="rgba(245,220,206,0.20)" sheen="dark">
      <div style={{
        position: 'absolute', right: -30, bottom: -90,
        fontFamily: serifFont, fontStyle: 'italic',
        fontSize: '60%', lineHeight: 1, color: 'rgba(245,220,206,0.08)',
        letterSpacing: '-0.02em', userSelect: 'none',
        transform: 'scale(4.5)', transformOrigin: 'bottom right'
      }}>a</div>
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Eyebrow color="rgba(245,220,206,0.55)" size={10}>Alma Group · Gift Card</Eyebrow>
          <AmountPill amount={amount} />
        </div>
        <div>
          <Wordmark color={SHELL} size={50}>alma <span style={{ opacity: 0.7 }}>group</span></Wordmark>
          <div style={{ marginTop: 12, fontFamily: serifFont, fontStyle: 'italic', fontSize: '4%', color: 'rgba(245,220,206,0.78)', lineHeight: 1.35, maxWidth: '26ch' }}>
            &ldquo;Slow afternoons, a long table, somebody else&rsquo;s cooking.&rdquo;
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Eyebrow color="rgba(245,220,206,0.55)" size={9} tracking="0.30em">Redeem at any Alma venue</Eyebrow>
          <Eyebrow color="rgba(245,220,206,0.4)" size={9} tracking="0.30em">est. 2018</Eyebrow>
        </div>
      </div>
    </Frame>
  );
}

function ForestBack({ code }: { code: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #14241A 0%, #1F3524 100%)" fg={SHELL} accent="rgba(245,220,206,0.18)" sheen="dark">
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Eyebrow color="rgba(245,220,206,0.55)" size={10}>Card code</Eyebrow>
          <CodeBlock code={code} fg={SHELL} bg="rgba(245,220,206,0.08)" borderColor="rgba(245,220,206,0.18)" />
        </div>
        <div style={{ fontFamily: sansFont, fontSize: 10, color: 'rgba(245,220,206,0.55)', lineHeight: 1.55 }}>
          Redeemable at any Alma Group venue. Not refundable for cash. Treat like cash &mdash; we cannot replace if lost. Balance check at <span style={{ color: SHELL }}>alma.com.au/cards</span>.
        </div>
        <Eyebrow color="rgba(245,220,206,0.55)" size={10}>alma <span style={{ fontFamily: serifFont, fontStyle: 'italic', letterSpacing: 0 }}>group</span></Eyebrow>
      </div>
    </Frame>
  );
}

/* ============================================================
   2) Coastal shell
   ============================================================ */
function ShellFront({ amount }: { amount: string }) {
  return (
    <Frame bg={`linear-gradient(160deg, ${SHELL} 0%, #ECBFA8 100%)`} fg={COCOA_DEEP} accent="rgba(61,42,42,0.20)">
      <svg style={{ position: 'absolute', left: '6%', top: '8%', opacity: 0.32 }} width="14%" viewBox="0 0 64 34" fill="none" stroke={COCOA_DEEP} strokeWidth="1.2">
        <path d="M3 17 Q14 4 32 4 Q50 4 56 14 Q62 8 62 6 Q62 12 60 17 Q62 22 62 28 Q62 26 56 20 Q50 30 32 30 Q14 30 3 17 Z" />
        <circle cx="48" cy="14" r="1.5" fill={COCOA_DEEP} stroke="none" />
      </svg>
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Eyebrow color="rgba(61,42,42,0.55)" size={10}>For dinner, on us</Eyebrow>
          <AmountPill amount={amount} dark />
        </div>
        <Wordmark color={COCOA_DEEP} size={64}>alma <span style={{ opacity: 0.7 }}>group</span></Wordmark>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Eyebrow color="rgba(61,42,42,0.55)" size={9} tracking="0.30em">Restaurant &amp; bar</Eyebrow>
          <Eyebrow color="rgba(61,42,42,0.4)" size={9} tracking="0.30em">Avalon · Newport</Eyebrow>
        </div>
      </div>
    </Frame>
  );
}

function ShellBack({ code }: { code: string }) {
  return (
    <Frame bg={`linear-gradient(160deg, #F3D2C0 0%, ${SHELL} 100%)`} fg={COCOA_DEEP} accent="rgba(61,42,42,0.20)">
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Eyebrow color="rgba(61,42,42,0.55)" size={10}>Card code</Eyebrow>
          <CodeBlock code={code} fg={COCOA_DEEP} bg="rgba(255,255,255,0.5)" borderColor="rgba(61,42,42,0.18)" />
        </div>
        <div style={{ fontFamily: sansFont, fontSize: 10, color: 'rgba(61,42,42,0.65)', lineHeight: 1.55 }}>
          Redeem at alma Avalon or st.alma Newport. Carries no expiry. Lost cards may be reissued if the original code is provided. Balance check at alma.com.au/cards.
        </div>
        <Eyebrow color="rgba(61,42,42,0.55)" size={10}>alma <span style={{ fontFamily: serifFont, fontStyle: 'italic', letterSpacing: 0 }}>group</span></Eyebrow>
      </div>
    </Frame>
  );
}

/* ============================================================
   3) Avalon (Restaurant & Bar) — green specific
   ============================================================ */
function AvalonFront({ amount }: { amount: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #3D5C3F 0%, #244F2A 100%)" fg={SHELL} accent="rgba(214,224,205,0.30)" sheen="dark">
      <svg style={{ position: 'absolute', right: '-4%', bottom: '-12%', opacity: 0.18 }} width="60%" viewBox="0 0 280 140" fill="none" stroke={SHELL} strokeWidth="1.2">
        <path d="M5 70 Q60 14 140 14 Q230 14 260 60 Q278 30 276 22 Q276 50 266 70 Q278 90 276 118 Q276 110 260 80 Q230 126 140 126 Q60 126 5 70 Z" />
        <circle cx="225" cy="56" r="3" fill={SHELL} stroke="none" />
      </svg>
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Eyebrow color={SHELL} size={10}>Restaurant &amp; Bar · Avalon</Eyebrow>
        <div>
          <Wordmark color={SHELL} size={84}>alma</Wordmark>
          <div style={{ marginTop: 6, fontFamily: sansFont, fontWeight: 700, fontSize: 10, letterSpacing: '0.40em', color: 'rgba(245,220,206,0.78)', textTransform: 'uppercase' }}>
            Gift card · for the corner
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Eyebrow color="rgba(245,220,206,0.55)" size={9} tracking="0.30em">23 Old Barrenjoey Rd</Eyebrow>
          <span style={{ padding: '5px 12px 4px', borderRadius: 9999, background: SHELL, color: '#244F2A', fontFamily: sansFont, fontWeight: 700, fontSize: 9.5, letterSpacing: '0.32em', textTransform: 'uppercase' }}>{amount}</span>
        </div>
      </div>
    </Frame>
  );
}

function AvalonBack({ code }: { code: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #244F2A 0%, #1F3524 100%)" fg={SHELL} accent="rgba(214,224,205,0.20)" sheen="dark">
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Eyebrow color="rgba(245,220,206,0.55)" size={10}>Card code</Eyebrow>
          <CodeBlock code={code} fg={SHELL} bg="rgba(245,220,206,0.08)" borderColor="rgba(245,220,206,0.18)" />
        </div>
        <div style={{ fontFamily: serifFont, fontStyle: 'italic', fontSize: '4%', color: 'rgba(245,220,206,0.85)', lineHeight: 1.45 }}>
          &ldquo;A whole snapper, sharing plates, mezcal until the sun&rsquo;s down. For the corner of Avalon &mdash; book ahead on a Friday.&rdquo;
        </div>
        <Eyebrow color="rgba(245,220,206,0.55)" size={10}>alma <span style={{ fontFamily: serifFont, fontStyle: 'italic', letterSpacing: 0 }}>Avalon</span></Eyebrow>
      </div>
    </Frame>
  );
}

/* ============================================================
   4) st.alma specific
   ============================================================ */
function StAlmaFront({ amount }: { amount: string }) {
  return (
    <Frame bg={`linear-gradient(160deg, ${COCOA} 0%, ${COCOA_DEEP} 100%)`} fg={SHELL} accent="rgba(245,220,206,0.20)" sheen="dark">
      <div style={{ position: 'absolute', left: '7%', top: '8%', bottom: '8%', width: 1, background: 'rgba(245,220,206,0.20)' }} />
      <div style={{ position: 'relative', padding: '8% 9% 8% 13%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Eyebrow color="rgba(245,220,206,0.55)" size={10}>Counter restaurant · Newport</Eyebrow>
        <div>
          <Wordmark color={SHELL} size={72}>st.alma</Wordmark>
          <div style={{ marginTop: 8, fontFamily: serifFont, fontSize: '4%', color: 'rgba(245,220,206,0.80)', lineHeight: 1.35, fontStyle: 'italic' }}>
            Two sittings a night, one menu, twelve seats at the counter.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Eyebrow color="rgba(245,220,206,0.55)" size={9} tracking="0.30em">Counter · 12 seats</Eyebrow>
          <span style={{ padding: '5px 12px 4px', borderRadius: 9999, background: SHELL, color: COCOA_DEEP, fontFamily: sansFont, fontWeight: 700, fontSize: 9.5, letterSpacing: '0.32em', textTransform: 'uppercase' }}>{amount}</span>
        </div>
      </div>
    </Frame>
  );
}

function StAlmaBack({ code }: { code: string }) {
  return (
    <Frame bg={`linear-gradient(160deg, ${COCOA_DEEP} 0%, ${COCOA} 100%)`} fg={SHELL} accent="rgba(245,220,206,0.20)" sheen="dark">
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Eyebrow color="rgba(245,220,206,0.55)" size={10}>Card code</Eyebrow>
          <CodeBlock code={code} fg={SHELL} bg="rgba(245,220,206,0.08)" borderColor="rgba(245,220,206,0.18)" />
        </div>
        <div style={{ fontFamily: sansFont, fontSize: 10, color: 'rgba(245,220,206,0.55)', lineHeight: 1.55 }}>
          Sits two for the nine-course tasting menu. Bookings released Sunday 9am for the following week. Add pairings $95 pp at the counter.
        </div>
        <Eyebrow color="rgba(245,220,206,0.55)" size={10}>st.<span style={{ fontFamily: serifFont, fontStyle: 'italic', letterSpacing: 0 }}>alma</span></Eyebrow>
      </div>
    </Frame>
  );
}

/* ============================================================
   5) Thank you — quiet bone
   ============================================================ */
function ThanksFront({ amount, recipient }: { amount: string; recipient?: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #EFE8DC 0%, #E2D9C5 100%)" fg={FOREST_DEEP} accent="rgba(20,36,26,0.16)">
      <div style={{ position: 'relative', padding: '9% 10%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Eyebrow color="rgba(20,36,26,0.55)" size={10}>A small thank you{recipient ? ` · for ${recipient}` : ''}</Eyebrow>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: serifFont, fontStyle: 'italic', fontWeight: 500, fontSize: 52, color: FOREST_DEEP, lineHeight: 0.95 }}>
            thank you.
          </div>
          <div style={{ marginTop: 12, fontFamily: serifFont, fontSize: 16, color: 'rgba(20,36,26,0.65)', fontStyle: 'italic' }}>
            With love &amp; gratitude, from the kitchen.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
          <span style={{ padding: '5px 12px 4px', borderRadius: 9999, border: `1px solid ${FOREST_DEEP}`, color: FOREST_DEEP, fontFamily: sansFont, fontWeight: 700, fontSize: 9.5, letterSpacing: '0.32em', textTransform: 'uppercase' }}>{amount}</span>
        </div>
      </div>
    </Frame>
  );
}

function ThanksBack({ code }: { code: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #E2D9C5 0%, #EFE8DC 100%)" fg={FOREST_DEEP} accent="rgba(20,36,26,0.16)">
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Eyebrow color="rgba(20,36,26,0.55)" size={10}>Card code</Eyebrow>
          <CodeBlock code={code} fg={FOREST_DEEP} bg="rgba(255,255,255,0.7)" borderColor="rgba(20,36,26,0.16)" />
        </div>
        <div style={{ fontFamily: sansFont, fontSize: 10, color: 'rgba(20,36,26,0.65)', lineHeight: 1.55 }}>
          Redeemable at any Alma Group venue. Treat like cash. No expiry. Balance &amp; full terms at alma.com.au/cards.
        </div>
        <Eyebrow color="rgba(20,36,26,0.55)" size={10}>alma <span style={{ fontFamily: serifFont, fontStyle: 'italic', letterSpacing: 0 }}>group</span></Eyebrow>
      </div>
    </Frame>
  );
}

/* ============================================================
   6) Limited · Summer
   ============================================================ */
function SummerFront({ amount }: { amount: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #C9764C 0%, #A85432 100%)" fg={PEACH_ONDARK} accent="rgba(255,241,230,0.30)">
      <svg style={{ position: 'absolute', right: '7%', top: '8%', opacity: 0.7 }} width="14%" viewBox="0 0 60 60" fill="none" stroke={PEACH_ONDARK} strokeWidth="1.2" strokeLinecap="round">
        <circle cx="30" cy="30" r="9" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * Math.PI * 2) / 12;
          const r1 = 14;
          const r2 = 22;
          return <line key={i} x1={30 + Math.cos(a) * r1} y1={30 + Math.sin(a) * r1} x2={30 + Math.cos(a) * r2} y2={30 + Math.sin(a) * r2} />;
        })}
      </svg>
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Eyebrow color="rgba(255,241,230,0.7)" size={10}>Limited edition · summer ’26</Eyebrow>
        <div>
          <Wordmark color={PEACH_ONDARK} size={52}>long</Wordmark>
          <Wordmark color={PEACH_ONDARK} size={52}>afternoons</Wordmark>
          <div style={{ marginTop: 10, fontFamily: serifFont, fontSize: 14, color: 'rgba(255,241,230,0.85)', fontStyle: 'italic' }}>
            margaritas on the terrace, until the sun&rsquo;s gone.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
          <span style={{ padding: '5px 12px 4px', borderRadius: 9999, background: PEACH_ONDARK, color: '#A85432', fontFamily: sansFont, fontWeight: 700, fontSize: 9.5, letterSpacing: '0.32em', textTransform: 'uppercase' }}>{amount}</span>
        </div>
      </div>
    </Frame>
  );
}

function SummerBack({ code }: { code: string }) {
  return (
    <Frame bg="linear-gradient(160deg, #A85432 0%, #7C3B22 100%)" fg={PEACH_ONDARK} accent="rgba(255,241,230,0.22)">
      <div style={{ position: 'relative', padding: '8% 9%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Eyebrow color="rgba(255,241,230,0.65)" size={10}>Card code</Eyebrow>
          <CodeBlock code={code} fg={PEACH_ONDARK} bg="rgba(255,241,230,0.10)" borderColor="rgba(255,241,230,0.22)" />
        </div>
        <div style={{ fontFamily: sansFont, fontSize: 10, color: 'rgba(255,241,230,0.65)', lineHeight: 1.55 }}>
          Summer edition. Includes the terrace welcome — a complimentary margarita on arrival between Dec and Feb. Beyond the season, redeems as a regular gift card.
        </div>
        <Eyebrow color="rgba(255,241,230,0.7)" size={10}>alma <span style={{ fontFamily: serifFont, fontStyle: 'italic', letterSpacing: 0 }}>group</span></Eyebrow>
      </div>
    </Frame>
  );
}

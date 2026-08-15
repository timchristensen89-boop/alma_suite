import { useState } from 'react';
import { AlmaCard, GIFT_CARD_LAYOUTS, type GiftCardLayout } from './AlmaCard';
import { GIFT_CARD_THEMES } from './emblems';
import { GIFT_CARD_PALETTES, PALETTES, type GiftCardPalette } from './palettes';

/**
 * Every layout in every palette, side by side.
 *
 * Artwork can only really be judged against its siblings — one card at a time
 * inside the buy flow tells you nothing about whether the set hangs together.
 */

const LAYOUT_NAMES: Record<GiftCardLayout, string> = {
  hero: 'Hero · the salmon lockup',
  greet: 'Greeting',
  back: 'Back · the reference side',
  '1': '01 · Faithful original',
  '2': '02 · Watermark lockup',
  '3': '03 · Bottom bleed',
  '4': '04 · Vertical split',
  '5': '05 · Ghost glyph',
  '6': '06 · Amount hero',
  '7': '07 · Editorial top',
  '8': '08 · Medallion',
  '9': '09 · Diagonal corner',
  '10': '10 · Quote-led'
};

export function CardArtGallery() {
  const [palette, setPalette] = useState<GiftCardPalette>('heritage');
  const [amount, setAmount] = useState('120');

  return (
    <div style={{ minHeight: '100vh', background: '#e9e5dd', padding: '48px 40px 90px', fontFamily: "'Jost', system-ui, sans-serif" }}>
      <header style={{ maxWidth: 900, marginBottom: 34 }}>
        <p style={{ margin: '0 0 14px', fontSize: 12, letterSpacing: '.36em', textTransform: 'uppercase', color: '#8a7f6f' }}>
          alma group · gift card artwork
        </p>
        <h1 style={{ margin: '0 0 14px', fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, fontSize: 46, lineHeight: 1.02, color: '#2a2620' }}>
          The salmon, three ways — and ten layouts.
        </h1>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: '#6a6154', maxWidth: 720 }}>
          Every composition below is the same component with one prop changed. The wordmark and the
          ghosted “a” are alpha masks painted with the palette's own ink, which is why the heritage
          gold is a real foil gradient rather than a flat stand-in for one.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 36, flexWrap: 'wrap' }}>
        {GIFT_CARD_PALETTES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPalette(p)}
            style={{
              minHeight: 44,
              padding: '0 20px',
              borderRadius: 999,
              border: palette === p ? '2px solid #2a2620' : '1px solid #cfc7b8',
              background: PALETTES[p].swatchBg,
              color: PALETTES[p].swatchFg,
              font: 'inherit',
              fontSize: 14,
              cursor: 'pointer'
            }}
          >
            {PALETTES[p].label} · {PALETTES[p].tagline}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 10, fontSize: 13, color: '#6a6154' }}>
          Amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ width: 90, minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid #cfc7b8', background: '#fff', font: 'inherit' }}
          />
        </label>
      </div>

      <Section title="Layouts">
        {GIFT_CARD_LAYOUTS.filter((l) => l !== 'greet').map((layout) => (
          <Tile key={layout} label={LAYOUT_NAMES[layout]}>
            <AlmaCard layout={layout} palette={palette} amount={amount} width={520} />
          </Tile>
        ))}
      </Section>

      <Section title="Greetings — themed for someone">
        {GIFT_CARD_THEMES.map((theme) => (
          <Tile key={theme.id} label={`${theme.greeting} · ${theme.emblem === 'none' ? 'no emblem' : theme.emblem}`}>
            <AlmaCard
              layout="greet"
              palette={palette}
              greeting={theme.greeting}
              greetEyebrow={theme.eyebrow}
              emblem={theme.emblem}
              width={520}
            />
          </Tile>
        ))}
      </Section>

      <Section title="Greetings without the salmon">
        {GIFT_CARD_THEMES.slice(0, 3).map((theme) => (
          <Tile key={theme.id} label={`${theme.greeting} · ghosted glyph`}>
            <AlmaCard
              layout="greet"
              palette={palette}
              greeting={theme.greeting}
              greetEyebrow={theme.eyebrow}
              emblem={theme.emblem}
              noFish
              width={520}
            />
          </Tile>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 54 }}>
      <p style={{ margin: '0 0 18px', fontSize: 11, letterSpacing: '.3em', textTransform: 'uppercase', color: '#9a8f7e' }}>{title}</p>
      <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap' }}>{children}</div>
    </section>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 520 }}>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: '#2a2620' }}>{label}</p>
      {children}
    </div>
  );
}

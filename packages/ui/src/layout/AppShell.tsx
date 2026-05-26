import { useEffect, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { ProductLogo } from '../brand/SuiteApps';

type Props = PropsWithChildren<{
  sidebar: ReactNode;
  topBar?: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
}>;

// Fish easter egg phases — rare animation where the bobbing sardine in the
// bottom-right gets caught by a fishing line, reeled off-screen, and either
// splashes back as itself OR drops back in as a margarita glass.
// Triggers 1-in-50 page loads.
type FishPhase = 'bobbing' | 'lured' | 'reeling' | 'gone' | 'splash' | 'margarita';

const FISH_ODDS = 1 / 50;
// 50/50 between coming back as a fish or as a margarita
const MARGARITA_CHANCE = 0.5;

export function AppShell({ children, sidebar, topBar, brand, footer }: Props) {
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [fishPhase, setFishPhase] = useState<FishPhase>('bobbing');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Roll the die once per session — pretty rare so the moment is special
    // when it lands. Skip when motion-reduced for accessibility.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (Math.random() >= FISH_ODDS) return;

    const becomesMargarita = Math.random() < MARGARITA_CHANCE;

    const timers: number[] = [];
    // After a beat of normal bobbing, drop the line
    timers.push(window.setTimeout(() => setFishPhase('lured'), 4500));
    // Fish bites and starts the slow vertical reel up the right edge
    timers.push(window.setTimeout(() => setFishPhase('reeling'), 4500 + 1800));
    // 3.2s reel — ends around mid-screen with a puff of smoke
    timers.push(window.setTimeout(() => setFishPhase('gone'), 4500 + 1800 + 3200));
    // Off-screen / gone for ~10 seconds, then either splashes back as a fish
    // or drops in as a margarita.
    timers.push(window.setTimeout(
      () => setFishPhase(becomesMargarita ? 'margarita' : 'splash'),
      4500 + 1800 + 3200 + 9500
    ));
    // Back to bobbing (fish reform after splash) or settle (margarita stays
    // in place a beat longer)
    timers.push(window.setTimeout(
      () => setFishPhase('bobbing'),
      4500 + 1800 + 3200 + 9500 + (becomesMargarita ? 6000 : 1600)
    ));

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <div className={`app-shell ${sidebarPinned ? 'is-sidebar-pinned' : ''}`}>
      <div className={`suite-fish is-${fishPhase}`} aria-hidden="true">
        <img src="/brand/alma-fish.png" alt="" draggable="false" className="suite-fish-img" />
        {(fishPhase === 'lured' || fishPhase === 'reeling') && (
          <span className="suite-fish-line" aria-hidden="true" />
        )}
        {fishPhase === 'reeling' && (
          <>
            <span className="suite-fish-puff suite-fish-puff--a" aria-hidden="true" />
            <span className="suite-fish-puff suite-fish-puff--b" aria-hidden="true" />
            <span className="suite-fish-puff suite-fish-puff--c" aria-hidden="true" />
            <span className="suite-fish-puff suite-fish-puff--d" aria-hidden="true" />
            <span className="suite-fish-puff suite-fish-puff--e" aria-hidden="true" />
          </>
        )}
        {fishPhase === 'splash' && (
          <>
            <span className="suite-fish-splash suite-fish-splash--a" aria-hidden="true" />
            <span className="suite-fish-splash suite-fish-splash--b" aria-hidden="true" />
            <span className="suite-fish-splash suite-fish-splash--c" aria-hidden="true" />
          </>
        )}
        {fishPhase === 'margarita' && (
          <>
            <svg className="suite-fish-margarita" viewBox="0 0 96 110" aria-hidden="true">
              {/* Glass bowl */}
              <path
                d="M 14 28 L 82 28 L 50 70 Z"
                fill="rgba(195, 222, 162, 0.55)"
                stroke="rgba(20, 36, 26, 0.55)"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              {/* Liquid highlight */}
              <path
                d="M 22 32 L 74 32 L 50 64 Z"
                fill="rgba(195, 222, 162, 0.8)"
              />
              {/* Stem */}
              <line x1="50" y1="70" x2="50" y2="92" stroke="rgba(20, 36, 26, 0.55)" strokeWidth="1.6" strokeLinecap="round" />
              {/* Foot */}
              <line x1="36" y1="94" x2="64" y2="94" stroke="rgba(20, 36, 26, 0.55)" strokeWidth="1.6" strokeLinecap="round" />
              {/* Salt rim */}
              <path
                d="M 14 27 L 82 27"
                stroke="rgba(255, 255, 255, 0.88)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M 14 27 L 82 27"
                stroke="rgba(20, 36, 26, 0.4)"
                strokeWidth="1"
                strokeDasharray="1.5 2"
                strokeLinecap="round"
              />
              {/* Lime wedge on the rim */}
              <g transform="translate(70 24)">
                <path
                  d="M -8 0 A 8 8 0 0 1 8 0 Z"
                  fill="#A6BF54"
                  stroke="rgba(20, 36, 26, 0.55)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path
                  d="M -5 0 A 5 5 0 0 1 5 0"
                  fill="#D9E8B0"
                  stroke="rgba(20, 36, 26, 0.4)"
                  strokeWidth="0.6"
                />
                <line x1="-3" y1="0" x2="-3" y2="-3" stroke="rgba(20, 36, 26, 0.4)" strokeWidth="0.5" />
                <line x1="0" y1="0" x2="0" y2="-4" stroke="rgba(20, 36, 26, 0.4)" strokeWidth="0.5" />
                <line x1="3" y1="0" x2="3" y2="-3" stroke="rgba(20, 36, 26, 0.4)" strokeWidth="0.5" />
              </g>
              {/* Tiny bubble */}
              <circle cx="38" cy="44" r="2" fill="rgba(255, 255, 255, 0.6)" />
              <circle cx="56" cy="50" r="1.4" fill="rgba(255, 255, 255, 0.5)" />
            </svg>
            <span className="suite-fish-splash suite-fish-splash--a" aria-hidden="true" />
            <span className="suite-fish-splash suite-fish-splash--b" aria-hidden="true" />
            <span className="suite-fish-splash suite-fish-splash--c" aria-hidden="true" />
          </>
        )}
      </div>
      <aside className="app-shell-sidebar">
        <button
          type="button"
          className="app-shell-sidebar-toggle"
          aria-label={sidebarPinned ? 'Collapse sidebar' : 'Pin sidebar open'}
          aria-controls="app-shell-primary-nav"
          aria-expanded={sidebarPinned}
          aria-pressed={sidebarPinned}
          onClick={() => setSidebarPinned((pinned) => !pinned)}
        >
          <span aria-hidden="true">{sidebarPinned ? '‹' : '›'}</span>
        </button>
        <div className="app-shell-brand">
          {brand ?? (
            <ProductLogo appId="compliance" size="md" showBrandMark={false} />
          )}
        </div>
        <nav id="app-shell-primary-nav" className="app-shell-nav">{sidebar}</nav>
        {footer ? <div className="app-shell-sidebar-footer">{footer}</div> : null}
      </aside>
      <div className="app-shell-body">
        {topBar ? <div className="app-shell-topbar">{topBar}</div> : null}
        <main className="app-shell-main">
          <div className="app-shell-container">{children}</div>
        </main>
      </div>
    </div>
  );
}

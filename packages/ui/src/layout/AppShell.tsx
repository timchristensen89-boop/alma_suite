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
// bottom-right gets caught by a fishing line, reeled off-screen, and
// splashed back in. Triggers 1-in-50 page loads.
type FishPhase = 'bobbing' | 'lured' | 'reeling' | 'gone' | 'splash';

const FISH_ODDS = 1 / 50;

export function AppShell({ children, sidebar, topBar, brand, footer }: Props) {
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [fishPhase, setFishPhase] = useState<FishPhase>('bobbing');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Roll the die once per session — pretty rare so the moment is special
    // when it lands. Skip when motion-reduced for accessibility.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (Math.random() >= FISH_ODDS) return;

    const timers: number[] = [];
    // After a beat of normal bobbing, drop the line
    timers.push(window.setTimeout(() => setFishPhase('lured'), 4500));
    // Fish bites, gets reeled
    timers.push(window.setTimeout(() => setFishPhase('reeling'), 4500 + 1800));
    // Off-screen for ~10 seconds
    timers.push(window.setTimeout(() => setFishPhase('gone'), 4500 + 1800 + 1600));
    // Splash back in
    timers.push(window.setTimeout(() => setFishPhase('splash'), 4500 + 1800 + 1600 + 9500));
    // Back to bobbing
    timers.push(window.setTimeout(() => setFishPhase('bobbing'), 4500 + 1800 + 1600 + 9500 + 1600));

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
        {fishPhase === 'splash' && (
          <>
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

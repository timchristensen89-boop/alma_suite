import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The phone task bar.
 *
 * Staff liked the bottom bar in the staff app because it put the thing they
 * came to do one thumb-reach away instead of behind a menu. This generalises
 * it so every app can do the same, and widens what it carries: not just the
 * four sections of an app, but the actual jobs — clock on, ask for leave,
 * start a count, log wastage, raise an order.
 *
 * Two decisions worth keeping:
 *
 * Five slots, never more. A sixth item on a 375px screen gives every target
 * 62px, and a mis-tap on "Wastage" when you meant "Transfer" costs somebody a
 * correction later. Past five, the last slot becomes More and the rest live in
 * a sheet above it — still one tap to open, two to reach anything.
 *
 * Router-agnostic. `@alma/ui` has no router dependency and should not grow one
 * for this, so items carry an `href` and the app decides what navigating means.
 * `onNavigate` gets the event; call `preventDefault()` and push to your router.
 */

export type TaskBarItem = {
  /** Stable key; also the value passed back to `onNavigate`. */
  key: string;
  label: string;
  href: string;
  icon?: ReactNode;
  /** Whether this is the screen currently showing. */
  active?: boolean;
  /** Small count on the icon — pending approvals, unread, that sort of thing. */
  badge?: number;
  /** Keep out of the overflow sheet and always on the bar. */
  primary?: boolean;
};

type Props = {
  items: TaskBarItem[];
  onNavigate?: (item: TaskBarItem, event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Screen-reader name for the bar. Defaults to "Quick actions". */
  label?: string;
};

/** How many targets fit across a phone before they get too small to hit. */
const SLOTS = 5;

const STYLE_ID = 'alma-taskbar-styles';

/**
 * Injected once rather than duplicated into four app stylesheets, so the bar
 * cannot drift between apps. Everything is scoped under .alma-taskbar.
 */
const CSS = `
:root {
  /* One number for the bar's height, used by the bar, the sheet that rests on
     it, and the padding that keeps page content clear of it. Hard-coding 56px
     in three places left the sheet tucked 9px behind the bar, because the bar
     is 56px of target plus a 1px top border. */
  --alma-taskbar-h: 57px;
}
.alma-taskbar { display: none; }
.alma-taskbar-sheet-backdrop { display: none; }

@media (max-width: 860px) {
  .alma-taskbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 60;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    background: var(--color-elevated, #fff);
    border-top: 1px solid var(--color-border, rgba(31, 53, 36, 0.12));
    /* Sit above the home indicator, not under it. */
    padding-bottom: env(safe-area-inset-bottom);
    min-height: var(--alma-taskbar-h);
    box-shadow: 0 -6px 18px -12px rgba(18, 28, 16, 0.4);
  }
  .alma-taskbar-item {
    position: relative;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 3px;
    /* 56px of target before the safe-area padding — a comfortable thumb. */
    min-height: 56px;
    padding: 7px 3px;
    border: 0;
    background: none;
    font: inherit;
    text-decoration: none;
    color: var(--color-text-muted, #475569);
    cursor: pointer;
  }
  .alma-taskbar-item.is-on { color: var(--color-accent, #2f5d3a); }
  .alma-taskbar-item:focus-visible {
    outline: 2px solid var(--color-accent, #2f5d3a);
    outline-offset: -3px;
    border-radius: 8px;
  }
  .alma-taskbar-icon { display: grid; place-items: center; width: 22px; height: 22px; }
  .alma-taskbar-icon svg { width: 20px; height: 20px; }
  .alma-taskbar-label {
    font-size: 10.5px;
    line-height: 1.1;
    font-weight: 600;
    text-align: center;
    /* Two words wrap rather than clipping mid-word. */
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .alma-taskbar-badge {
    position: absolute;
    top: 4px;
    left: calc(50% + 6px);
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--color-danger, #b3261e);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }

  /* The overflow sheet. */
  .alma-taskbar-sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 59;
    display: block;
    background: rgba(12, 20, 14, 0.38);
    border: 0;
    width: 100%;
  }
  .alma-taskbar-sheet {
    position: fixed;
    left: 0;
    right: 0;
    /* Rests on top of the bar. */
    bottom: calc(var(--alma-taskbar-h) + env(safe-area-inset-bottom));
    z-index: 61;
    background: var(--color-elevated, #fff);
    border-top: 1px solid var(--color-border, rgba(31, 53, 36, 0.12));
    border-radius: 14px 14px 0 0;
    padding: 10px 10px 14px;
    box-shadow: 0 -12px 30px -18px rgba(18, 28, 16, 0.55);
    max-height: 62vh;
    overflow-y: auto;
  }
  .alma-taskbar-sheet-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 6px;
  }
  .alma-taskbar-sheet .alma-taskbar-item {
    min-height: 68px;
    border-radius: 12px;
    background: var(--color-surface, rgba(31, 53, 36, 0.04));
  }

  /* Give the page back the height the bar covers, or the last row of every
     screen sits underneath it. */
  body { padding-bottom: calc(var(--alma-taskbar-h) + env(safe-area-inset-bottom)); }
}

@media (prefers-reduced-motion: no-preference) {
  .alma-taskbar-sheet { animation: alma-taskbar-rise 140ms ease-out; }
  @keyframes alma-taskbar-rise {
    from { transform: translateY(8px); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
}
`;

/**
 * Decide what goes on the bar and what goes behind More.
 *
 * Pure so it can be tested without a DOM, because the rule it encodes is worth
 * getting right: the screen you are currently on always stays visible. Losing
 * sight of where you are — because the app navigated and your tab vanished
 * into a sheet — is more disorienting than losing a slot to it.
 */
export function splitTaskBarItems(
  items: TaskBarItem[],
  slots: number
): { onBar: TaskBarItem[]; overflow: TaskBarItem[] } {
  if (items.length <= slots) return { onBar: items, overflow: [] };
  // One slot goes to More, so the bar itself holds slots - 1.
  const pinned = items.filter((item) => item.primary || item.active);
  const rest = items.filter((item) => !pinned.includes(item));
  const onBar = [...pinned, ...rest].slice(0, slots - 1);
  return { onBar, overflow: items.filter((item) => !onBar.includes(item)) };
}

function useInjectedStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }, []);
}

/**
 * Marks the document while a bar is on the page. The shell stylesheet hides
 * the sidebar (and with it the phone nav dropdown) on phones only under this
 * class, so an app that renders no task bar keeps its dropdown instead of
 * ending up with no navigation at all — which is exactly what happened to
 * Admin, Reserve, Marketing and Gift Cards when the hide was unconditional.
 */
export const TASKBAR_PRESENT_CLASS = 'has-alma-taskbar';

function useTaskBarPresence(present: boolean) {
  // Layout effect, so the class is on <html> before the first paint: with a
  // plain effect the phone header row shows for a frame and then jumps away.
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !present) return;
    const root = document.documentElement;
    root.classList.add(TASKBAR_PRESENT_CLASS);
    return () => root.classList.remove(TASKBAR_PRESENT_CLASS);
  }, [present]);
}

function ItemLink({
  item,
  onNavigate,
  onAfter
}: {
  item: TaskBarItem;
  onNavigate?: Props['onNavigate'];
  onAfter?: () => void;
}) {
  return (
    <a
      className={`alma-taskbar-item${item.active ? ' is-on' : ''}`}
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      onClick={(event) => {
        onNavigate?.(item, event);
        onAfter?.();
      }}
    >
      {item.icon ? (
        <span className="alma-taskbar-icon" aria-hidden>
          {item.icon}
        </span>
      ) : null}
      <span className="alma-taskbar-label">{item.label}</span>
      {item.badge && item.badge > 0 ? (
        <span className="alma-taskbar-badge">{item.badge > 99 ? '99+' : item.badge}</span>
      ) : null}
    </a>
  );
}

export function TaskBar({ items, onNavigate, label = 'Quick actions' }: Props) {
  useInjectedStyles();
  useTaskBarPresence(items.length > 0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Close the sheet on Escape — it is a layer over the page like any other.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  if (items.length === 0) return null;

  const { onBar, overflow } = splitTaskBarItems(items, SLOTS);

  return (
    <>
      {sheetOpen ? (
        <>
          <button
            type="button"
            className="alma-taskbar-sheet-backdrop"
            aria-label="Close"
            onClick={() => setSheetOpen(false)}
          />
          <div className="alma-taskbar-sheet" ref={sheetRef} role="dialog" aria-label="More actions">
            <div className="alma-taskbar-sheet-grid">
              {overflow.map((item) => (
                <ItemLink key={item.key} item={item} onNavigate={onNavigate} onAfter={() => setSheetOpen(false)} />
              ))}
            </div>
          </div>
        </>
      ) : null}

      <nav className="alma-taskbar" aria-label={label}>
        {onBar.map((item) => (
          <ItemLink key={item.key} item={item} onNavigate={onNavigate} />
        ))}
        {overflow.length > 0 ? (
          <button
            type="button"
            className={`alma-taskbar-item${sheetOpen ? ' is-on' : ''}`}
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            onClick={() => setSheetOpen((open) => !open)}
          >
            <span className="alma-taskbar-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="alma-taskbar-label">More</span>
          </button>
        ) : null}
      </nav>
    </>
  );
}

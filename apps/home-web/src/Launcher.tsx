import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser, StaffClockStatusPayload } from '@alma/shared';
import {
  AlmaAppIcon,
  SUITE_LAUNCHER_GROUPS,
  SuiteNotificationsWidget,
  searchSuiteLauncher,
  suiteLauncherInfo,
  useDismissibleLayer,
  type SuiteAppIdentity
} from '@alma/ui';

/*
 * Alma Home — the launcher a signed-in person lands on.
 *
 * One job: get you into the app you came for in one tap. The app list is the
 * shared suite registry (SUITE_APPS in @alma/ui, filtered by the caller to what
 * this person may open), so the cards here and the topbar switcher inside each
 * app can never disagree about what exists or where it lives.
 */

type ApiClient = <T>(path: string, init?: RequestInit) => Promise<T>;
type AppOpenHandler = (event: MouseEvent<HTMLAnchorElement>, app: SuiteAppIdentity) => void;

const FAVOURITES_KEY = 'alma.home.favourites.v1';

function favouritesKey(userId: string) {
  return `${FAVOURITES_KEY}:${userId}`;
}

// Per person, not per browser: the venue iPad is shared, so one person's pins
// must not become the next person's.
function readFavourites(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(favouritesKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavourites(userId: string, ids: string[]) {
  try {
    window.localStorage.setItem(favouritesKey(userId), JSON.stringify(ids));
  } catch {
    /* private mode — pins just won't outlive the tab */
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function Launcher({
  user,
  apps,
  api,
  clock,
  clockLabel,
  clockStatus,
  busy,
  error,
  theme,
  onToggleTheme,
  onClockToggle,
  onOpenApp,
  onRefresh,
  onSwitchStaff,
  onSignOut,
  tasks,
  overlay
}: {
  user: AuthUser;
  apps: SuiteAppIdentity[];
  api: ApiClient;
  clock: StaffClockStatusPayload | null;
  clockLabel: string;
  clockStatus: string;
  busy: boolean;
  error: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onClockToggle: () => void;
  onOpenApp: AppOpenHandler;
  onRefresh: () => void;
  onSwitchStaff: () => void;
  onSignOut: () => void;
  tasks?: ReactNode;
  overlay?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState<string[]>(() => readFavourites(user.id));
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => setFavourites(readFavourites(user.id)), [user.id]);

  const toggleFavourite = useCallback((appId: string) => {
    setFavourites((current) => {
      const next = current.includes(appId) ? current.filter((id) => id !== appId) : [...current, appId];
      writeFavourites(user.id, next);
      return next;
    });
  }, [user.id]);

  // ⌘K / Ctrl+K (and "/") jump to search from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searching = query.trim().length > 0;
  // Only pins for apps this person can still open count — a pin to an app
  // whose access was since removed simply drops out.
  const pinned = useMemo(
    () => favourites.map((id) => apps.find((app) => app.id === id)).filter((app): app is SuiteAppIdentity => Boolean(app)),
    [apps, favourites]
  );
  const results = useMemo(() => {
    if (!searching) return [];
    return searchSuiteLauncher(apps, query);
  }, [apps, query, searching]);
  const groups = useMemo(
    () =>
      SUITE_LAUNCHER_GROUPS.map((group) => ({
        ...group,
        apps: apps
          .filter((app) => suiteLauncherInfo(app.id).group === group.id && !favourites.includes(app.id))
          .sort((a, b) => suiteLauncherInfo(a.id).order - suiteLauncherInfo(b.id).order)
      })).filter((group) => group.apps.length > 0),
    [apps, favourites]
  );

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setQuery('');
      event.currentTarget.blur();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      gridRef.current?.querySelector<HTMLAnchorElement>('.hl-card__link')?.focus();
    } else if (event.key === 'Enter' && results[0]) {
      event.preventDefault();
      gridRef.current?.querySelector<HTMLAnchorElement>('.hl-card__link')?.click();
    }
  };

  // Arrow keys move to the nearest card in that direction on screen, so the
  // grid drives from a keyboard the way it reads — sections can sit side by
  // side, so DOM order alone would wander.
  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[event.key];
    if (!dir) return;
    const links = Array.from(gridRef.current?.querySelectorAll<HTMLAnchorElement>('.hl-card__link') ?? []);
    const current = document.activeElement as HTMLAnchorElement;
    if (!links.includes(current)) return;
    event.preventDefault();
    const box = (link: HTMLAnchorElement) => link.closest('.hl-card')!.getBoundingClientRect();
    const from = box(current);
    const [dx, dy] = dir as [number, number];
    let best: HTMLAnchorElement | null = null;
    let bestScore = Infinity;
    for (const link of links) {
      if (link === current) continue;
      const to = box(link);
      const along = dx ? (to.left - from.left) * dx : (to.top - from.top) * dy;
      if (along <= 4) continue;
      const across = dx ? Math.abs(to.top - from.top) : Math.abs(to.left - from.left);
      // Stay in the row/column first; distance breaks ties.
      const score = across * 4 + along;
      if (score < bestScore) {
        bestScore = score;
        best = link;
      }
    }
    if (best) best.focus();
    else if (dy === -1) searchRef.current?.focus();
  };

  const first = user.firstName || user.email?.split('@')[0] || 'there';
  const onShift = Boolean(clock?.activeSession);

  const renderGrid = (list: SuiteAppIdentity[]) => (
    <div className="hl-grid">
      {list.map((app) => (
        <AppCard
          key={app.id}
          app={app}
          pinned={favourites.includes(app.id)}
          onOpen={onOpenApp}
          onTogglePin={toggleFavourite}
        />
      ))}
    </div>
  );

  return (
    <div className="hl">
      <header className="hl-top">
        <div className="hl-top__brand">
          <img src="/images/alma-group-logo.png" alt="Alma Group" className="hl-top__logo" />
          <VenueContext user={user} />
        </div>
        <div className="hl-top__actions">
          <button
            type="button"
            className={`hl-clock${onShift ? ' is-on' : ''}`}
            onClick={onClockToggle}
            disabled={busy}
            title={clockStatus}
            aria-label={`${clockLabel}. ${clockStatus}`}
          >
            <span className="hl-clock__dot" aria-hidden="true" />
            <svg className="hl-clock__icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            <span className="hl-clock__text">{busy ? 'Updating…' : clockLabel}</span>
          </button>
          <div className="hl-alerts">
            <SuiteNotificationsWidget api={api} currentApp="home" />
          </div>
          <ProfileMenu
            user={user}
            clockStatus={clockStatus}
            theme={theme}
            busy={busy}
            onToggleTheme={onToggleTheme}
            onRefresh={onRefresh}
            onSwitchStaff={onSwitchStaff}
            onSignOut={onSignOut}
          />
        </div>
      </header>

      <main className="hl-main">
        <div className="hl-intro">
          <p className="hl-intro__eyebrow">Hello, {first}</p>
          <h1 className="hl-intro__title">Your workspace</h1>
          <p className="hl-intro__lede">Everything you need, in one place.</p>
        </div>

        {error ? <div className="hl-error" role="alert">{error}</div> : null}

        <div className="hl-search">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="hl-search__icon">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onSearchKey}
            placeholder="Search apps"
            aria-label="Search apps"
            aria-controls="hl-apps"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <kbd className="hl-search__kbd" aria-hidden="true">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </div>

        <div id="hl-apps" ref={gridRef} className="hl-apps" onKeyDown={onGridKey} aria-live="polite">
          {apps.length === 0 ? (
            <div className="hl-empty">
              <strong>No apps are switched on for you yet.</strong>
              <span>Ask your venue manager to give you access in Alma Staff.</span>
            </div>
          ) : searching ? (
            results.length > 0 ? (
              <section className="hl-section" aria-label="Search results" style={{ '--n': results.length } as React.CSSProperties}>
                <h2 className="hl-section__title">
                  {results.length === 1 ? '1 app' : `${results.length} apps`}
                </h2>
                {renderGrid(results)}
              </section>
            ) : (
              <div className="hl-empty">
                <strong>No app matches “{query.trim()}”.</strong>
                <span>Try a name like Stock, Menus or Staff.</span>
              </div>
            )
          ) : (
            <>
              {pinned.length > 0 ? (
                <section className="hl-section" aria-labelledby="hl-group-pinned" style={{ '--n': pinned.length } as React.CSSProperties}>
                  <h2 id="hl-group-pinned" className="hl-section__title">Pinned</h2>
                  {renderGrid(pinned)}
                </section>
              ) : null}
              {groups.map((group) => (
                <section key={group.id} className="hl-section" aria-labelledby={`hl-group-${group.id}`} style={{ '--n': group.apps.length } as React.CSSProperties}>
                  <h2 id={`hl-group-${group.id}`} className="hl-section__title">{group.label}</h2>
                  {renderGrid(group.apps)}
                </section>
              ))}
            </>
          )}
        </div>

        {tasks}
      </main>

      {overlay}
    </div>
  );
}

function AppCard({
  app,
  pinned,
  onOpen,
  onTogglePin
}: {
  app: SuiteAppIdentity;
  pinned: boolean;
  onOpen: AppOpenHandler;
  onTogglePin: (appId: string) => void;
}) {
  const info = suiteLauncherInfo(app.id);
  return (
    <div className="hl-card" style={{ '--hl-app': app.fromColor } as React.CSSProperties}>
      <AlmaAppIcon
        label={app.label.toUpperCase()}
        colorFrom={app.fromColor}
        colorTo={app.toColor}
        icon={app.icon}
        size={48}
        featureScale={0.62}
        variant="compact"
        showBrandMark={false}
        className="hl-card__icon"
      />
      <a
        className="hl-card__link"
        href={app.href}
        onClick={(event) => {
          // Let ⌘/Ctrl/middle-click open a new tab the browser's own way.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          onOpen(event, app);
        }}
      >
        <span className="hl-card__name">{app.label}</span>
      </a>
      <span className="hl-card__tagline">{info.tagline}</span>
      <button
        type="button"
        className={`hl-card__pin${pinned ? ' is-pinned' : ''}`}
        onClick={() => onTogglePin(app.id)}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${app.label}` : `Pin ${app.label} to the top`}
        title={pinned ? 'Unpin' : 'Pin to top'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      </button>
    </div>
  );
}

/*
 * The venue this session is scoped to. Each app keeps its own venue choice
 * (Stock's sticky venue, the roster's area filter) and none of them reads one
 * from a link, so Home shows the scope rather than offering a picker that
 * would change nothing downstream.
 */
function VenueContext({ user }: { user: AuthUser }) {
  const venue = user.deviceAccount?.venue ?? user.venue;
  const label = !venue || /^(both|all)$/i.test(venue) ? 'All venues' : venue;
  // "St Alma Freshwater" doesn't fit beside three buttons on a phone; the
  // suburb alone is how the team says it anyway.
  const short = label === 'All venues' ? label : label.split(/\s+/).pop() ?? label;
  return (
    <span className="hl-venue" title={`Venue for this session: ${label}`}>
      <span className="hl-venue__dot" aria-hidden="true" />
      <span className="hl-venue__full">{label}</span>
      <span className="hl-venue__short" aria-hidden="true">{short}</span>
    </span>
  );
}

function ProfileMenu({
  user,
  clockStatus,
  theme,
  busy,
  onToggleTheme,
  onRefresh,
  onSwitchStaff,
  onSignOut
}: {
  user: AuthUser;
  clockStatus: string;
  theme: 'light' | 'dark';
  busy: boolean;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onSwitchStaff: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissibleLayer(layerRef, open, close, 'home-profile');
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'Signed in';
  const initials = name.split(/\s+/).filter(Boolean).map((word) => word.charAt(0)).slice(0, 2).join('').toUpperCase();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="hl-profile" ref={layerRef}>
      <button
        type="button"
        className="hl-profile__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${name}`}
      >
        <span className="hl-profile__avatar" aria-hidden="true">{initials}</span>
      </button>
      {open ? (
        <div className="hl-profile__menu" role="menu">
          <div className="hl-profile__who">
            <strong>{name}</strong>
            <span>{user.roleTitle || 'Staff'}{user.venue ? ` · ${user.venue}` : ''}</span>
            <em>{clockStatus}</em>
          </div>
          <button type="button" role="menuitem" onClick={run(onToggleTheme)}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" role="menuitem" onClick={run(onRefresh)} disabled={busy}>Refresh</button>
          <button type="button" role="menuitem" onClick={run(onSwitchStaff)} disabled={busy}>Use another PIN</button>
          <button type="button" role="menuitem" className="is-danger" onClick={run(onSignOut)} disabled={busy}>Sign out</button>
        </div>
      ) : null}
    </div>
  );
}

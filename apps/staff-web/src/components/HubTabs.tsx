import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export type HubTab = {
  to: string;
  label: string;
  /** Exact match only — for a hub's index route so it doesn't stay active on children. */
  end?: boolean;
  icon?: ReactNode;
};

// Roster & pay Turn 2: pages inside a HubLayout can report a pending count for
// their own tab (e.g. Leave → pending requests) without any new API calls —
// the page already loads that data. Outside a HubLayout this is a no-op.
type HubTabBadgeContextValue = {
  badges: Record<string, number>;
  setBadge: (to: string, count: number) => void;
};

const HubTabBadgeContext = createContext<HubTabBadgeContextValue | null>(null);

/** Report a count badge for the hub tab at `to`. Safe to call outside a HubLayout. */
export function useHubTabBadge(to: string, count: number) {
  const setBadge = useContext(HubTabBadgeContext)?.setBadge;
  useEffect(() => {
    if (setBadge) setBadge(to, count);
  }, [setBadge, to, count]);
}

/** Horizontal tab bar for a consolidated hub (e.g. Today → Today / Daily brief / Readiness). */
export function HubTabs({ tabs, label = 'Section tabs' }: { tabs: HubTab[]; label?: string }) {
  const badges = useContext(HubTabBadgeContext)?.badges;
  return (
    <nav className="hub-tabs" aria-label={label}>
      {tabs.map((tab) => {
        const badge = badges?.[tab.to] ?? 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `hub-tab${isActive ? ' is-active' : ''}`}
          >
            {tab.icon ? <span className="hub-tab-icon">{tab.icon}</span> : null}
            <span>{tab.label}</span>
            {badge > 0 ? <span className="hub-tab-badge">{badge > 99 ? '99+' : badge}</span> : null}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Renders the hub tab bar above a page's content without touching the page. */
export function HubLayout({ tabs, children }: { tabs: HubTab[]; children: ReactNode }) {
  const [badges, setBadges] = useState<Record<string, number>>({});
  const setBadge = useCallback((to: string, count: number) => {
    setBadges((current) => (current[to] === count ? current : { ...current, [to]: count }));
  }, []);
  const value = useMemo(() => ({ badges, setBadge }), [badges, setBadge]);
  return (
    <HubTabBadgeContext.Provider value={value}>
      <HubTabs tabs={tabs} />
      {children}
    </HubTabBadgeContext.Provider>
  );
}

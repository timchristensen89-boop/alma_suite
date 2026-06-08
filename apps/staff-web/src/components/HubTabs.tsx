import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export type HubTab = {
  to: string;
  label: string;
  /** Exact match only — for a hub's index route so it doesn't stay active on children. */
  end?: boolean;
  icon?: ReactNode;
};

/** Horizontal tab bar for a consolidated hub (e.g. Today → Today / Daily brief / Readiness). */
export function HubTabs({ tabs, label = 'Section tabs' }: { tabs: HubTab[]; label?: string }) {
  return (
    <nav className="hub-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `hub-tab${isActive ? ' is-active' : ''}`}
        >
          {tab.icon ? <span className="hub-tab-icon">{tab.icon}</span> : null}
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Renders the hub tab bar above a page's content without touching the page. */
export function HubLayout({ tabs, children }: { tabs: HubTab[]; children: ReactNode }) {
  return (
    <>
      <HubTabs tabs={tabs} />
      {children}
    </>
  );
}

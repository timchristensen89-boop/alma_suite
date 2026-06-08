import type { ReactNode } from 'react';
import type { BetaRole } from '../lib/rbac';
import {
  IconChecklist,
  IconDashboard,
  IconHandbook,
  IconIssues,
  IconLicences,
  IconSettings,
  IconStaff
} from '../lib/icons';

// Multi-item groups get a section header; single hub items + the dashboard sit
// headerless, in array order.
export const NAV_SECTIONS = ['Records & expiry'] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
  /** react-router end prop (exact match) */
  end?: boolean;
  minimumRole?: BetaRole;
  section?: NavSection;
  /** Extra route prefixes that light this item up (hub sub-tabs). */
  match?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    description: 'At-a-glance compliance snapshot',
    icon: <IconDashboard />,
    end: true
  },
  {
    // Checks hub: Checklists / Temperatures / Audits as in-page tabs.
    to: '/checklists',
    label: 'Checks',
    description: 'Checklists, temperature logs and audits',
    icon: <IconChecklist />,
    match: ['/temperatures', '/audits']
  },

  {
    // Issues & Incidents hub: Issues + Incidents as in-page tabs.
    to: '/issues',
    label: 'Issues & Incidents',
    description: 'Hazards, defects, follow-through and incident reports',
    icon: <IconIssues />,
    match: ['/incidents']
  },

  // ── Records & expiry ──────────────────────────────────────────────
  {
    to: '/staff',
    label: 'Staff certificates',
    description: 'RSA, first aid, food safety expiry',
    icon: <IconStaff />,
    minimumRole: 'MANAGER',
    section: 'Records & expiry'
  },
  {
    to: '/licences',
    label: 'Licences & approvals',
    description: 'Liquor licences, permits, expiry, conditions',
    icon: <IconLicences />,
    minimumRole: 'MANAGER',
    section: 'Records & expiry'
  },

  {
    to: '/handbook',
    label: 'Handbook',
    description: 'Staff guidance and venue procedures',
    icon: <IconHandbook />
  },
  {
    to: '/admin',
    label: 'Open Alma Admin',
    description: 'Suite setup, access and health — opens the Admin app',
    icon: <IconSettings />,
    minimumRole: 'ADMIN'
  }
];

export function navItemsForRole(user: { role: BetaRole } | null): NavItem[] {
  const rank: Record<BetaRole, number> = { STAFF: 1, MANAGER: 2, ADMIN: 3 };
  const userRank = user ? rank[user.role] : 0;
  return NAV_ITEMS.filter((item) => !item.minimumRole || userRank >= rank[item.minimumRole]);
}

import type { ReactNode } from 'react';
import type { BetaRole } from '../lib/rbac';
import {
  IconAudit,
  IconChecklist,
  IconDashboard,
  IconHandbook,
  IconIncident,
  IconIssues,
  IconLicences,
  IconSettings,
  IconStaff,
  IconTemperature
} from '../lib/icons';

// Top-level nav sections, in display order. Overview sits above them with no
// header (section omitted). Grouping turns a flat 10-item scan into ~5 labelled
// clusters for a time-poor manager mid-service.
export const NAV_SECTIONS = ['Checks', 'Issues & Incidents', 'Records & expiry', 'Handbook', 'Setup'] as const;
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
};

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Overview',
    description: 'At-a-glance compliance snapshot',
    icon: <IconDashboard />,
    end: true
  },

  // ── Checks — the template → run → history family ──────────────────
  {
    to: '/checklists',
    label: 'Checklists',
    description: 'Opening/closing and operational checks',
    icon: <IconChecklist />,
    section: 'Checks'
  },
  {
    to: '/temperatures',
    label: 'Temperatures',
    description: 'Fridges, freezers, cool-room logs',
    icon: <IconTemperature />,
    minimumRole: 'MANAGER',
    section: 'Checks'
  },
  {
    to: '/audits',
    label: 'Audits',
    description: 'Health inspection & internal audits',
    icon: <IconAudit />,
    minimumRole: 'MANAGER',
    section: 'Checks'
  },

  // ── Issues & Incidents — track something that went wrong ──────────
  {
    to: '/issues',
    label: 'Issues',
    description: 'Track hazards, defects, follow-through',
    icon: <IconIssues />,
    section: 'Issues & Incidents'
  },
  {
    to: '/incidents',
    label: 'Incidents',
    description: 'Injury, first aid, near miss reports',
    icon: <IconIncident />,
    section: 'Issues & Incidents'
  },

  // ── Records & expiry — watch these before they lapse ──────────────
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

  // ── Handbook — reference content ──────────────────────────────────
  {
    to: '/handbook',
    label: 'Handbook',
    description: 'Staff guidance and venue procedures',
    icon: <IconHandbook />,
    section: 'Handbook'
  },

  // ── Setup — off-app admin ─────────────────────────────────────────
  {
    to: '/admin',
    label: 'Open Alma Admin',
    description: 'Suite setup, access and health — opens the Admin app',
    icon: <IconSettings />,
    minimumRole: 'ADMIN',
    section: 'Setup'
  }
];

export function navItemsForRole(user: { role: BetaRole } | null): NavItem[] {
  const rank: Record<BetaRole, number> = { STAFF: 1, MANAGER: 2, ADMIN: 3 };
  const userRank = user ? rank[user.role] : 0;
  return NAV_ITEMS.filter((item) => !item.minimumRole || userRank >= rank[item.minimumRole]);
}

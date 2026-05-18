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

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
  /** react-router end prop (exact match) */
  end?: boolean;
  minimumRole?: BetaRole;
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
    to: '/issues',
    label: 'Issues',
    description: 'Track hazards, defects, follow-through',
    icon: <IconIssues />
  },
  {
    to: '/checklists',
    label: 'Checklists',
    description: 'Operational checks and runs',
    icon: <IconChecklist />
  },
  {
    to: '/staff',
    label: 'Staff',
    description: 'RSA, first aid, food safety records',
    icon: <IconStaff />,
    minimumRole: 'MANAGER'
  },
  {
    to: '/temperatures',
    label: 'Temperatures',
    description: 'Fridges, freezers, cool-room logs',
    icon: <IconTemperature />,
    minimumRole: 'MANAGER'
  },
  {
    to: '/licences',
    label: 'Licences',
    description: 'Venue approvals, permits, expiry, conditions',
    icon: <IconLicences />,
    minimumRole: 'MANAGER'
  },
  {
    to: '/incidents',
    label: 'Incidents',
    description: 'Injury, first aid, near miss reports',
    icon: <IconIncident />
  },
  {
    to: '/audits',
    label: 'Audits',
    description: 'Health inspection & internal audits',
    icon: <IconAudit />,
    minimumRole: 'MANAGER'
  },
  {
    to: '/handbook',
    label: 'Handbook',
    description: 'Staff guidance and venue procedures',
    icon: <IconHandbook />
  },
  {
    to: '/admin',
    label: 'Admin',
    description: 'Suite setup, access and health',
    icon: <IconSettings />,
    minimumRole: 'ADMIN'
  }
];

export function navItemsForRole(user: { role: BetaRole } | null): NavItem[] {
  const rank: Record<BetaRole, number> = { STAFF: 1, MANAGER: 2, ADMIN: 3 };
  const userRank = user ? rank[user.role] : 0;
  return NAV_ITEMS.filter((item) => !item.minimumRole || userRank >= rank[item.minimumRole]);
}

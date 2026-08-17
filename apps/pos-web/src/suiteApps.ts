// Where the rest of the suite lives, for the register's app switcher.
// Production URLs are baked in — the till builds don't carry per-app env —
// but a VITE_*_WEB_URL set at build time still wins, matching the other
// suite apps' convention.
const url = (name: string, fallback: string) =>
  (((import.meta.env as Record<string, string | undefined>)[name] ?? '') || fallback).replace(/\/+$/, '');

export type SuiteAppLink = { id: string; label: string; hint: string; href: string };

export const SUITE_APP_LINKS: SuiteAppLink[] = [
  { id: 'staff', label: 'Staff', hint: 'Roster, timesheets, pay', href: url('VITE_STAFF_WEB_URL', 'https://alma-staff.web.app') },
  { id: 'stock', label: 'Stock', hint: 'Inventory, orders, invoices', href: url('VITE_STOCK_WEB_URL', 'https://alma-stock-v18.web.app') },
  { id: 'giftcards', label: 'Gift cards', hint: 'Balance check and redeem', href: `${url('VITE_GIFTCARDS_WEB_URL', 'https://alma-giftcards.web.app')}/redeem` },
  { id: 'reserve', label: 'Reserve', hint: 'Bookings and the floor', href: url('VITE_RESERVE_WEB_URL', 'https://alma-reserve.web.app') },
  { id: 'compliance', label: 'Compliance', hint: 'Food safety and audits', href: url('VITE_COMPLIANCE_WEB_URL', 'https://alma-compliance.web.app') },
  { id: 'reports', label: 'Reports', hint: 'Dashboards and exports', href: url('VITE_REPORTS_WEB_URL', 'https://alma-reports.web.app') },
  { id: 'marketing', label: 'Marketing', hint: 'Guests, campaigns, socials', href: url('VITE_MARKETING_WEB_URL', 'https://alma-marketing.web.app') },
  { id: 'admin', label: 'Admin', hint: 'Suite settings and integrations', href: url('VITE_SETTINGS_WEB_URL', 'https://alma-suite-admin.web.app') }
];

// The register's own sibling surfaces — same app, different hash, and
// main.tsx reloads on hashchange so plain assignment is the navigation.
export const POS_SURFACES: Array<{ id: string; label: string; hint: string; hash: string }> = [
  { id: 'office', label: 'Office', hint: 'Menus, tables, QRs, settings', hash: '#office' },
  { id: 'kds', label: 'Kitchen screen', hint: 'The KDS for the pass', hash: '#kds' },
  { id: 'live', label: 'Live board', hint: 'Tonight at a glance', hash: '#live' }
];

import type { ReactNode } from 'react';
import {
  IconDashboard,
  IconInvoices,
  IconItems,
  IconRecipes,
  IconSettings,
  IconSquare,
  IconStocktake
} from '../lib/icons';
import { SETTINGS_WEB_URL } from './suiteLinks';

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
  end?: boolean;
  /** Extra route prefixes that should light this item up (hub sub-tabs). */
  match?: string[];
  externalHref?: string;
  /** Opens another app (not an in-app route). Marked + guarded in the nav. */
  external?: boolean;
};

const adminBaseUrl = SETTINGS_WEB_URL.replace(/\/+$/, '');

// Phase 2 IA: hubs collapse related pages into tabbed sections, so the sidebar
// is a short flat list. Stock count / Purchasing / Recipes each open a hub with
// in-page tabs; `match` keeps the sidebar item highlighted across those tabs.
export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    description: 'At-a-glance stock snapshot',
    icon: <IconDashboard />,
    end: true
  },
  {
    to: '/stocktake',
    label: 'Stock count',
    description: 'Stocktakes, wastage, staff usage and transfers',
    icon: <IconStocktake />,
    match: ['/stocktake-templates', '/wastage', '/staff-usage', '/transfers']
  },
  {
    to: '/items',
    label: 'Items',
    description: 'Catalogue, categories, pars and below-par list',
    icon: <IconItems />,
    match: ['/reorder']
  },
  {
    to: '/invoices',
    label: 'Purchasing',
    description: 'Invoices, purchase orders, deliveries, suppliers and price changes',
    icon: <IconInvoices />,
    match: ['/purchase-orders', '/deliveries', '/suppliers', '/price-movement']
  },
  {
    to: '/recipes',
    label: 'Recipes',
    description: 'Menu items, prep recipes and margins',
    icon: <IconRecipes />,
    // /recipes/prep and /recipes/margins are covered by the /recipes prefix.
    match: ['/production-recipes', '/dish-margins']
  },
  {
    to: '/settings',
    label: 'Setup',
    description: 'Categories and setup controls',
    icon: <IconSettings />
  },
  {
    to: '/square-products',
    label: 'Square menu mapping',
    description: 'Map Square menu items to Alma recipes (opens Admin)',
    icon: <IconSquare />,
    external: true,
    externalHref: adminBaseUrl ? `${adminBaseUrl}/integrations/square/menu-mapping` : undefined
  }
];

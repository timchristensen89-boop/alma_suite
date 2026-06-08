import type { ReactNode } from 'react';
import {
  IconDashboard,
  IconDeliveries,
  IconInvoices,
  IconItems,
  IconMargins,
  IconPrep,
  IconPriceChange,
  IconRecipes,
  IconReorder,
  IconSettings,
  IconSquare,
  IconStocktake,
  IconSuppliers,
  IconTransfer,
  IconWastage
} from '../lib/icons';
import { SETTINGS_WEB_URL } from './suiteLinks';

// Top-level nav sections, in display order. The Dashboard sits above all of
// them with no header (section omitted). Everything else is grouped so a
// time-poor manager scans 5 labelled groups instead of 15 flat links.
export const NAV_SECTIONS = ['Stock count', 'Catalogue', 'Purchasing', 'Recipes', 'Setup'] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
  section?: NavSection;
  end?: boolean;
  externalHref?: string;
  /** Opens another app (not an in-app route). Marked + guarded in the nav. */
  external?: boolean;
};

const adminBaseUrl = SETTINGS_WEB_URL.replace(/\/+$/, '');

export const NAV_ITEMS: NavItem[] = [
  // ── Overview (headerless, top of nav) ──────────────────────────────
  {
    to: '/',
    label: 'Dashboard',
    description: 'At-a-glance stock snapshot',
    icon: <IconDashboard />,
    end: true
  },

  // ── Stock count — anything that adjusts venue on-hand ──────────────
  {
    to: '/stocktake',
    label: 'Stocktakes',
    description: 'Periodic counts and variance',
    icon: <IconStocktake />,
    section: 'Stock count'
  },
  {
    to: '/wastage',
    label: 'Wastage',
    description: 'Record broken, spoiled or expired stock',
    icon: <IconWastage />,
    section: 'Stock count'
  },
  {
    to: '/transfers',
    label: 'Transfers',
    description: 'Move stock between venues',
    icon: <IconTransfer />,
    section: 'Stock count'
  },

  // ── Catalogue — the product list and what to reorder ──────────────
  {
    to: '/items',
    label: 'Items',
    description: 'Product catalogue, categories, pars',
    icon: <IconItems />,
    section: 'Catalogue'
  },
  {
    to: '/reorder',
    label: 'Below par',
    description: 'Items under par that need reordering',
    icon: <IconReorder />,
    section: 'Catalogue'
  },

  // ── Purchasing — supplier bills, receiving and cost changes ───────
  {
    to: '/invoices',
    label: 'Invoices',
    description: 'Xero bills, supplier invoices and item matching',
    icon: <IconInvoices />,
    section: 'Purchasing'
  },
  {
    to: '/deliveries',
    label: 'Deliveries',
    description: 'Check off stock as it arrives',
    icon: <IconDeliveries />,
    section: 'Purchasing'
  },
  {
    to: '/suppliers',
    label: 'Suppliers',
    description: 'Vendors and account details',
    icon: <IconSuppliers />,
    section: 'Purchasing'
  },
  {
    to: '/price-movement',
    label: 'Supplier price changes',
    description: 'Supplier unit-cost changes over the last 30 days',
    icon: <IconPriceChange />,
    section: 'Purchasing'
  },

  // ── Recipes — menu costing, prep batches and margins ──────────────
  {
    to: '/recipes',
    label: 'Menu items',
    description: 'Menu item recipes and cost checks',
    icon: <IconRecipes />,
    section: 'Recipes'
  },
  {
    to: '/production-recipes',
    label: 'Prep recipes',
    description: 'Prep batches, sauces and reusable components',
    icon: <IconPrep />,
    section: 'Recipes'
  },
  {
    to: '/dish-margins',
    label: 'Dish margins',
    description: 'Recipe cost vs sell price with margin health',
    icon: <IconMargins />,
    section: 'Recipes'
  },

  // ── Setup — infrequent config + off-app jumps ─────────────────────
  {
    to: '/square-products',
    label: 'Square menu mapping',
    description: 'Map Square menu items to Alma recipes (opens Admin)',
    icon: <IconSquare />,
    section: 'Setup',
    external: true,
    externalHref: adminBaseUrl ? `${adminBaseUrl}/integrations/square/menu-mapping` : undefined
  },
  {
    to: '/settings',
    label: 'Setup',
    description: 'Categories and setup controls',
    icon: <IconSettings />,
    section: 'Setup'
  }
];

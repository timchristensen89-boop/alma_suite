import type { ReactNode } from 'react';
import {
  IconDashboard,
  IconInvoices,
  IconItems,
  IconRecipes,
  IconSettings,
  IconStocktake,
  IconSuppliers
} from '../lib/icons';
import { SETTINGS_WEB_URL } from './suiteLinks';

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
  end?: boolean;
  externalHref?: string;
};

const adminBaseUrl = SETTINGS_WEB_URL.replace(/\/+$/, '');

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    description: 'At-a-glance stock snapshot',
    icon: <IconDashboard />,
    end: true
  },
  {
    to: '/items',
    label: 'Items',
    description: 'Product catalogue, categories, pars',
    icon: <IconItems />
  },
  {
    to: '/stocktake',
    label: 'Stocktakes',
    description: 'Periodic counts and variance',
    icon: <IconStocktake />
  },
  {
    to: '/suppliers',
    label: 'Suppliers',
    description: 'Vendors and account details',
    icon: <IconSuppliers />
  },
  {
    to: '/invoices',
    label: 'Invoices',
    description: 'Xero bills, ripped invoices and item matching',
    icon: <IconInvoices />
  },
  {
    to: '/deliveries',
    label: 'Deliveries',
    description: 'Invoice checklists when stock arrives',
    icon: <IconInvoices />
  },
  {
    to: '/wastage',
    label: 'Wastage',
    description: 'Record broken, spoiled or expired stock',
    icon: <IconStocktake />
  },
  {
    to: '/reorder',
    label: 'Reorder',
    description: 'Below-par notices and reorder actions',
    icon: <IconItems />
  },
  {
    to: '/recipes',
    label: 'Item Recipes',
    description: 'Menu item ingredients and cost checks',
    icon: <IconRecipes />
  },
  {
    to: '/dish-margins',
    label: 'Dish margins',
    description: 'Recipe cost vs sell price with RAG status',
    icon: <IconRecipes />
  },
  {
    to: '/production-recipes',
    label: 'Production Recipes',
    description: 'Prep batches, sauces and reusable components',
    icon: <IconRecipes />
  },
  {
    to: '/square-products',
    label: 'Square products',
    description: 'Map Square menu items to Alma recipes',
    icon: <IconItems />,
    externalHref: adminBaseUrl ? `${adminBaseUrl}/integrations/square/menu-mapping` : undefined
  },
  {
    to: '/settings',
    label: 'Admin setup',
    description: 'Categories and setup controls',
    icon: <IconSettings />
  }
];

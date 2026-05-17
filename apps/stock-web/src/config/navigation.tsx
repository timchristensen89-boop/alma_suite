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

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
  end?: boolean;
};

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
    to: '/recipes',
    label: 'Item Recipes',
    description: 'Menu item ingredients and cost checks',
    icon: <IconRecipes />
  },
  {
    to: '/production-recipes',
    label: 'Production Recipes',
    description: 'Prep batches, sauces and reusable components',
    icon: <IconRecipes />
  },
  {
    to: '/settings',
    label: 'Admin setup',
    description: 'Categories and setup controls',
    icon: <IconSettings />
  }
];

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest
  };
}

export const IconDashboard = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

/** Transfers — two opposing arrows for moving stock between venues. */
export const IconTransfer = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 8h13" />
    <path d="M14 5l3 3-3 3" />
    <path d="M20 16H7" />
    <path d="M10 13l-3 3 3 3" />
  </svg>
);

/** Items — an open storage box, stylised so it reads even at small sizes. */
export const IconItems = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 7l9-4 9 4-9 4-9-4z" />
    <path d="M3 7v10l9 4 9-4V7" />
    <path d="M12 11v10" />
  </svg>
);

/** Stocktake — clipboard with a tick. */
export const IconStocktake = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 3h6v3H9z" />
    <path d="M8.5 13l2 2 4-4" />
  </svg>
);

/** Suppliers — delivery truck. */
export const IconSuppliers = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 6h11v10H3z" />
    <path d="M14 9h4l3 3v4h-7" />
    <circle cx="7" cy="18" r="1.8" />
    <circle cx="17" cy="18" r="1.8" />
  </svg>
);

/** Invoices — receipt with scan lines for Xero imports and supplier bills. */
export const IconInvoices = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21V3z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h3" />
  </svg>
);

/** Recipes — stacked plates / wine glass hybrid — two layered ovals + a base. */
export const IconRecipes = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 9a7 3 0 0 0 14 0" />
    <path d="M5 9a7 3 0 0 1 14 0" />
    <path d="M8 10v4a4 4 0 0 0 8 0v-4" />
    <path d="M12 18v2" />
    <path d="M9 20h6" />
  </svg>
);

/** External link — used on the "back to Compliance" footer action. */
export const IconExternal = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M14 4h6v6" />
    <path d="M20 4L10 14" />
    <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
  </svg>
);

export const IconChevronDown = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconSettings = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

/** Wastage — a waste bin, for broken/spoiled stock. */
export const IconWastage = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

/** Reorder — circular arrows for replenishment. */
export const IconReorder = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 4v5h-5" />
  </svg>
);

/** Deliveries — a box with an inbound (down) arrow for goods-in. */
export const IconDeliveries = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 9l9-5 9 5v6l-9 5-9-5V9z" />
    <path d="M3 9l9 5 9-5" />
    <path d="M12 3v6" />
  </svg>
);

/** Margins — a pie slice / percentage read for cost vs sell. */
export const IconMargins = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v9l6.5 6.5" />
    <circle cx="8.5" cy="8.5" r="0.6" fill="currentColor" />
    <circle cx="15.5" cy="15.5" r="0.6" fill="currentColor" />
  </svg>
);

/** Supplier price changes — a trend line with an up tick. */
export const IconPriceChange = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 17l5-5 4 4 5-7" />
    <path d="M17 9h4v4" />
  </svg>
);

/** Prep / production recipes — a cooking pot. */
export const IconPrep = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 10h16v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-4z" />
    <path d="M2 10h20" />
    <path d="M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" />
  </svg>
);

/** Square menu mapping — a four-cell grid (Square POS). */
export const IconSquare = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);

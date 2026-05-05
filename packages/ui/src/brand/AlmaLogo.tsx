import type { ReactNode, SVGProps } from 'react';
import { useId } from 'react';
import { ALMA_A_PATH } from './AlmaAppIcon';

/**
 * The Alma Suite app icons — single source of truth for tile rendering.
 *
 * The design is fixed by the brand spec:
 *   - 220 viewBox, rx=44 corners
 *   - Linear gradient fill (top-left → bottom-right)
 *   - Soft radial highlight in the upper-left
 *   - 1.5px white border at 0.1 alpha
 *   - Micro line icon in the top-left (translate 22,20, scale 1.55)
 *   - White rounded "a" mark in the centre (using ALMA_A_PATH)
 *   - "ALMA" wordmark + per-app label at the bottom (only in AlmaWordmark)
 *
 * Two surfaces:
 *   - `AlmaLogo`     — icon-only tile (no wordmark, header / sidebar default)
 *   - `AlmaWordmark` — full tile with ALMA + module name (login screens, app
 *                     switchers, splash views, anywhere readable at >=80px)
 *
 * Legacy exports `AlmaMark` and `AlmaLetterA` are preserved as thin
 * compatibility aliases so existing call-sites keep compiling.
 */

export type AlmaApp =
  | 'compliance'
  | 'stocktake'
  | 'reports'
  | 'staff'
  | 'policies'
  | 'roster'
  | 'recipes'
  | 'forecasting'
  | 'academy'
  | 'finance'
  | 'menu'
  | 'bookings'
  | 'control';

type GradientStops = { from: string; to: string };

export const ALMA_APP_COLOURS: Record<AlmaApp, GradientStops> = {
  compliance: { from: '#B3262E', to: '#6B2424' },
  stocktake: { from: '#1a6e34', to: '#0e4820' },
  reports: { from: '#D7DCE2', to: '#7E8792' },
  staff: { from: '#244C9F', to: '#102E69' },
  policies: { from: '#244C9F', to: '#102E69' },
  roster: { from: '#6b32cc', to: '#4a1e96' },
  recipes: { from: '#d4620a', to: '#9e4608' },
  forecasting: { from: '#0a5a9c', to: '#073a70' },
  academy: { from: '#8a7210', to: '#5e4e08' },
  finance: { from: '#1a6a6a', to: '#0e4444' },
  menu: { from: '#8a1848', to: '#5c0e30' },
  bookings: { from: '#1e5080', to: '#122e50' },
  control: { from: '#253326', to: '#141c15' }
};

export const ALMA_APP_LABELS: Record<AlmaApp, string> = {
  compliance: 'COMPLIANCE',
  stocktake: 'STOCKTAKE',
  reports: 'REPORTS',
  staff: 'STAFF',
  policies: 'POLICIES',
  roster: 'ROSTER',
  recipes: 'RECIPES',
  forecasting: 'FORECASTING',
  academy: 'ACADEMY',
  finance: 'FINANCE',
  menu: 'MENU',
  bookings: 'BOOKINGS',
  control: 'CONTROL'
};

/**
 * Per-app micro icon, drawn on a 22×22 grid (matches the spec's
 * `translate(22, 20) scale(1.55)` pre-transform). Stroke is 1.7 / white;
 * each shape is intentionally simple so it remains readable at 32px.
 */
const APP_MICRO_ICONS: Record<AlmaApp, ReactNode> = {
  compliance: (
    <>
      <path
        d="M9 0 L19 4 L19 11 C19 16 14 20 9 22 C4 20 0 16 0 11 L0 4 Z"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <polyline
        points="5,11 8,15 14,8"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  stocktake: (
    <>
      <path
        d="M10 0 L21 5 L21 17 L10 22 L0 17 L0 5 Z"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <polyline
        points="0,5 10,10 21,5"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <line x1="10" y1="10" x2="10" y2="22" stroke="white" strokeWidth="1.7" />
    </>
  ),
  reports: (
    <>
      <rect x="0" y="12" width="5" height="8" rx="1" fill="white" opacity="0.55" />
      <rect x="7" y="7" width="5" height="13" rx="1" fill="white" opacity="0.8" />
      <rect x="14" y="1" width="5" height="19" rx="1" fill="white" />
    </>
  ),
  staff: (
    <>
      <circle cx="8" cy="6" r="4" fill="none" stroke="white" strokeWidth="1.7" />
      <path
        d="M0 21 C0 15 3 12 8 12 C13 12 16 15 16 21"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="17" cy="5" r="3" fill="none" stroke="white" strokeWidth="1.4" opacity="0.65" />
      <path
        d="M14 19 C14 15 16 13 20 13"
        fill="none"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.65"
      />
    </>
  ),
  policies: (
    <>
      <rect x="1" y="0" width="16" height="20" rx="2" fill="none" stroke="white" strokeWidth="1.7" />
      <polyline points="12,0 12,6 17,6" fill="none" stroke="white" strokeWidth="1.7" />
      <line x1="4" y1="10" x2="14" y2="10" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="4" y1="14" x2="11" y2="14" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  roster: (
    <>
      <circle cx="8" cy="6" r="4" fill="none" stroke="white" strokeWidth="1.7" />
      <path
        d="M0 21 C0 15 3 12 8 12 C13 12 16 15 16 21"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="17" cy="5" r="3" fill="none" stroke="white" strokeWidth="1.4" opacity="0.65" />
      <path
        d="M14 19 C14 15 16 13 20 13"
        fill="none"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.65"
      />
    </>
  ),
  recipes: (
    <>
      <path
        d="M2 1 L2 21 Q2 23 4 23 L20 23 L20 1 Q20 0 18 0 L4 0 Q2 0 2 1 Z"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
      />
      <line x1="2" y1="18" x2="20" y2="18" stroke="white" strokeWidth="1.7" />
      <line
        x1="6"
        y1="7"
        x2="14"
        y2="7"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
      <line
        x1="6"
        y1="11"
        x2="14"
        y2="11"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
    </>
  ),
  forecasting: (
    <>
      <polyline
        points="0,18 5,12 10,15 16,6 21,9"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="15,3 21,3 21,9"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="0" y1="22" x2="22" y2="22" stroke="white" strokeWidth="1.1" opacity="0.35" />
    </>
  ),
  academy: (
    <>
      <polygon
        points="10,0 22,6 10,12 0,6"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M4 9 L4 17 C4 17 7 22 10 22 C13 22 17 17 17 17 L17 9"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="6"
        x2="22"
        y2="14"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.65"
      />
    </>
  ),
  finance: (
    <>
      <circle cx="10" cy="11" r="9" fill="none" stroke="white" strokeWidth="1.7" />
      <line x1="10" y1="2" x2="10" y2="20" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M6 16 Q10 18 14 16 Q18 14 14 11 Q10 8 6 6 Q2 4 6 2 Q10 0 14 2"
        fill="none"
        stroke="white"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
  menu: (
    <>
      <line x1="7" y1="0" x2="7" y2="10" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M3 0 L3 7 Q3 11 7 11 Q11 11 11 7 L11 0"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <line x1="7" y1="11" x2="7" y2="24" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="17" y1="0" x2="17" y2="24" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M13 0 C13 0 13 8 17 11 C21 8 21 0 21 0"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  bookings: (
    <>
      <rect x="0" y="3" width="22" height="19" rx="2" fill="none" stroke="white" strokeWidth="1.7" />
      <line x1="0" y1="9" x2="22" y2="9" stroke="white" strokeWidth="1.7" />
      <line x1="6" y1="0" x2="6" y2="6" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="15" y1="0" x2="15" y2="6" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="6" cy="15" r="1.4" fill="white" />
      <circle cx="11" cy="15" r="1.4" fill="white" />
      <circle cx="16" cy="15" r="1.4" fill="white" />
    </>
  ),
  control: (
    <>
      <polyline
        points="0,11 11,1 22,11"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="3,9 3,22 19,22 19,9"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="8" y="14" width="6" height="8" rx="1" fill="none" stroke="white" strokeWidth="1.5" />
    </>
  )
};

type TileProps = {
  app: AlmaApp;
  size?: number;
  className?: string;
  /** Render the ALMA + module name wordmark at the bottom of the tile. */
  withWordmark?: boolean;
  /** Hide the per-app micro line icon in the top-left. */
  hideMicroIcon?: boolean;
};

function AlmaTile({
  app,
  size = 40,
  className,
  withWordmark = false,
  hideMicroIcon = false
}: TileProps) {
  const { from, to } = ALMA_APP_COLOURS[app];
  const label = ALMA_APP_LABELS[app];
  // useId guarantees uniqueness when many tiles render on one page
  // (login screen, app switcher) without colliding gradient ids.
  const reactId = useId().replace(/:/g, '');
  const gradId = `alma-grad-${app}-${reactId}`;
  const highlightId = `alma-highlight-${app}-${reactId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label={`Alma ${label.toLowerCase()}`}
      role="img"
    >
      <defs>
        <linearGradient id={gradId} x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <radialGradient id={highlightId} cx="30%" cy="18%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0.16" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="220" height="220" rx="44" ry="44" fill={`url(#${gradId})`} />
      <rect width="220" height="220" rx="44" ry="44" fill={`url(#${highlightId})`} />
      <rect
        x="1.5"
        y="1.5"
        width="217"
        height="217"
        rx="43"
        ry="43"
        fill="none"
        stroke="white"
        strokeOpacity="0.1"
        strokeWidth="1.5"
      />

      {hideMicroIcon ? null : (
        <g transform="translate(22, 20) scale(1.55)">{APP_MICRO_ICONS[app]}</g>
      )}

      {/* White "a" mark — same shape as the brand asset, kept as inline SVG
          so it renders crisp at every size from 16px favicons to 1024px
          tile exports. The transform centres it inside the 220 viewBox in
          the same place as the spec's <image> element (60,44 → 160,146). */}
      <g
        transform="translate(60, 44) scale(2.125)"
        fill="white"
        fillRule="evenodd"
        clipRule="evenodd"
      >
        <path d={ALMA_A_PATH} />
      </g>

      {withWordmark ? (
        <>
          <text
            x="110"
            y="180"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontWeight={900}
            fontSize="28"
            letterSpacing="6"
            fill="white"
          >
            ALMA
          </text>
          <text
            x="110"
            y="199"
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontWeight={400}
            fontSize="12"
            letterSpacing="3"
            fill="white"
            fillOpacity="0.88"
          >
            {label}
          </text>
        </>
      ) : null}
    </svg>
  );
}

interface AlmaLogoProps {
  app: AlmaApp;
  /** Height in px — width scales to match. Default 40. */
  size?: number;
  className?: string;
}

/**
 * Icon-only Alma tile (no wordmark). Prefer this in headers, sidebars,
 * and anywhere the tile renders smaller than ~80px.
 */
export function AlmaLogo({ app, size = 40, className }: AlmaLogoProps) {
  return <AlmaTile app={app} size={size} className={className} />;
}

interface AlmaWordmarkProps {
  app: AlmaApp;
  /** Height in px — width scales to match. Default 96. */
  size?: number;
  className?: string;
}

/**
 * Full Alma tile with ALMA + module name wordmark.
 *
 * Best for places where the tile carries the entire brand on its own —
 * login screens, splash views, app switchers above ~80px, marketing
 * surfaces. Use `AlmaLogo` for tight nav contexts.
 */
export function AlmaWordmark({ app, size = 96, className }: AlmaWordmarkProps) {
  return <AlmaTile app={app} size={size} className={className} withWordmark />;
}

/* ------------------------------------------------------------------- */
/* Legacy compatibility surface                                         */
/* ------------------------------------------------------------------- */

type AlmaMarkLegacyProps = SVGProps<SVGSVGElement> & {
  title?: string;
  fromColor?: string;
  toColor?: string;
  gradientId?: string;
};

/**
 * Legacy `AlmaMark` API — preserved so existing consumers (mostly the
 * compliance + stocktake app shells before the rebrand) keep compiling.
 *
 * It now renders the new tile shape using either an explicit fromColor /
 * toColor pair, or the compliance default if none was given. If you're
 * starting fresh, prefer `AlmaLogo` / `AlmaWordmark` keyed by `app`.
 */
export function AlmaMark({
  title = 'ALMA Suites',
  fromColor,
  toColor,
  gradientId = 'default',
  ...rest
}: AlmaMarkLegacyProps) {
  const reactId = useId().replace(/:/g, '');
  const id = `alma-mark-bg-${gradientId}-${reactId}`;
  const highlightId = `alma-mark-hl-${gradientId}-${reactId}`;
  const from = fromColor ?? ALMA_APP_COLOURS.compliance.from;
  const to = toColor ?? ALMA_APP_COLOURS.compliance.to;

  return (
    <svg
      viewBox="0 0 220 220"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      width="100%"
      height="100%"
      {...rest}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={id} x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <radialGradient id={highlightId} cx="30%" cy="18%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0.16" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="220" height="220" rx="44" ry="44" fill={`url(#${id})`} />
      <rect width="220" height="220" rx="44" ry="44" fill={`url(#${highlightId})`} />
      <g
        transform="translate(60, 44) scale(2.125)"
        fill="white"
        fillRule="evenodd"
        clipRule="evenodd"
      >
        <path d={ALMA_A_PATH} />
      </g>
    </svg>
  );
}

/** Legacy alias retained for any consumer that imported just the path. */
export function AlmaLetterA(props: SVGProps<SVGPathElement>) {
  return <path {...props} fillRule="evenodd" clipRule="evenodd" d={ALMA_A_PATH} />;
}

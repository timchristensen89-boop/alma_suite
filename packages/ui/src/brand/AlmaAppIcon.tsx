import { isValidElement, cloneElement } from 'react';
import type { CSSProperties, ReactElement, ReactNode, SVGProps } from 'react';

/**
 * Shared rounded "a" mark used across every ALMA product icon.
 * Drawn inside a 48x48 viewBox so it can be reused at any size,
 * including from the canvas exporter (see `ALMA_A_CANVAS_PATH` for the
 * 1024-anchored variant — they describe the same shape).
 */
export const ALMA_A_PATH = `
  M24 9.55
  C14.25 9.55 6.9 16.05 6.9 24
  C6.9 31.95 14.25 38.45 24 38.45
  C28.55 38.45 32.35 36.95 34.92 34.25
  C37.22 36.75 40.15 38.05 43.62 37.82
  L43.62 24
  C43.62 16.05 36.88 9.55 24 9.55
  Z
  M24 15.35
  C29.72 15.35 34.08 18.92 34.08 24
  C34.08 29.08 29.72 32.65 24 32.65
  C18.28 32.65 13.92 29.08 13.92 24
  C13.92 18.92 18.28 15.35 24 15.35
  Z
`;

export const ALMA_A_MARK_SRC = '/brand/alma-a-mark.png';

export type AlmaAppIconKey =
  | 'book'
  | 'chart'
  | 'document'
  | 'shield'
  | 'warning'
  | 'search'
  | 'cap'
  | 'produce'
  | 'people'
  | 'gear';

export type AlmaAppDefinition = {
  id: string;
  label: string;
  from: string;
  to: string;
  iconKey: AlmaAppIconKey;
  icon: ReactNode;
};

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

type AlmaAppIconProps = {
  label: string;
  colorFrom: string;
  colorTo: string;
  icon?: ReactNode;
  size?: number;
  className?: string;
  featureScale?: number;
  /**
   * `full` (default) renders the complete app tile: micro icon at the top,
   * white "a" mark in the centre, and "ALMA <NAME>" wordmark at the bottom.
   * `compact` hides the wordmark and lifts the per-app icon to be the
   * dominant centred element. Use it for switcher chips and any tile
   * smaller than ~80px where the wordmark would be unreadable.
   */
  variant?: 'full' | 'compact';
  showBrandMark?: boolean;
};

function IconBase({ children, size = 22, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const STROKE: SVGProps<SVGPathElement> = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none'
};

export function BookIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5.5c2.4-1.1 4.7-1.1 7 0v13c-2.3-1.1-4.6-1.1-7 0v-13Z" {...STROKE} />
      <path d="M13 5.5c2.3-1.1 4.6-1.1 7 0v13c-2.4-1.1-4.7-1.1-7 0v-13Z" {...STROKE} />
      <path d="M12 6v13" {...STROKE} />
    </IconBase>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 19V11" {...STROKE} />
      <path d="M12 19V5" {...STROKE} />
      <path d="M19 19V8" {...STROKE} />
      <path d="M4 19h16" {...STROKE} />
    </IconBase>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h8l4 4v14H6V3Z" {...STROKE} />
      <path d="M14 3v5h4" {...STROKE} />
      <path d="M9 12h6" {...STROKE} />
      <path d="M9 16h5" {...STROKE} />
    </IconBase>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5c2.2 1.6 4.5 2.4 7 2.6v5.4c0 4.1-2.4 7.1-7 9-4.6-1.9-7-4.9-7-9V6.1c2.5-.2 4.8-1 7-2.6Z" {...STROKE} />
      <path d="m8.7 12 2.2 2.2 4.7-5" {...STROKE} />
    </IconBase>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4 21 20H3L12 4Z" {...STROKE} />
      <path d="M12 9v5" {...STROKE} />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" {...STROKE} />
      <path d="M16 16l5 5" {...STROKE} />
    </IconBase>
  );
}

export function CapIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" {...STROKE} />
      <path d="M7 11v5c3.2 2 6.8 2 10 0v-5" {...STROKE} />
      <path d="M21 9v6" {...STROKE} />
    </IconBase>
  );
}

export function ProduceIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.2 8.2c-4.2-.4-7.1 2.4-7.1 6.2 0 3.5 2.7 6.1 6.4 6.1 4 0 6.8-3 6.4-7.2-.2-2.8-2.3-4.8-5.7-5.1Z" {...STROKE} />
      <path d="M12.2 8.2c-.2-2.4.9-4.3 3.1-5.5 1.1 2.4.3 4.5-2.1 6" {...STROKE} />
      <path d="M10.7 8.6c-1.3-2-3.2-2.8-5.6-2.2 1.1 2.3 3 3.4 5.6 3.3" {...STROKE} />
    </IconBase>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3.4" stroke="currentColor" strokeWidth={1.6} fill="none" />
      <path d="M3.5 20c.4-4 2.5-6.4 5.5-6.4s5.1 2.4 5.5 6.4" {...STROKE} />
      <circle cx="16.5" cy="9" r="2.6" stroke="currentColor" strokeWidth={1.6} fill="none" />
      <path d="M14.7 14.4c2.8.3 4.7 2.3 5 5.6" {...STROKE} />
    </IconBase>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" {...STROKE} />
      <path
        d="M19 12a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.1-1.2L14 3h-4l-.4 2.7a8 8 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5A7.5 7.5 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.4-2.7c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"
        {...STROKE}
      />
    </IconBase>
  );
}

export function getAlmaAppIcon(iconKey: AlmaAppIconKey, size = 22) {
  const props = { size };
  switch (iconKey) {
    case 'book':
      return <BookIcon {...props} />;
    case 'chart':
      return <ChartIcon {...props} />;
    case 'document':
      return <DocumentIcon {...props} />;
    case 'shield':
      return <ShieldIcon {...props} />;
    case 'warning':
      return <WarningIcon {...props} />;
    case 'search':
      return <SearchIcon {...props} />;
    case 'cap':
      return <CapIcon {...props} />;
    case 'produce':
      return <ProduceIcon {...props} />;
    case 'people':
      return <PeopleIcon {...props} />;
    case 'gear':
      return <GearIcon {...props} />;
  }
}

function sizedIcon(icon: ReactNode, size: number) {
  if (!isValidElement(icon)) return icon;
  return cloneElement(icon as ReactElement<IconProps>, { size });
}

export const ALMA_APPS: AlmaAppDefinition[] = [
  {
    id: 'compliance',
    label: 'COMPLIANCE',
    from: '#B3262E',
    to: '#6B2424',
    iconKey: 'shield',
    icon: <ShieldIcon />
  },
  {
    id: 'stock',
    label: 'STOCK',
    from: '#1a6e34',
    to: '#0e4820',
    iconKey: 'produce',
    icon: <ProduceIcon />
  },
  {
    id: 'reports',
    label: 'REPORTS',
    from: '#D7DCE2',
    to: '#7E8792',
    iconKey: 'chart',
    icon: <ChartIcon />
  },
  {
    id: 'staff',
    label: 'STAFF',
    from: '#244C9F',
    to: '#102E69',
    iconKey: 'people',
    icon: <PeopleIcon />
  },
  {
    id: 'reserve',
    label: 'RESERVE',
    from: '#7C3AED',
    to: '#4C1D95',
    iconKey: 'book',
    icon: <BookIcon />
  },
  {
    id: 'training',
    label: 'ACADEMY',
    from: '#D18A00',
    to: '#9A6500',
    iconKey: 'cap',
    icon: <CapIcon />
  },
  {
    id: 'settings',
    label: 'ADMIN',
    from: '#2F343A',
    to: '#1F2429',
    iconKey: 'gear',
    icon: <GearIcon />
  }
];

export const ALMA_APP_LOGO_SRC = {
  compliance: '/brand/alma-compliance-logo.svg',
  stock: '/brand/alma-stock-logo.svg',
  reports: '/brand/alma-reports-logo.svg',
  staff: '/brand/alma-staff-logo.svg',
  reserve: '/brand/alma-reserve-logo.svg',
  audits: '/brand/alma-audits-logo.svg',
  training: '/brand/alma-training-logo.svg',
  settings: '/brand/alma-settings-logo.svg'
} as const;

/**
 * The new ALMA product app icon.
 *
 * Layout (per design spec):
 *  - Square tile with medium corner radius and gradient background
 *  - Thin micro line icon at the top
 *  - White rounded `a` mark in the centre (the brand mark)
 *  - Bottom-weighted "ALMA <NAME>" wordmark
 *
 * `size` is the rendered pixel size (default 120). The internal layout is
 * proportional, so the same component drives the 24px sidebar mark and
 * the 1024px PNG export.
 */
export function AlmaAppIcon({
  label,
  colorFrom,
  colorTo,
  icon,
  size = 120,
  className,
  featureScale = 0.42,
  variant = 'full',
  showBrandMark = true
}: AlmaAppIconProps) {
  const radius = Math.round(size * 0.22);
  const tileStyle: CSSProperties = {
    position: 'relative',
    width: size,
    height: size,
    aspectRatio: '1 / 1',
    borderRadius: radius,
    background: `linear-gradient(155deg, ${colorFrom} 0%, ${colorTo} 100%)`,
    color: '#ffffff',
    boxSizing: 'border-box',
    overflow: 'hidden',
    boxShadow: `0 ${Math.max(2, Math.round(size * 0.06))}px ${Math.max(
      4,
      Math.round(size * 0.16)
    )}px rgba(15, 23, 42, 0.22)`,
    display: 'block',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif'
  };

  const decorations = (
    <>
      {/* Soft inner border */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: Math.max(1, Math.round(size * 0.012)),
          borderRadius: Math.max(1, radius - Math.round(size * 0.012)),
          border: '1px solid rgba(255, 255, 255, 0.22)',
          pointerEvents: 'none'
        }}
      />
      {/* Top-down sheen */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 38%, rgba(0,0,0,0) 70%)',
          pointerEvents: 'none'
        }}
      />
    </>
  );

  if (variant === 'compact') {
    // Single dominant per-app glyph, centred. Used for switcher chips and
    // anywhere the tile is too small for the full wordmark layout.
    const pad = Math.round(size * 0.12);
    const brandMarkSize = Math.max(9, Math.round(size * 0.18));
    const glyphSize = Math.round(size * 0.58);
    return (
      <div
        className={className ? `alma-app-icon alma-app-icon-compact ${className}` : 'alma-app-icon alma-app-icon-compact'}
        style={tileStyle}
        role="img"
        aria-label={`Alma ${label.toLowerCase()} app icon`}
      >
        {decorations}
        {showBrandMark ? (
          <img
            alt=""
            aria-hidden="true"
            src={ALMA_A_MARK_SRC}
            width={brandMarkSize}
            height={brandMarkSize}
            style={{
              position: 'absolute',
              top: pad,
              left: pad,
              display: 'block',
              objectFit: 'contain',
              opacity: 0.84,
              filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))'
            }}
          />
        ) : null}
        {icon ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              placeItems: 'center',
              width: glyphSize,
              height: glyphSize,
              color: 'rgba(255,255,255,0.96)',
              filter: `drop-shadow(0 ${Math.max(1, Math.round(size * 0.02))}px ${Math.max(
                2,
                Math.round(size * 0.05)
              )}px rgba(0,0,0,0.32))`
            }}
          >
            {sizedIcon(icon, glyphSize)}
          </span>
        ) : (
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 48 48"
            width={glyphSize}
            height={glyphSize}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)'
            }}
          >
            <path d={ALMA_A_PATH} fill="#ffffff" fillRule="evenodd" clipRule="evenodd" />
          </svg>
        )}
      </div>
    );
  }

  // Full layout
  const pad = Math.round(size * 0.1);
  const brandMarkSize = Math.max(12, Math.round(size * 0.155));
  const featureSize = Math.round(size * featureScale);
  const isSmallTile = size < 80;
  const almaSize = isSmallTile ? Math.max(6, Math.round(size * 0.11)) : Math.max(9, Math.round(size * 0.12));
  const labelSize = isSmallTile ? Math.max(4, Math.round(size * 0.09)) : Math.max(7, Math.round(size * 0.07));
  const trackingAlma = isSmallTile ? '0.08em' : almaSize > 12 ? '0.16em' : '0.1em';
  const trackingLabel = isSmallTile ? '0.04em' : labelSize > 8 ? '0.22em' : '0.12em';

  return (
    <div
      className={className ? `alma-app-icon ${className}` : 'alma-app-icon'}
      style={{
        width: size,
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: Math.max(4, Math.round(size * 0.07)),
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif'
      }}
      role="img"
      aria-label={`Alma ${label.toLowerCase()} app icon`}
    >
      <span aria-hidden="true" style={tileStyle}>
        {decorations}

        {/* Small ALMA brand stamp (top-left) */}
        {showBrandMark ? (
          <img
            alt=""
            aria-hidden="true"
            src={ALMA_A_MARK_SRC}
            width={brandMarkSize}
            height={brandMarkSize}
            style={{
              position: 'absolute',
              top: pad,
              left: pad,
              display: 'block',
              objectFit: 'contain',
              opacity: 0.86,
              filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))'
            }}
          />
        ) : null}

        {/* Centre module icon */}
        {icon ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: '52%',
              transform: 'translate(-50%, -50%)',
              display: 'grid',
              placeItems: 'center',
              width: featureSize,
              height: featureSize,
              color: 'rgba(255, 255, 255, 0.96)',
              filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.24))'
            }}
        >
            {sizedIcon(icon, featureSize)}
          </span>
        ) : null}
      </span>

      {/* Label below the colour tile */}
      <span
        style={{
          textAlign: 'center',
          lineHeight: 1.05,
          color: 'var(--color-text, #0f172a)',
          overflow: 'hidden',
          textTransform: 'uppercase',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: Math.max(1, Math.round(size * 0.02)),
          width: '100%'
        }}
      >
        <span
          style={{
            display: 'block',
            fontSize: almaSize,
            fontWeight: 800,
            letterSpacing: trackingAlma,
            paddingLeft: trackingAlma,
            whiteSpace: 'nowrap',
            color: 'var(--color-text, #0f172a)'
          }}
        >
          ALMA
        </span>
        <span
          style={{
            display: 'block',
            fontSize: labelSize,
            fontWeight: 700,
            letterSpacing: trackingLabel,
            paddingLeft: trackingLabel,
            whiteSpace: 'nowrap',
            color: 'var(--color-text-muted, #475569)'
          }}
        >
          {label}
        </span>
      </span>
    </div>
  );
}

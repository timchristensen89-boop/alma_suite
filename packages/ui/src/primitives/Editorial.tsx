import type { CSSProperties, ReactNode } from 'react';

// Editorial design-system primitives from the Reports UI kit pattern.
// Use these whenever a page needs the cream/Cormorant chrome — KPI tiles,
// panel cards with eyebrow + serif title, warm pills, daily-bar charts.

// --- Sparkline -----------------------------------------------------------

type SparklineProps = {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
};

export function Sparkline({ data, color = '#1F3524', width = 120, height = 36 }: SparklineProps) {
  if (data.length < 2) return null;
  const pad = 2;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((value, index) => {
    const x = pad + (index / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const area = `${line} L${last[0]},${height} L${first[0]},${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="alma-bigstat-spark" aria-hidden="true">
      <path d={area} fill={color} fillOpacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// --- BigStat -------------------------------------------------------------

type BigStatProps = {
  eyebrow: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: string;
  trend?: number[];
  sparkColor?: string;
};

export function BigStat({ eyebrow, value, sub, delta, trend, sparkColor }: BigStatProps) {
  const positive = typeof delta === 'string' && (delta.startsWith('+') || delta.startsWith('▲'));
  const negative = typeof delta === 'string' && (delta.startsWith('-') || delta.startsWith('−') || delta.startsWith('▼'));
  return (
    <div className="alma-bigstat">
      <div className="alma-bigstat-head">
        <div>
          <div className="alma-bigstat-eyebrow">{eyebrow}</div>
          <div className="alma-bigstat-value">{value}</div>
          {sub ? <div className="alma-bigstat-sub">{sub}</div> : null}
        </div>
        {trend && trend.length > 1 ? <Sparkline data={trend} color={sparkColor} /> : null}
      </div>
      {delta ? (
        <div className="alma-bigstat-foot">
          <span className={`alma-bigstat-delta ${positive ? 'is-positive' : negative ? 'is-negative' : ''}`}>
            {delta}
          </span>
          <span>vs last week</span>
        </div>
      ) : null}
    </div>
  );
}

// --- Editorial Panel ------------------------------------------------------

type EditorialPanelProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function EditorialPanel({ eyebrow, title, actions, children, className, style }: EditorialPanelProps) {
  return (
    <div className={`alma-panel ${className ?? ''}`} style={style}>
      <div className="alma-panel-h">
        <div className="alma-panel-h-text">
          {eyebrow ? <div className="alma-panel-h-eyebrow">{eyebrow}</div> : null}
          <h2 className="alma-panel-h-title">{title}</h2>
        </div>
        {actions ? <div className="alma-panel-h-actions">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

// --- Daily Bars chart (last 7 days w/ Closed treatment) ----------------

type DailyBarsProps = {
  days: { d: string; v: number; closed?: boolean }[];
  max?: number;
};

export function DailyBars({ days, max }: DailyBarsProps) {
  const cap = max ?? Math.max(...days.map((day) => day.v), 1) * 1.15;
  return (
    <div className="alma-daily-bars">
      {days.map((day) => (
        <div key={day.d} className="alma-daily-bar-col">
          {day.closed ? (
            <div className="alma-daily-bar is-closed">Closed</div>
          ) : (
            <>
              <span className="alma-daily-bar-value">{day.v}</span>
              <div
                className="alma-daily-bar"
                style={{ height: `${(day.v / cap) * 100}%` }}
              />
            </>
          )}
          <div className="alma-daily-bar-label">{day.d}</div>
        </div>
      ))}
    </div>
  );
}

// --- Editorial App Header (per-app home page hero) ---------------------

type EditorialAppHeaderProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  italic?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function EditorialAppHeader({
  eyebrow,
  title,
  italic,
  sub,
  actions,
  className
}: EditorialAppHeaderProps) {
  return (
    <header className={`alma-app-header ${className ?? ''}`}>
      <div className="alma-app-header-titles">
        <span className="alma-app-header-eyebrow">{eyebrow}</span>
        <h1 className="alma-app-header-title-row">
          <span className="alma-app-header-title">{title}</span>
          {italic ? <span className="alma-app-header-title alma-app-header-title--italic">{italic}</span> : null}
        </h1>
        {sub ? <p className="alma-app-header-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="alma-app-header-actions">{actions}</div> : null}
    </header>
  );
}

// --- Pill ---------------------------------------------------------------

type AlmaPillKind = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

type AlmaPillProps = {
  kind?: AlmaPillKind;
  dot?: boolean;
  children: ReactNode;
};

export function AlmaPill({ kind = 'neutral', dot = false, children }: AlmaPillProps) {
  return (
    <span className={`alma-pill alma-pill-${kind}`}>
      {dot ? <span className="alma-pill-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

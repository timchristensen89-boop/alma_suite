import { useId, type ReactNode } from 'react';

// Lightweight, dependency-free SVG charts themed to the reports palette. Each
// chart is responsive (viewBox + width:100%) and degrades to an empty-state
// note when there's nothing to draw. Values are plain numbers; formatting is
// passed in so callers control currency / percent / counts.

export const CHART_COLORS = {
  accent: '#B5772F',
  positive: '#4F6B47',
  warning: '#C8924E',
  danger: '#A0463A',
  info: '#5B6E7B',
  neutral: '#B9AE97'
} as const;

// A pleasant warm-leaning categorical palette for multi-series charts.
export const CHART_PALETTE = ['#B5772F', '#4F6B47', '#5B6E7B', '#C8924E', '#8A5A20', '#7C8B6F', '#A0463A', '#B9AE97'];

function EmptyChart({ label, height }: { label: string; height: number }) {
  return (
    <div className="chart-empty" style={{ height }}>
      <span>{label}</span>
    </div>
  );
}

type BarDatum = { label: string; value: number; color?: string };

// Vertical bar chart with value labels above each bar. Good for "by day" /
// "by venue" distributions and small comparisons.
export function BarChart({
  data,
  height = 180,
  format = (v) => String(Math.round(v)),
  color = CHART_COLORS.accent,
  emptyLabel = 'No data for this range yet.'
}: {
  data: BarDatum[];
  height?: number;
  format?: (value: number) => string;
  color?: string;
  emptyLabel?: string;
}) {
  if (!data.length || data.every((d) => !d.value)) return <EmptyChart label={emptyLabel} height={height} />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 100;
  const gap = data.length > 1 ? 2.5 : 0;
  const barW = (w - gap * (data.length - 1)) / data.length;
  const plotH = 100;
  return (
    <div className="chart-bars" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${plotH}`} preserveAspectRatio="none" className="chart-bars-svg" role="img">
        {data.map((d, i) => {
          const h = max > 0 ? (d.value / max) * (plotH - 16) : 0;
          const x = i * (barW + gap);
          return (
            <g key={d.label + i}>
              <rect x={x} y={plotH - h} width={barW} height={h} rx={1.2} fill={d.color ?? color} />
            </g>
          );
        })}
      </svg>
      <div className="chart-bars-labels">
        {data.map((d, i) => (
          <div key={d.label + i} className="chart-bar-label" style={{ width: `${(barW / w) * 100}%` }}>
            <strong>{format(d.value)}</strong>
            <span>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Smooth-ish trend line with an area fill and a final-point marker. Good for
// week-over-week sales / prime cost series.
export function TrendLine({
  points,
  height = 160,
  format = (v) => String(Math.round(v)),
  color = CHART_COLORS.accent,
  emptyLabel = 'Not enough history yet.'
}: {
  points: Array<{ label: string; value: number }>;
  height?: number;
  format?: (value: number) => string;
  color?: string;
  emptyLabel?: string;
}) {
  const gradId = useId().replace(/:/g, '');
  if (points.length < 2) return <EmptyChart label={emptyLabel} height={height} />;
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 100;
  const h = 100;
  const pad = 6;
  const coords = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * (w - pad * 2) + pad : w / 2;
    const y = h - pad - ((p.value - min) / range) * (h - pad * 2);
    return { x, y };
  });
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1]!.x.toFixed(2)},${h} L${coords[0]!.x.toFixed(2)},${h} Z`;
  const last = coords[coords.length - 1]!;
  return (
    <div className="chart-trend" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart-trend-svg" role="img">
        <defs>
          <linearGradient id={`trend-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#trend-${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={last.x} cy={last.y} r="1.8" fill={color} />
      </svg>
      <div className="chart-trend-labels">
        <span>{points[0]!.label}</span>
        <span className="chart-trend-last">{format(points[points.length - 1]!.value)}</span>
        <span>{points[points.length - 1]!.label}</span>
      </div>
    </div>
  );
}

type Segment = { label: string; value: number; color: string };

// Donut for proportions (cost vs margin, stock status mix). Renders a legend
// with values beside it.
export function Donut({
  segments,
  size = 140,
  centerLabel,
  centerValue,
  format = (v) => String(Math.round(v)),
  emptyLabel = 'No data yet.'
}: {
  segments: Segment[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
  format?: (value: number) => string;
  emptyLabel?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return <EmptyChart label={emptyLabel} height={size} />;
  const r = 16;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="chart-donut">
      <svg viewBox="0 0 40 40" width={size} height={size} role="img" className="chart-donut-svg">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
        {segments.map((seg, i) => {
          const frac = Math.max(0, seg.value) / total;
          const dash = frac * c;
          const el = (
            <circle
              key={seg.label + i}
              cx="20"
              cy="20"
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="6"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 20 20)"
            />
          );
          offset += dash;
          return el;
        })}
        {centerValue ? (
          <text x="20" y="19.5" textAnchor="middle" className="chart-donut-center-value">{centerValue}</text>
        ) : null}
        {centerLabel ? (
          <text x="20" y="24.5" textAnchor="middle" className="chart-donut-center-label">{centerLabel}</text>
        ) : null}
      </svg>
      <ul className="chart-legend">
        {segments.map((seg, i) => (
          <li key={seg.label + i}>
            <span className="chart-legend-dot" style={{ background: seg.color }} />
            <span className="chart-legend-label">{seg.label}</span>
            <span className="chart-legend-value">{format(seg.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Horizontal ranked bars — top dishes, biggest contributors, etc.
export function HBars({
  data,
  format = (v) => String(Math.round(v)),
  color = CHART_COLORS.accent,
  emptyLabel = 'Nothing to rank yet.',
  meta
}: {
  data: BarDatum[];
  format?: (value: number) => string;
  color?: string;
  emptyLabel?: string;
  meta?: (datum: BarDatum) => ReactNode;
}) {
  if (!data.length || data.every((d) => !d.value)) return <EmptyChart label={emptyLabel} height={120} />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="chart-hbars">
      {data.map((d, i) => (
        <div key={d.label + i} className="chart-hbar">
          <div className="chart-hbar-head">
            <span className="chart-hbar-label">{d.label}</span>
            <span className="chart-hbar-value">{format(d.value)}</span>
          </div>
          <div className="chart-hbar-track">
            <div className="chart-hbar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color }} />
          </div>
          {meta ? <div className="chart-hbar-meta">{meta(d)}</div> : null}
        </div>
      ))}
    </div>
  );
}

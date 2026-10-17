/**
 * Formatting shared by the Stock home sections, and the one rule the page
 * lives by: a change is coloured by what it means, not by its sign. Revenue
 * going up is good; cost of goods as a share of sales going up is bad; cost
 * of goods in dollars going up is neither until you know what sales did.
 */

export function money(cents: number | null | undefined, opts: { cents?: boolean } = {}) {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: opts.cents ? 2 : 0, minimumFractionDigits: opts.cents ? 2 : 0 });
}

export function percent(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}%`;
}

export function count(value: number) {
  return value.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

export function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function monthName(iso: string) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Percentage change of `current` over `prior`; null when there is no prior. */
export function changePercent(current: number, prior: number): number | null {
  if (!prior) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
}

/**
 * Which way is good for this metric. 'up' means a rise is good (sales,
 * gross profit), 'down' means a fall is good (cost of goods as a share of
 * sales), 'none' means the sign says nothing on its own (cost of goods in
 * dollars — it should move with sales).
 */
export type GoodDirection = 'up' | 'down' | 'none';

/**
 * A change badge: "+4.2%" for a relative change, "+1.3 pp" for a change in
 * percentage points. Coloured by whether the move is good for the metric.
 */
export function Delta({ value, unit = '%', good, label }: { value: number | null; unit?: '%' | 'pp'; good: GoodDirection; label?: string }) {
  if (value === null) return <span className="home-delta is-none" title={label}>n/a</span>;
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const tone = good === 'none' || dir === 'flat' ? 'is-neutral' : (dir === good ? 'is-good' : 'is-bad');
  const sign = value > 0 ? '+' : '';
  const text = unit === 'pp' ? `${sign}${value.toFixed(1)} pp` : `${sign}${value.toFixed(1)}%`;
  return (
    <span className={`home-delta ${tone}`} title={label}>
      <span className="home-delta-arrow" aria-hidden>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'}</span>
      {text}
    </span>
  );
}

export type Scope = 'group' | string;

export function scopeLabel(scope: Scope) {
  return scope === 'group' ? 'Alma Group' : scope;
}

/** The segmented venue switch used by every section. */
export function ScopeSwitch({ scope, venues, onChange, size = 'md' }: { scope: Scope; venues: string[]; onChange: (s: Scope) => void; size?: 'sm' | 'md' }) {
  const options: Array<{ value: Scope; label: string }> = [{ value: 'group', label: 'Group' }, ...venues.map((v) => ({ value: v, label: v }))];
  return (
    <div className={`home-scope home-scope-${size}`} role="tablist" aria-label="Venue">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={scope === o.value} className={scope === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

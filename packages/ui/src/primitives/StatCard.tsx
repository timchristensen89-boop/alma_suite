import type { ReactNode } from 'react';

type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info';

type Props = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  loading?: boolean;
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading = false
}: Props) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {icon ? <span className="stat-card-icon">{icon}</span> : null}
      </div>
      <div className="stat-card-value">
        {loading ? <span className="skeleton skeleton-value" /> : value}
      </div>
      {hint ? <div className="stat-card-hint">{hint}</div> : null}
    </div>
  );
}

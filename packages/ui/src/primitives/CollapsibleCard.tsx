import { useId, useState, type ReactNode } from 'react';
import { Badge } from './Badge';

type CollapsibleCardProps = {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function CollapsibleCard({
  title,
  description,
  badge,
  defaultOpen = false,
  children,
  className = ''
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={`collapsible-card ${className}`.trim()}>
      <button
        type="button"
        className="collapsible-card-header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="collapsible-card-title">
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        <span className="collapsible-card-meta">
          {badge ? <Badge tone="muted">{badge}</Badge> : null}
          <span className="collapsible-card-toggle">{open ? 'Collapse' : 'Expand'}</span>
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="collapsible-card-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

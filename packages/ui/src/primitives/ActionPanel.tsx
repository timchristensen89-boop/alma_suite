import { useState, type ReactNode } from 'react';
import { Badge } from './Badge';

type ActionPanelTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info' | 'muted';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  count?: number | string;
  tone?: ActionPanelTone;
  defaultOpen?: boolean;
  empty?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function ActionPanel({
  title,
  description,
  count,
  tone = 'neutral',
  defaultOpen = false,
  empty,
  children,
  className = ''
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const countNumber = typeof count === 'number' ? count : null;
  const hasItems = countNumber === null ? Boolean(children) : countNumber > 0;

  return (
    <section className={`action-panel action-panel-${tone} ${className}`.trim()}>
      <button
        type="button"
        className="action-panel-header"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="action-panel-title">
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        <span className="action-panel-meta">
          {count !== undefined ? <Badge tone={tone}>{count}</Badge> : null}
          <span className="action-panel-toggle">{open ? 'Collapse' : 'Expand'}</span>
        </span>
      </button>
      {open ? (
        <div className="action-panel-body">
          {hasItems ? children : empty ?? <p className="subtle">No items need action.</p>}
        </div>
      ) : null}
    </section>
  );
}

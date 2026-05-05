import type { PropsWithChildren, ReactNode } from 'react';

type Props = PropsWithChildren<{
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  padding?: 'default' | 'tight' | 'none';
  className?: string;
}>;

export function Card({
  title,
  subtitle,
  action,
  children,
  padding = 'default',
  className = ''
}: Props) {
  const hasHeader = title || subtitle || action;

  return (
    <section className={`card ${className}`.trim()}>
      {hasHeader ? (
        <header className="card-header">
          <div className="card-header-text">
            {title ? <h3 className="card-title">{title}</h3> : null}
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {action ? <div className="card-action">{action}</div> : null}
        </header>
      ) : null}
      <div className={`card-body card-body-${padding}`}>{children}</div>
    </section>
  );
}

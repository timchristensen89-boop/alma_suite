import type { PropsWithChildren } from 'react';

type Tone =
  | 'neutral'
  | 'positive'
  | 'warning'
  | 'danger'
  | 'info'
  | 'indigo'
  | 'muted';

type Props = PropsWithChildren<{
  tone?: Tone;
  dot?: boolean;
  className?: string;
}>;

export function Badge({ children, tone = 'neutral', dot = false, className = '' }: Props) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}

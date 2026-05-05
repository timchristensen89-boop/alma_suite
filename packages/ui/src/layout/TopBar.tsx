import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
};

export function TopBar({ title, subtitle, right }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-text">
        <span className="topbar-title">{title}</span>
        {subtitle ? <span className="topbar-subtitle">{subtitle}</span> : null}
      </div>
      {right ? <div className="topbar-right">{right}</div> : null}
    </div>
  );
}

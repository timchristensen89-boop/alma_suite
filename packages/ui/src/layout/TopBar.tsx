import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  /** Set false on the Home app itself, where a "Back to Home" link is redundant. */
  showHomeLink?: boolean;
  /** Override the Home URL — defaults to the public alma-home.web.app. */
  homeUrl?: string;
};

export function TopBar({ title, subtitle, right, showHomeLink = true, homeUrl = 'https://alma-home.web.app/' }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-text">
        <span className="topbar-title">{title}</span>
        {subtitle ? <span className="topbar-subtitle">{subtitle}</span> : null}
      </div>
      {(showHomeLink || right) ? (
        <div className="topbar-right">
          {showHomeLink ? (
            <a
              className="app-shell-topbar-home app-shell-topbar-home--icon"
              href={homeUrl}
              aria-label="Alma Home"
              title="Alma Home"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 12 L12 3 L21 12" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 10 V20 H19 V10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ) : null}
          {right}
        </div>
      ) : null}
    </div>
  );
}

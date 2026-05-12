import { useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { ProductLogo } from '../brand/SuiteApps';

type Props = PropsWithChildren<{
  sidebar: ReactNode;
  topBar?: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
}>;

export function AppShell({ children, sidebar, topBar, brand, footer }: Props) {
  const [sidebarPinned, setSidebarPinned] = useState(false);

  return (
    <div className={`app-shell ${sidebarPinned ? 'is-sidebar-pinned' : ''}`}>
      <div className="suite-fish" aria-hidden="true">
        <img src="/brand/alma-fish.png" alt="" draggable="false" />
      </div>
      <aside className="app-shell-sidebar">
        <button
          type="button"
          className="app-shell-sidebar-toggle"
          aria-label={sidebarPinned ? 'Collapse sidebar' : 'Pin sidebar open'}
          aria-controls="app-shell-primary-nav"
          aria-expanded={sidebarPinned}
          aria-pressed={sidebarPinned}
          onClick={() => setSidebarPinned((pinned) => !pinned)}
        >
          <span aria-hidden="true">{sidebarPinned ? '‹' : '›'}</span>
        </button>
        <div className="app-shell-brand">
          {brand ?? (
            <ProductLogo appId="compliance" size="md" showBrandMark={false} />
          )}
        </div>
        <nav id="app-shell-primary-nav" className="app-shell-nav">{sidebar}</nav>
        {footer ? <div className="app-shell-sidebar-footer">{footer}</div> : null}
      </aside>
      <div className="app-shell-body">
        {topBar ? <div className="app-shell-topbar">{topBar}</div> : null}
        <main className="app-shell-main">
          <div className="app-shell-container">{children}</div>
        </main>
      </div>
    </div>
  );
}

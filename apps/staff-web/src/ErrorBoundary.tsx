import React from 'react';

/**
 * Crash guard: an unexpected render error used to leave a blank page with no
 * way forward but knowing to reload. This catches it and says so, with the
 * fix on a button. Open data lives on the server, so a reload loses nothing.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash">
        <div className="app-crash-panel">
          <h1>Something broke on this page</h1>
          <p>Your data is on the server — nothing here is lost. Reload to carry on.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

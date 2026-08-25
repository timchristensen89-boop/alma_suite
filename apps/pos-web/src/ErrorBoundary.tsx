import React from 'react';
import { api } from './api';

/**
 * The register's crash guard.
 *
 * Before this, one unexpected error white-screened the till mid-service and
 * the only fix was someone knowing to reload the browser. Now the crash is
 * caught, reported through the same bug-report pipe the floor already uses
 * (severity BLOCKING, which emails support immediately), and the screen
 * offers recovery instead of blankness.
 *
 * Recovery order matters: "Try again" remounts in place — open orders live
 * on the server, so nothing rung is lost. If the same crash comes straight
 * back twice, remounting is not going to fix it and the screen stops
 * pretending it might: reload becomes the only offer.
 */

let reportsThisSession = 0;

function reportCrash(error: unknown, source: string) {
  // At most a few per session: a render loop must not flood the inbox.
  if (reportsThisSession >= 3) return;
  reportsThisSession += 1;
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  void api('/api/pos/bug-reports', {
    method: 'POST',
    body: JSON.stringify({
      venue: localStorage.getItem('alma.pos.venue') ?? 'Unknown',
      body: `The register crashed (${source}) and showed the recovery screen.`,
      screen: window.location.hash || '#register',
      appVersion: document.querySelector('script[src*="/assets/"]')?.getAttribute('src') ?? null,
      userAgent: navigator.userAgent,
      reportedBy: 'Crash guard',
      clientError: detail.slice(0, 2000),
      severity: 'BLOCKING'
    })
  }).catch(() => undefined); // a guest page has no session — the screen still recovers
}

/** Runtime errors outside React's render (event handlers, timers, promises)
    get reported too — they don't unmount the app, so no UI, just the report. */
export function installGlobalCrashReporting() {
  window.addEventListener('error', (event) => {
    reportCrash(event.error ?? event.message, 'window error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportCrash(event.reason, 'unhandled promise');
  });
}

type State = { error: Error | null; recoveries: number; lastCrashAt: number };

export class RegisterErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, recoveries: 0, lastCrashAt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportCrash(error, 'render');
    this.setState({ lastCrashAt: Date.now() });
  }

  private recover = () => {
    this.setState((state) => ({ error: null, recoveries: state.recoveries + 1 }));
  };

  render() {
    if (!this.state.error) return this.props.children;
    // Two recoveries inside a minute = the crash is deterministic; a fresh
    // load (new bundle, clean state) is the honest remaining option.
    const stuck = this.state.recoveries >= 2 && Date.now() - this.state.lastCrashAt < 60_000;
    return (
      <div className="pos-crash">
        <div className="pos-crash-panel">
          <h1>Something broke on this screen</h1>
          <p>
            Nothing rung up has been lost — open bills live on the server, not on this device.
            {stuck
              ? ' Recovering in place has not helped, so reload to get a fresh copy of the register.'
              : ' Tap recover to carry on where you were.'}
          </p>
          {!stuck ? (
            <button type="button" className="pos-crash-primary" onClick={this.recover}>
              Recover and carry on
            </button>
          ) : null}
          <button
            type="button"
            className={stuck ? 'pos-crash-primary' : 'pos-crash-secondary'}
            onClick={() => window.location.reload()}
          >
            Reload the register
          </button>
          <small>The crash has been reported automatically with what happened.</small>
        </div>
      </div>
    );
  }
}

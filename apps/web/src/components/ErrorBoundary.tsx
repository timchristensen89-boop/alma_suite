import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card, EmptyState } from '@alma/ui';
import { IconRefresh } from '../lib/icons';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Top-level error boundary for the authenticated shell. One crash in a page
 * component would otherwise blank the whole app; this renders a recoverable
 * "something went wrong" card so the user can reload or back out.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('UI error boundary caught:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  reload = () => window.location.reload();

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page-stack">
        <Card padding="none">
          <div className="errorboundary">
            <EmptyState
              icon={<IconRefresh size={22} />}
              title="Something went wrong on this page"
              description={
                <>
                  <p>{this.state.error.message}</p>
                  <p className="subtle">
                    Try reloading. If it keeps happening, check the API is running
                    and the database migrations are up to date.
                  </p>
                </>
              }
              action={
                <div className="inline-actions">
                  <Button onClick={this.reset} variant="secondary">
                    Try again
                  </Button>
                  <Button onClick={this.reload}>Reload app</Button>
                </div>
              }
            />
          </div>
        </Card>
      </div>
    );
  }
}

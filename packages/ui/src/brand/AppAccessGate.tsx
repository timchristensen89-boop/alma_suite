import type { ReactNode } from 'react';
import type { AuthUser, AlmaAppId } from '@alma/shared';
import type { SuiteAppIdentity } from './SuiteApps';
import { canUseApp, accessibleSuiteApps } from './appAccess';
import { EmptyState } from '../primitives/EmptyState';

type Props = {
  user: AuthUser | null | undefined;
  /** The app this gate protects, e.g. 'STOCK'. */
  appId: AlmaAppId;
  /** Friendly app name for the message, e.g. 'Stock'. */
  appName: string;
  /** The full suite app list, used to show what the user CAN open. */
  apps: SuiteAppIdentity[];
  children: ReactNode;
};

// Whole-app access gate. Admins and managers always pass. A STAFF member who
// doesn't have this app enabled sees a clear "no access" screen that points
// them at the apps they CAN open — instead of loading the app with every
// action disabled and a confusing "manager-only" message on each click.
export function AppAccessGate({ user, appId, appName, apps, children }: Props) {
  if (canUseApp(user, appId)) return <>{children}</>;

  const usable = accessibleSuiteApps(user, apps).filter((app) => app.status === 'active' && app.href);

  return (
    <div className="app-access-gate">
      <EmptyState
        title={`You don't have access to Alma ${appName}`}
        description={
          usable.length > 0
            ? 'Your manager controls which apps you can open. Here are the ones you can use:'
            : "Your manager controls which apps you can open. Ask them to enable the apps you need."
        }
        action={
          usable.length > 0 ? (
            <div className="app-access-gate-apps">
              {usable.map((app) => (
                <a key={app.id} className="app-access-gate-link" href={app.href}>
                  <span className="app-access-gate-link-icon" aria-hidden>{app.icon}</span>
                  <span>{app.label}</span>
                </a>
              ))}
            </div>
          ) : null
        }
      />
    </div>
  );
}

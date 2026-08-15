import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  EmptyState,
  ProductLogo,
  SUITE_APPS,
  SuiteAppSwitcher,
  type SuiteAppId
} from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { withSuiteAppLinks } from '../config/suiteLinks';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

function isSuiteAppId(value: string | undefined): value is SuiteAppId {
  return Boolean(value && SUITE_APPS.some((app) => app.id === value));
}

function getSuiteApp(appId: SuiteAppId) {
  return SUITE_APPS.find((app) => app.id === appId) ?? SUITE_APPS[0]!;
}

// A destination that lands back on this very page reloads forever. That is
// exactly what /apps/pos/login did while POS had no URL of its own: the app
// list handed us our own address, we assigned it, the page reloaded, and the
// tab ping-ponged until someone closed it. Treat self as "no destination".
function resolvesToThisPage(href: string) {
  try {
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin && url.pathname === window.location.pathname;
  } catch {
    return false;
  }
}

export function SuiteAppLoginPage() {
  const { appId } = useParams();
  const validAppId = isSuiteAppId(appId) ? appId : null;
  const app = validAppId ? getSuiteApp(validAppId) : null;
  const linked = validAppId ? suiteApps.find((item) => item.id === validAppId) : null;
  const linkedApp = linked?.href && !resolvesToThisPage(linked.href) ? linked : null;
  useDocumentTitle(app ? `Alma ${app.label}` : 'Alma Suites');

  useEffect(() => {
    const href = linkedApp?.href;
    if (!href || !validAppId || validAppId === 'compliance') return;
    let cancelled = false;
    // The API is on its own domain, so Safari drops the session cookie on a
    // bare cross-app link and the target shows a login wall. Mint a handoff
    // token like every other cross-app jump in the suite.
    const mint = (globalThis as unknown as {
      almaCreateSuiteHandoffUrl?: (target: string) => Promise<string>;
    }).almaCreateSuiteHandoffUrl;
    if (!mint) {
      window.location.assign(href);
      return;
    }
    void mint(href)
      .then((withToken) => {
        if (!cancelled) window.location.assign(withToken);
      })
      .catch(() => {
        if (!cancelled) window.location.assign(href);
      });
    return () => {
      cancelled = true;
    };
  }, [linkedApp?.href, validAppId]);

  if (!validAppId) {
    return <Navigate to="/login" replace />;
  }

  if (validAppId === 'compliance') {
    return <Navigate to="/login" replace />;
  }

  if (linkedApp?.href) {
    return null;
  }

  const activeApp = getSuiteApp(validAppId);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <ProductLogo appId={validAppId} size="lg" />
        </div>

        <Card title="Sign in" subtitle={`Alma ${activeApp.label} is not configured in this environment`}>
          <EmptyState
            title={`${activeApp.label} needs an app URL`}
            description="This app exists as a separate Alma product. Add its public web URL to this environment before linking from Compliance."
            action={
              <Link to="/login">
                <Button type="button">Back to Compliance</Button>
              </Link>
            }
          />
        </Card>

        <SuiteAppSwitcher currentApp={validAppId} apps={suiteApps} />
      </div>
    </div>
  );
}

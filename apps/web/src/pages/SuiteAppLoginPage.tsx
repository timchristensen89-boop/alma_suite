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

export function SuiteAppLoginPage() {
  const { appId } = useParams();
  const validAppId = isSuiteAppId(appId) ? appId : null;
  const app = validAppId ? getSuiteApp(validAppId) : null;
  const linkedApp = validAppId ? suiteApps.find((item) => item.id === validAppId) : null;
  useDocumentTitle(app ? `Alma ${app.label}` : 'Alma Suites');

  useEffect(() => {
    if (validAppId && validAppId !== 'compliance' && linkedApp?.href) {
      window.location.assign(linkedApp.href);
    }
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

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
import { STOCK_WEB_URL, withSuiteAppLinks } from '../config/suiteLinks';

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
  useDocumentTitle(app ? `Alma ${app.label}` : 'Alma Suites');

  useEffect(() => {
    if (validAppId === 'stock') {
      window.location.assign(`${STOCK_WEB_URL.replace(/\/+$/, '')}/login`);
    }
  }, [validAppId]);

  if (!validAppId) {
    return <Navigate to="/login" replace />;
  }

  if (validAppId === 'compliance') {
    return <Navigate to="/login" replace />;
  }

  if (validAppId === 'stock') {
    return null;
  }

  const activeApp = getSuiteApp(validAppId);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <ProductLogo appId={validAppId} size="lg" />
        </div>

        <Card title="Sign in" subtitle={`Alma ${activeApp.label} is being prepared for launch`}>
          <EmptyState
            title={`${activeApp.label} is coming soon`}
            description={activeApp.description}
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

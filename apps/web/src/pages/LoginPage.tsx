import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button, Card, Input, ProductLogo, SUITE_APPS, SuiteAppSwitcher } from '@alma/ui';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { withSuiteAppLinks } from '../config/suiteLinks';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

export function LoginPage() {
  useDocumentTitle('Sign in');
  const location = useLocation();
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    const redirect = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirect} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  const supportEmail = 'tim@almagroup.com.au';
  const requestAccessHref = `mailto:${supportEmail}?subject=${encodeURIComponent(
    'ALMA Compliance access request'
  )}&body=${encodeURIComponent(
    `Hi, I need access to ALMA Compliance.\n\nEmail: ${email.trim()}\nVenue:\nRole:`
  )}`;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <ProductLogo appId="compliance" size="lg" />
        </div>

        <Card title="Sign in" subtitle="Use your venue email and password">
          <form className="page-stack compact" onSubmit={onSubmit}>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <div className="login-help-row">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="login-secondary-actions">
              <span>Need an account?</span>
              <a href={requestAccessHref}>Request access</a>
            </div>
          </form>
        </Card>

        <SuiteAppSwitcher currentApp="compliance" apps={suiteApps} />
      </div>
    </div>
  );
}

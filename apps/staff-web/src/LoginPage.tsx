import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button, Card, Input, ProductLogo, SuiteAppSwitcher, SUITE_APPS } from '@alma/ui';
import { useAuth } from './lib/auth';
import { withSuiteAppLinks } from './config/suiteLinks';

const SUITE_LINKS = withSuiteAppLinks(SUITE_APPS);

export function LoginPage() {
  const location = useLocation();
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await login(email.trim(), password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-brand">
          <ProductLogo appId="staff" size="lg" />
        </div>

        <Card title="Sign in" subtitle="Use your ALMA account to manage staff">
          <form className="login-form" onSubmit={handleSubmit}>
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
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="login-help">Need access? Ask an admin to enable ALMA Staff for you.</p>
        <SuiteAppSwitcher currentApp="staff" apps={SUITE_LINKS} />
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const HOME_WEB_URL = (
  (import.meta.env.VITE_HOME_WEB_URL as string | undefined) ?? 'https://alma-home.web.app'
).replace(/\/+$/, '');

export function LoginPage() {
  useDocumentTitle('Sign in');
  const location = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) return;
    const from = (location.state as { from?: string } | null)?.from;
    const returnTo = from
      ? new URL(from.startsWith('/') ? from : `/${from}`, window.location.origin).toString()
      : window.location.origin + '/';
    window.location.replace(`${HOME_WEB_URL}/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [loading, user, location.state]);

  if (!loading && user) {
    const redirect = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirect} replace />;
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <p className="login-redirecting">Redirecting to Alma Home to sign in…</p>
      </div>
    </div>
  );
}

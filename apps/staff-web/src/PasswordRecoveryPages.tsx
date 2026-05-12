import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, ProductLogo } from '@alma/ui';
import { api } from './lib/api';

const GENERIC_RESET_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

function resetBaseUrl() {
  return `${window.location.origin}/reset-password`;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await api('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          resetBaseUrl: resetBaseUrl(),
          appName: 'ALMA Staff'
        })
      });
      setMessage(GENERIC_RESET_MESSAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a password reset.');
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

        <Card title="Reset password" subtitle="Enter your ALMA email and we will send reset instructions if an account exists.">
          <form className="login-form" onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            {message ? <p className="subtle">{message}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <p className="login-help">
              <Link to="/login">Back to sign in</Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mismatch = Boolean(password && confirmPassword && password !== confirmPassword);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError('This password reset link is missing a token.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      await api('/api/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password })
      });
      setPassword('');
      setConfirmPassword('');
      setMessage('Your password has been updated. You can now sign in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password.');
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

        <Card title="Choose new password" subtitle="Use the private reset link from your email.">
          <form className="login-form" onSubmit={handleSubmit}>
            {!token ? <p className="error-text">This password reset link is missing a token.</p> : null}
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
            />
            {mismatch ? <p className="error-text">The passwords do not match.</p> : null}
            {message ? <p className="subtle">{message}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={submitting || !token || mismatch}>
              {submitting ? 'Updating…' : 'Update password'}
            </Button>
            <p className="login-help">
              <Link to="/login">Back to sign in</Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

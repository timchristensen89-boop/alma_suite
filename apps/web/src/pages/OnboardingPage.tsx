import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Input, ProductLogo, Spinner } from '@alma/ui';
import { api } from '../lib/api';
import { IconAudit, IconCheck, IconStaff } from '../lib/icons';
import {
  emptyProfile,
  emptyRecord,
  profileDraftToPayload,
  StaffProfileForm,
  type StaffProfileDraft
} from '../features/staff/StaffProfileForm';

type InviteSummary = {
  token: string;
  email: string | null;
  note: string | null;
  firstName: string;
  lastName: string;
  roleTitle: string;
  venue: string;
  expiresAt: string | null;
  createdAt: string;
};

export function OnboardingPage() {
  const { token = '' } = useParams();
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<StaffProfileDraft>(() => ({
    ...emptyProfile(),
    records: [emptyRecord()]
  }));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchInvite() {
      try {
        setLoading(true);
        setLoadingError(null);
        const result = await api<InviteSummary>(
          `/api/staff/invites/by-token/${token}`
        );
        if (cancelled) return;
        setInvite(result);
        setDraft((current) => ({
          ...current,
          firstName: result.firstName || current.firstName,
          lastName: result.lastName || current.lastName,
          roleTitle: result.roleTitle || current.roleTitle,
          venue: result.venue || current.venue,
          email: result.email ?? current.email
        }));
      } catch (fetchError) {
        if (cancelled) return;
        setLoadingError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Could not load this invite.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit() {
    if (password.length < 8) {
      setSubmitError('Please choose a password of at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError('The passwords do not match.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api(`/api/staff/invites/by-token/${token}/complete`, {
        method: 'POST',
        body: JSON.stringify({ ...profileDraftToPayload(draft), password })
      });
      setDone(true);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Could not submit your details.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand">
          <ProductLogo appId="compliance" size="sm" markOnly />
          <div>
            <strong>
              <span style={{ letterSpacing: '0.08em' }}>ALMA</span>{' '}
              <span style={{ fontWeight: 500 }}>Suites</span>
            </strong>
            <span className="subtle">Compliance · staff onboarding</span>
          </div>
        </div>
      </header>

      <main className="onboarding-main">
        {loading ? (
          <Card>
            <Spinner label="Loading your invite…" />
          </Card>
        ) : loadingError ? (
          <Card title="Invite unavailable">
            <EmptyState
              icon={<IconAudit size={22} />}
              title={loadingError}
              description="Ask whoever sent the invite to issue a fresh link."
            />
          </Card>
        ) : done ? (
          <Card title="All done — thank you!">
            <EmptyState
              icon={<IconCheck size={28} />}
              title="Your details have been submitted"
              description="The venue team will review your certificates shortly. You can close this tab."
            />
          </Card>
        ) : invite ? (
          <div className="page-stack">
            <Card
              title="Welcome — let's get you on the team"
              subtitle={
                invite.note ||
                'Please fill in your details and upload photos of your RSA, FSS, First Aid, and any other certificates you hold.'
              }
            >
              <p className="subtle">
                This link is private. Your information goes straight to the venue
                manager who invited you.
                {invite.expiresAt
                  ? ` It expires on ${new Date(invite.expiresAt).toLocaleDateString()}.`
                  : ''}
              </p>
            </Card>

            <StaffProfileForm
              value={draft}
              onChange={setDraft}
            />

            <Card
              title="Create a password"
              subtitle="You'll use your email and this password to sign in after onboarding."
            >
              <div className="form-grid two">
                <Input
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
                <Input
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                />
              </div>
              <p className="subtle" style={{ marginTop: 8 }}>
                At least 8 characters.
              </p>
              <div className="toolbar-right" style={{ marginTop: 12 }}>
                <Button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? 'Saving…' : 'Submit onboarding details'}
                </Button>
              </div>
            </Card>

            {submitError ? (
              <Card>
                <p className="error-text">{submitError}</p>
              </Card>
            ) : null}
          </div>
        ) : null}
      </main>

      <footer className="onboarding-footer">
        <IconStaff size={14} /> Powered by ALMA Suites Compliance
      </footer>
    </div>
  );
}

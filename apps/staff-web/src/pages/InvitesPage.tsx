// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useEffect, useState } from 'react';
import type { StaffProfile, StaffRoleTemplate } from '@alma/shared';
import {
  ActionFeedback,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  Textarea
} from '@alma/ui';
import { api } from '../lib/api';
import {
  VENUE_OPTIONS,
  roleTemplateAccessSummary,
  type StaffInvite,
  type CreatedStaffInvite,
  inviteLink,
  formatDateTime
} from './shared';

type InviteDraft = {
  firstName: string;
  lastName: string;
  roleTemplateId: string;
  roleTitle: string;
  email: string;
  venue: string;
  note: string;
  expiresInDays: string;
};

type ReonboardDraft = {
  email: string;
  firstName: string;
  lastName: string;
  roleTemplateId: string;
  roleTitle: string;
  venue: string;
  note: string;
  expiresInDays: string;
};

function emptyInviteDraft(): InviteDraft {
  return {
    firstName: '',
    lastName: '',
    roleTemplateId: '',
    roleTitle: '',
    email: '',
    venue: '',
    note: '',
    expiresInDays: '30'
  };
}

function emptyReonboardDraft(): ReonboardDraft {
  return {
    email: '',
    firstName: '',
    lastName: '',
    roleTemplateId: '',
    roleTitle: '',
    venue: '',
    note: '',
    expiresInDays: '30'
  };
}

export function InvitesPage({ staff, roleTemplates, reloadStaff }: { staff: StaffProfile[]; roleTemplates: StaffRoleTemplate[]; reloadStaff: () => Promise<void> }) {
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<InviteDraft>(() => emptyInviteDraft());
  const [reonboardDraft, setReonboardDraft] = useState<ReonboardDraft>(() => emptyReonboardDraft());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const pendingInvites = invites.filter((invite) => inviteStatus(invite) === 'Pending');
  const completedInvites = invites.filter((invite) => invite.completedAt);
  const expiredInvites = invites.filter((invite) => inviteStatus(invite) === 'Expired');

  async function loadInvites() {
    setLoading(true);
    setError(null);
    try {
      setInvites(await api<StaffInvite[]>('/api/staff/invites'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invites');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvites();
  }, []);

  function update<K extends keyof InviteDraft>(key: K, value: InviteDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateReonboard<K extends keyof ReonboardDraft>(key: K, value: ReonboardDraft[K]) {
    setReonboardDraft((current) => ({ ...current, [key]: value }));
  }

  function selectInviteRole(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  function selectReonboardRole(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setReonboardDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  async function createInvite() {
    setError(null);
    setMessage(null);
    setMessageTarget('create-invite');
    if (!draft.firstName.trim() || !draft.lastName.trim() || (!draft.roleTemplateId && !draft.roleTitle.trim())) {
      const next = 'First name, last name and role are required';
      setError(next);
      setMessage(next);
      return;
    }

    setSaving(true);
    try {
      const created = await api<CreatedStaffInvite>('/api/staff/invites', {
        method: 'POST',
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          roleTemplateId: draft.roleTemplateId || undefined,
          roleTitle: draft.roleTitle.trim(),
          email: draft.email.trim(),
          venue: draft.venue.trim(),
          note: draft.note.trim(),
          expiresInDays: Number(draft.expiresInDays) || 30,
          onboardingBaseUrl: window.location.origin
        })
      });
      setDraft(emptyInviteDraft());
      setMessage(
        created.emailDelivery?.status === 'sent'
          ? 'Invite created and email sent.'
          : 'Invite created. Copy the onboarding link below.'
      );
      await Promise.all([loadInvites(), reloadStaff()]);
    } catch (err) {
      const next = err instanceof Error ? err.message : 'Could not create invite';
      setError(next);
      setMessage(next);
    } finally {
      setSaving(false);
    }
  }

  async function copyInviteLink(invite: StaffInvite) {
    const link = inviteLink(invite.token);
    await navigator.clipboard?.writeText(link);
    setMessageTarget(`copy:${invite.id}`);
    setMessage('Onboarding link copied.');
  }

  async function reonboardStaff() {
    setError(null);
    setMessage(null);
    setMessageTarget('reonboard');
    if (!reonboardDraft.email.trim()) {
      const next = 'Email is required to reset onboarding.';
      setError(next);
      setMessage(next);
      return;
    }

    setSaving(true);
    try {
      const created = await api<CreatedStaffInvite>('/api/staff/invites/reonboard', {
        method: 'POST',
        body: JSON.stringify({
          email: reonboardDraft.email.trim(),
          firstName: reonboardDraft.firstName.trim(),
          lastName: reonboardDraft.lastName.trim(),
          roleTemplateId: reonboardDraft.roleTemplateId || undefined,
          roleTitle: reonboardDraft.roleTitle.trim(),
          venue: reonboardDraft.venue.trim(),
          note: reonboardDraft.note.trim(),
          expiresInDays: Number(reonboardDraft.expiresInDays) || 30,
          onboardingBaseUrl: window.location.origin
        })
      });
      setReonboardDraft(emptyReonboardDraft());
      setMessage(
        created.emailDelivery?.status === 'sent'
          ? `Re-onboarding reset and invite sent to ${created.email}.`
          : 'Re-onboarding reset. Copy the fresh onboarding link below.'
      );
      await Promise.all([loadInvites(), reloadStaff()]);
    } catch (err) {
      const next = err instanceof Error ? err.message : 'Could not reset onboarding.';
      setError(next);
      setMessage(next);
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite(invite: StaffInvite) {
    setSaving(true);
    setError(null);
    setMessage(null);
    setMessageTarget(`resend:${invite.id}`);
    try {
      const resent = await api<CreatedStaffInvite>(`/api/staff/invites/${invite.id}/resend`, {
        method: 'POST',
        body: JSON.stringify({ onboardingBaseUrl: window.location.origin })
      });
      setMessage(
        resent.emailDelivery?.status === 'sent'
          ? `Invite resent to ${resent.email ?? invite.email}.`
          : `Invite link is ready to copy. ${resent.emailDelivery?.reason ?? 'Email was not sent.'}`
      );
      await loadInvites();
    } catch (err) {
      const next = err instanceof Error ? err.message : 'Could not resend invite';
      setError(next);
      setMessage(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Staff onboarding"
        title="Invite new staff"
        description="Create pending staff profiles, send onboarding links, and track who has completed their setup."
      />

      <div className="stats-grid">
        <StatCard label="Invites" value={invites.length} hint="All onboarding links" loading={loading} />
        <StatCard label="Pending" value={pendingInvites.length} hint="Waiting for completion" loading={loading} />
        <StatCard label="Completed" value={completedInvites.length} hint="Staff finished setup" loading={loading} />
        <StatCard label="Expired" value={expiredInvites.length} hint="Needs a fresh invite" loading={loading} />
      </div>

      <div className="invites-layout">
        <Card title="Create invite" subtitle="This also creates a pending staff profile">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createInvite();
            }}
          >
            <div className="form-grid two">
              <Input label="First name" required value={draft.firstName} onChange={(event) => update('firstName', event.currentTarget.value)} />
              <Input label="Last name" required value={draft.lastName} onChange={(event) => update('lastName', event.currentTarget.value)} />
            </div>
            <div className="form-grid two">
              {roleTemplates.length ? (
                <Select
                  label="Role"
                  required
                  value={draft.roleTemplateId}
                  onChange={(event) => selectInviteRole(event.currentTarget.value)}
                  options={[
                    { label: 'Choose a role template', value: '' },
                    ...roleTemplates.map((template) => ({ label: template.name, value: template.id }))
                  ]}
                />
              ) : (
                <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
              )}
              <Select label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            {draft.roleTemplateId ? (
              <p className="subtle">{roleTemplateAccessSummary(roleTemplates.find((template) => template.id === draft.roleTemplateId))}</p>
            ) : null}
            <div className="form-grid two">
              <Input label="Email" type="email" value={draft.email} onChange={(event) => update('email', event.currentTarget.value)} />
              <Input label="Expires in days" type="number" min="1" value={draft.expiresInDays} onChange={(event) => update('expiresInDays', event.currentTarget.value)} />
            </div>
            <Textarea label="Note" rows={2} value={draft.note} onChange={(event) => update('note', event.currentTarget.value)} placeholder="Optional message for the invite email" />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invite'}</Button>
              <ActionFeedback
                message={messageTarget === 'create-invite' ? message : null}
                tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
              />
            </div>
          </form>
        </Card>

        <Card title="Re-onboard staff" subtitle="Reset an archived or completed staff profile and issue a fresh onboarding link">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void reonboardStaff();
            }}
          >
            <Input
              label="Employee email"
              type="email"
              required
              value={reonboardDraft.email}
              onChange={(event) => updateReonboard('email', event.currentTarget.value)}
              placeholder="bonnie@almagroup.com.au"
            />
            <div className="form-grid two">
              <Input label="First name override" value={reonboardDraft.firstName} onChange={(event) => updateReonboard('firstName', event.currentTarget.value)} />
              <Input label="Last name override" value={reonboardDraft.lastName} onChange={(event) => updateReonboard('lastName', event.currentTarget.value)} />
            </div>
            <div className="form-grid two">
              <Select
                label="Role override"
                value={reonboardDraft.roleTemplateId}
                onChange={(event) => selectReonboardRole(event.currentTarget.value)}
                options={[
                  { label: 'Keep current role', value: '' },
                  ...roleTemplates.map((template) => ({ label: template.name, value: template.id }))
                ]}
              />
              <Select label="Venue override" value={reonboardDraft.venue} onChange={(event) => updateReonboard('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            <div className="form-grid two">
              <Input label="Expires in days" type="number" min="1" value={reonboardDraft.expiresInDays} onChange={(event) => updateReonboard('expiresInDays', event.currentTarget.value)} />
            </div>
            <Textarea label="Reset note" rows={2} value={reonboardDraft.note} onChange={(event) => updateReonboard('note', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Resetting…' : 'Reset onboarding'}</Button>
              <ActionFeedback
                message={messageTarget === 'reonboard' ? message : null}
                tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
              />
            </div>
          </form>
        </Card>

        <Card title="Pending profiles" subtitle="Created by invites and waiting for onboarding" padding="none">
          <div className="staff-list" style={{ padding: 12 }}>
            {staff.filter((member) => member.employmentStatus === 'PENDING').length === 0 ? (
              <EmptyState title="No pending profiles" description="New invite profiles will appear here." />
            ) : (
              staff
                .filter((member) => member.employmentStatus === 'PENDING')
                .map((member) => (
                  <div key={member.id} className="staff-expiry-row">
                    <span>
                      <strong>{member.firstName} {member.lastName}</strong>
                      <span className="subtle">{member.roleTitle} · {member.venue || 'No venue'}</span>
                    </span>
                    <Badge tone="warning">Pending</Badge>
                  </div>
                ))
            )}
          </div>
        </Card>
      </div>

      <Card title="Invite history" subtitle="Copy links, check expiry, and see completed onboarding" padding="none">
        {loading ? <Spinner label="Loading invites…" /> : null}
        {!loading && invites.length === 0 ? (
          <EmptyState title="No invites yet" description="Create the first onboarding invite above." />
        ) : null}
        {!loading && invites.length > 0 ? (
          <div className="invite-list">
            {invites.map((invite) => {
              const status = inviteStatus(invite);
              return (
                <div key={invite.id} className="invite-row">
                  <span>
                    <strong>{invite.email || 'No email recorded'}</strong>
                    <span className="subtle">
                      Created {formatDateTime(invite.createdAt)} · Expires {invite.expiresAt ? formatDateTime(invite.expiresAt) : 'never'}
                    </span>
                    <span className="invite-link">{inviteLink(invite.token)}</span>
                  </span>
                  <span className="invite-row-actions">
                    <Badge tone={status === 'Completed' ? 'positive' : status === 'Expired' ? 'danger' : 'warning'}>{status}</Badge>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void copyInviteLink(invite)}>
                      Copy link
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `copy:${invite.id}` ? message : null}
                      tone="success"
                    />
                    <Button type="button" size="sm" variant="ghost" disabled={saving || status === 'Completed'} onClick={() => void resendInvite(invite)}>
                      Resend
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `resend:${invite.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function inviteStatus(invite: StaffInvite) {
  if (invite.completedAt) return 'Completed';
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return 'Expired';
  return 'Pending';
}

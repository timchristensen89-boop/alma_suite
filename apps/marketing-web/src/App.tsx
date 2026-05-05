import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AuthUser,
  MarketingCampaign,
  MarketingCampaignStatus,
  MarketingChannel,
  MarketingContact,
  MarketingOverview
} from '@alma/shared';
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  ProductLogo,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  Textarea,
  TopBar
} from '@alma/ui';
import { withSuiteAppLinks } from './config/suiteLinks';
import { api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const VENUES = ['All venues', 'Alma Avalon', 'St Alma'];
const CHANNELS: MarketingChannel[] = ['EMAIL', 'SMS'];

type ContactForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  venue: string;
  tags: string;
  consentEmail: boolean;
  consentSms: boolean;
  notes: string;
};

type CampaignForm = {
  name: string;
  channel: MarketingChannel;
  audienceName: string;
  subject: string;
  previewText: string;
  body: string;
};

function defaultContactForm(): ContactForm {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    venue: 'Alma Avalon',
    tags: '',
    consentEmail: true,
    consentSms: false,
    notes: ''
  };
}

function defaultCampaignForm(): CampaignForm {
  return {
    name: '',
    channel: 'EMAIL',
    audienceName: 'Reserve guests',
    subject: '',
    previewText: '',
    body: ''
  };
}

function fullName(contact: MarketingContact) {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

function statusTone(status: MarketingCampaignStatus) {
  switch (status) {
    case 'READY':
      return 'positive';
    case 'SENT':
      return 'neutral';
    case 'ARCHIVED':
      return 'danger';
    case 'DRAFT':
    default:
      return 'warning';
  }
}

function campaignAudience(campaign: MarketingCampaign) {
  const recipients = campaign.recipients.length;
  return `${recipients} ${recipients === 1 ? 'recipient' : 'recipients'}`;
}

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadContactsCsv(contacts: MarketingContact[]) {
  const header = ['First name', 'Last name', 'Email', 'Phone', 'Venue', 'Email consent', 'SMS consent', 'Tags'];
  const rows = contacts.map((contact) => [
    contact.firstName,
    contact.lastName,
    contact.email,
    contact.phone,
    contact.venue,
    contact.consentEmail,
    contact.consentSms,
    contact.tags.join(', ')
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `alma-marketing-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function useMarketingAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const handoffUser = await consumeSuiteHandoffToken();
      if (handoffUser) {
        setUser(handoffUser);
        return;
      }
      const data = await api<{ user: AuthUser | null }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installSuiteHandoff(), []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api<{ user: AuthUser; token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setApiAuthToken(session.token);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearApiAuthToken();
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await onLogin(email.trim(), password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <ProductLogo appId="marketing" size="lg" />
        <Card title="Sign in" subtitle="Use your ALMA manager account to open Marketing">
          <form className="login-form" onSubmit={handleSubmit}>
            <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <Input label="Password" type="password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="marketing" apps={suiteApps} />
      </div>
    </main>
  );
}

function MarketingDashboard({ onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [venue, setVenue] = useState('All venues');
  const [data, setData] = useState<MarketingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState(defaultContactForm);
  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);

  const contacts = data?.contacts ?? [];
  const campaigns = data?.campaigns ?? [];
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedContactIds.includes(contact.id)),
    [contacts, selectedContactIds]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams();
      if (venue !== 'All venues') query.set('venue', venue);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      setData(await api<MarketingOverview>(`/api/marketing/overview${suffix}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Marketing');
    } finally {
      setLoading(false);
    }
  }, [venue]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncReserveGuests() {
    setMessage(null);
    try {
      const result = await api<{ ok: true; imported: number }>('/api/marketing/sync-reserve-guests', { method: 'POST' });
      setMessage(`Synced ${result.imported} Reserve guests into Marketing.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sync Reserve guests.');
    }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await api<MarketingContact>('/api/marketing/contacts', {
        method: 'POST',
        body: JSON.stringify({
          ...contactForm,
          tags: contactForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          venue: contactForm.venue === 'All venues' ? '' : contactForm.venue
        })
      });
      setContactForm(defaultContactForm());
      setMessage('Contact saved.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save contact.');
    }
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await api<MarketingCampaign>('/api/marketing/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          ...campaignForm,
          status: 'DRAFT',
          contactIds: selectedContactIds
        })
      });
      setCampaignForm(defaultCampaignForm());
      setSelectedContactIds([]);
      setMessage('Campaign draft saved.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save campaign.');
    }
  }

  async function markCampaignReady(campaign: MarketingCampaign) {
    setMessage(null);
    try {
      await api(`/api/marketing/campaigns/${campaign.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'READY' })
      });
      setMessage('Campaign marked ready. Connect Resend or SMS before sending.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update campaign.');
    }
  }

  function toggleContact(id: string) {
    setSelectedContactIds((current) =>
      current.includes(id) ? current.filter((contactId) => contactId !== id) : [...current, id]
    );
  }

  return (
    <AppShell
      brand={<ProductLogo appId="marketing" size="md" showBrandMark={false} />}
      sidebar={<div className="sidebar-nav" />}
      topBar={
        <TopBar
          title="ALMA Marketing"
          subtitle="Guest lists, segments, and send-ready campaigns"
          right={
            <>
              <SuiteAppSwitcher currentApp="marketing" apps={suiteApps} variant="topbar" />
              <Button type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</Button>
            </>
          }
        />
      }
    >
      <div className="marketing-page">
        <PageHeader
          eyebrow="ALMA Marketing"
          title="Guest marketing base"
          description="Build a clean ALMA-owned guest list from Reserve, create consent-aware audiences, and prepare campaign drafts for email or SMS."
          actions={
            <>
              <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={VENUES.map((value) => ({ label: value, value }))} />
              <Button type="button" variant="secondary" onClick={() => void syncReserveGuests()}>Sync Reserve guests</Button>
              <Button type="button" variant="secondary" onClick={() => downloadContactsCsv(contacts)} disabled={contacts.length === 0}>Export contacts</Button>
            </>
          }
        />

        {message ? <p className={message.includes('Could') || message.includes('invalid') ? 'error-text' : 'subtle'}>{message}</p> : null}

        <div className="stats-grid">
          <StatCard label="Contacts" value={data?.totals.contacts ?? 0} hint="Current filtered list" loading={loading} />
          <StatCard label="Email consent" value={data?.totals.emailConsent ?? 0} hint="Can receive email" loading={loading} />
          <StatCard label="SMS consent" value={data?.totals.smsConsent ?? 0} hint="Can receive SMS" loading={loading} />
          <StatCard label="Ready drafts" value={data?.totals.readyCampaigns ?? 0} hint="Waiting for send provider" loading={loading} />
        </div>

        <div className="marketing-layout">
          <section className="marketing-main">
            <Card title="Contacts" subtitle="Select contacts to build a campaign audience." padding="none">
              {loading ? <Spinner label="Loading contacts..." /> : null}
              {!loading && contacts.length === 0 ? (
                <EmptyState title="No contacts yet" description="Sync Reserve guests or add a contact manually." />
              ) : null}
              <div className="marketing-contact-list">
                {contacts.map((contact) => (
                  <article key={contact.id} className="marketing-contact">
                    <label className="marketing-checkbox">
                      <input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} />
                      <span>
                        <strong>{fullName(contact)}</strong>
                        <small>{contact.email || contact.phone || 'No contact detail'} · {contact.venue || 'No venue'} · {contact.source}</small>
                      </span>
                    </label>
                    <div className="marketing-badges">
                      {contact.consentEmail ? <Badge tone="positive">Email</Badge> : null}
                      {contact.consentSms ? <Badge tone="positive">SMS</Badge> : null}
                      {contact.reserveGuestId ? <Badge tone="neutral">Reserve</Badge> : null}
                    </div>
                  </article>
                ))}
              </div>
            </Card>

            <Card title="Campaign drafts" subtitle="No fake send button here. Drafts become ready lists until Resend or SMS is connected." padding="none">
              {campaigns.length === 0 ? <EmptyState title="No campaigns yet" description="Create the first draft from the selected audience." /> : null}
              <div className="marketing-campaign-list">
                {campaigns.map((campaign) => (
                  <article key={campaign.id} className="marketing-campaign">
                    <div>
                      <strong>{campaign.name}</strong>
                      <span>{campaign.channel} · {campaignAudience(campaign)} · {campaign.audienceName || 'Manual audience'}</span>
                      {campaign.subject ? <em>{campaign.subject}</em> : null}
                    </div>
                    <div className="marketing-campaign-actions">
                      <Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>
                      {campaign.status === 'DRAFT' ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => void markCampaignReady(campaign)}>Mark ready</Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </Card>
          </section>

          <aside className="marketing-side">
            <Card title="New campaign" subtitle={`${selectedContacts.length} selected contacts`}>
              <form className="marketing-form" onSubmit={(event) => void saveCampaign(event)}>
                <div className="form-grid two">
                  <Input label="Campaign name" required value={campaignForm.name} onChange={(event) => setCampaignForm({ ...campaignForm, name: event.currentTarget.value })} />
                  <Select label="Channel" value={campaignForm.channel} onChange={(event) => setCampaignForm({ ...campaignForm, channel: event.currentTarget.value as MarketingChannel })} options={CHANNELS.map((value) => ({ label: value, value }))} />
                </div>
                <Input label="Audience name" value={campaignForm.audienceName} onChange={(event) => setCampaignForm({ ...campaignForm, audienceName: event.currentTarget.value })} />
                <Input label="Subject" value={campaignForm.subject} onChange={(event) => setCampaignForm({ ...campaignForm, subject: event.currentTarget.value })} />
                <Input label="Preview text" value={campaignForm.previewText} onChange={(event) => setCampaignForm({ ...campaignForm, previewText: event.currentTarget.value })} />
                <Textarea label="Message" required rows={6} value={campaignForm.body} onChange={(event) => setCampaignForm({ ...campaignForm, body: event.currentTarget.value })} />
                <Button type="submit">Save draft</Button>
              </form>
            </Card>

            <Card title="Add contact" subtitle="Manual VIPs, locals, suppliers, and event leads.">
              <form className="marketing-form" onSubmit={(event) => void saveContact(event)}>
                <div className="form-grid two">
                  <Input label="First name" required value={contactForm.firstName} onChange={(event) => setContactForm({ ...contactForm, firstName: event.currentTarget.value })} />
                  <Input label="Last name" required value={contactForm.lastName} onChange={(event) => setContactForm({ ...contactForm, lastName: event.currentTarget.value })} />
                  <Input label="Email" type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.currentTarget.value })} />
                  <Input label="Phone" value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.currentTarget.value })} />
                </div>
                <Select label="Venue" value={contactForm.venue} onChange={(event) => setContactForm({ ...contactForm, venue: event.currentTarget.value })} options={VENUES.map((value) => ({ label: value, value }))} />
                <Input label="Tags" value={contactForm.tags} onChange={(event) => setContactForm({ ...contactForm, tags: event.currentTarget.value })} placeholder="VIP, local, birthday, event" />
                <div className="marketing-consent-row">
                  <label><input type="checkbox" checked={contactForm.consentEmail} onChange={(event) => setContactForm({ ...contactForm, consentEmail: event.currentTarget.checked })} /> Email consent</label>
                  <label><input type="checkbox" checked={contactForm.consentSms} onChange={(event) => setContactForm({ ...contactForm, consentSms: event.currentTarget.checked })} /> SMS consent</label>
                </div>
                <Textarea label="Notes" rows={3} value={contactForm.notes} onChange={(event) => setContactForm({ ...contactForm, notes: event.currentTarget.value })} />
                <Button type="submit" variant="secondary">Save contact</Button>
              </form>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function App() {
  const auth = useMarketingAuth();

  if (auth.loading) {
    return (
      <div className="login-page">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (!auth.user) return <LoginScreen onLogin={auth.login} />;

  return <MarketingDashboard user={auth.user} onLogout={auth.logout} />;
}

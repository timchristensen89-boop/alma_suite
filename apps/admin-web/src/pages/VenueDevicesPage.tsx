import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminVenueDevicesPayload, AdminVenueDeviceSummary } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';
import { useDocumentTitle } from '../../../web/src/hooks/useDocumentTitle';

type DeviceForm = {
  displayName: string;
  email: string;
  venue: string;
};

const EMPTY_FORM: DeviceForm = {
  displayName: '',
  email: '',
  venue: ''
};

function accessSummary(device: AdminVenueDeviceSummary) {
  return device.appAccess
    .filter((access) => access.status === 'ENABLED')
    .map((access) => access.appId.toLowerCase().replace(/^\w/, (char) => char.toUpperCase()))
    .join(', ') || 'No enabled apps';
}

export function VenueDevicesPage() {
  useDocumentTitle('Venue iPad accounts · Alma Admin');
  const [payload, setPayload] = useState<AdminVenueDevicesPayload | null>(null);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const devices = payload?.devices ?? [];
  const venues = useMemo(
    () => Array.from(new Set(devices.map((device) => device.venue).filter(Boolean))).sort() as string[],
    [devices]
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPayload(await api<AdminVenueDevicesPayload>('/api/admin/venue-devices'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load venue iPad accounts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await api('/api/admin/venue-devices', {
        method: 'POST',
        body: JSON.stringify({ ...form, enabled: true })
      });
      setForm(EMPTY_FORM);
      setFeedback('Venue iPad account created. Use the normal password reset/setup flow before putting it on a real device.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create venue iPad account.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(device: AdminVenueDeviceSummary) {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/admin/venue-devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !device.enabled })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update venue iPad account.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="admin-section-heading">
        <p>Shared work devices</p>
        <h2>Venue iPad accounts</h2>
        <span>Device accounts sign in once, then staff switch into their own context with a PIN.</span>
      </div>

      <Card
        title="Safety model"
        subtitle="Shared venue accounts are for operational workflows only."
      >
        <div className="admin-grid two">
          <div className="admin-provider-card">
            <strong>Allowed by default</strong>
            <ul className="admin-device-policy-list">
              <li>Gift Cards redeem and lookup</li>
              <li>Stock levels and stocktakes</li>
              <li>Roster and shift checks</li>
              <li>Reserve bookings for the assigned venue</li>
              <li>Compliance checklists and operational tasks</li>
            </ul>
          </div>
          <div className="admin-provider-card">
            <strong>Blocked on shared devices</strong>
            <ul className="admin-device-policy-list">
              <li>Alma Admin, settings, integrations, and Xero</li>
              <li>HR, payroll, pay changes, and right-to-work documents</li>
              <li>Reports exports and all-venue financial data</li>
              <li>Staff compliance documents and sensitive records</li>
            </ul>
          </div>
        </div>
      </Card>

      <details className="admin-collapsible">
        <summary>Create venue iPad account</summary>
        <Card title="New device account" subtitle="No production passwords are generated or shown here.">
          <form className="admin-form-grid" onSubmit={submit}>
            <Input
              label="Display name"
              value={form.displayName}
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Alma Avalon iPad"
              required
            />
            <Input
              label="Login email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="ipad.avalon@almagroup.com.au"
              required
            />
            <Input
              label="Venue"
              value={form.venue}
              onChange={(event) => setForm((current) => ({ ...current, venue: event.target.value }))}
              list="venue-device-venues"
              placeholder="Alma Avalon"
              required
            />
            <datalist id="venue-device-venues">
              {venues.map((venue) => <option key={venue} value={venue} />)}
            </datalist>
            <div className="admin-form-actions">
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create account'}</Button>
            </div>
          </form>
        </Card>
      </details>

      {error ? <div className="error-banner">{error}</div> : null}
      {feedback ? <div className="success-banner">{feedback}</div> : null}

      {loading ? <Spinner label="Loading venue iPad accounts" /> : null}
      {!loading && !devices.length ? (
        <EmptyState title="No venue iPad accounts yet" description="Create St Alma and Alma Avalon shared device accounts when you are ready to activate the iPad flow." />
      ) : null}

      <div className="admin-access-grid">
        {devices.map((device) => (
          <article key={device.id} className="admin-access-card">
            <div>
              <strong>{device.displayName}</strong>
              <small>{device.venue || 'No venue'} · {device.email || 'No email'}</small>
            </div>
            <Badge tone={device.enabled ? 'positive' : 'muted'} dot>{device.enabled ? 'Active' : 'Disabled'}</Badge>
            <p className="muted">{accessSummary(device)}</p>
            <p className="muted">
              PIN switcher enabled. Effective access is staff permissions intersected with device-safe permissions.
            </p>
            <div className="admin-row-actions">
              <Button variant="secondary" type="button" onClick={() => toggle(device)} disabled={saving}>
                {device.enabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

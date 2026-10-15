import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OPENTABLE_BEVERAGES,
  OPENTABLE_CUISINES,
  OPENTABLE_DAYS,
  OPENTABLE_DIETARY_OPTIONS,
  OPENTABLE_DINING_STYLES,
  OPENTABLE_DRESS_CODES,
  OPENTABLE_PAYMENT_OPTIONS,
  OPENTABLE_PROFILE_FIELDS,
  OPENTABLE_SMOKING_OPTIONS,
  almaVenueProfileSchema,
  type AlmaVenueProfile,
  type OpenTableCapabilityState,
  type OpenTableMenusPreview,
  type OpenTableOverview,
  type OpenTableProfilePreview,
  type OpenTablePublishResult,
  type OpenTableRunSummary,
  type OpenTableVenueStatus
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

/**
 * Settings → Integrations → OpenTable.
 *
 * One venue at a time (St Alma / Alma Avalon), four panels: connection,
 * menus, restaurant profile, activity. Every state shown here comes from the
 * API's derivation (apps/api/src/services/opentable.service.ts) — the page
 * never decides a venue is "connected" on its own, and never says anything
 * is live on OpenTable: the free APIs accept a submission and process it
 * asynchronously, and visibility is set in OpenTable for Restaurants.
 */

type Tone = 'positive' | 'warning' | 'danger' | 'muted' | 'info' | 'neutral';

const STATE_TONE: Record<OpenTableCapabilityState, Tone> = {
  NOT_CONFIGURED: 'muted',
  AWAITING_APPROVAL: 'warning',
  CONNECTED: 'info',
  OUT_OF_DATE: 'warning',
  SUBMITTED: 'info',
  SYNCED: 'positive',
  ERROR: 'danger'
};

/**
 * Labels say what is known. The write APIs are asynchronous with no status
 * endpoint, so "Accepted by API" is as far as a submission can be taken
 * unless a read-back verified it; nothing here says "live" or "synced".
 */
const STATE_LABEL: Record<OpenTableCapabilityState, string> = {
  NOT_CONFIGURED: 'Not configured',
  AWAITING_APPROVAL: 'Awaiting approval',
  CONNECTED: 'Ready to submit',
  OUT_OF_DATE: 'Ready to submit · changes pending',
  SUBMITTED: 'Submitted to OpenTable',
  SYNCED: 'Accepted by API',
  ERROR: 'Failed'
};

/** The Connection panel is the one place "Connected" means exactly that: a token was issued. */
const CONNECTION_LABEL: Partial<Record<OpenTableCapabilityState, string>> = { CONNECTED: 'Connected' };

const RUN_TONE: Record<OpenTableRunSummary['status'], Tone> = {
  PREPARED: 'muted',
  SKIPPED: 'muted',
  SUBMITTED: 'info',
  ACCEPTED: 'positive',
  PARTIAL: 'warning',
  FAILED: 'danger'
};

function when(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function StateBadge({ state, verified, connection }: { state: OpenTableCapabilityState; verified?: boolean; connection?: boolean }) {
  const label = connection ? CONNECTION_LABEL[state] ?? STATE_LABEL[state] : STATE_LABEL[state];
  return (
    <Badge tone={STATE_TONE[state]} dot>
      {label}
      {state === 'SYNCED' && !connection ? (verified ? ' · verified by read-back' : ' · publication not verified') : ''}
    </Badge>
  );
}

function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`ot-tick ${on ? 'is-on' : 'is-off'}`}>
      <span aria-hidden="true">{on ? '●' : '○'}</span> {label}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function OpenTableIntegrationPage() {
  const [overview, setOverview] = useState<OpenTableOverview | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [status, setStatus] = useState<OpenTableVenueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  const notify = useCallback((text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setTone(kind);
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const payload = await api<OpenTableOverview>('/api/integrations/opentable');
      setOverview(payload);
      setVenueId((current) => current ?? payload.venues[0]?.id ?? null);
    } catch (error) {
      notify(errorMessage(error, 'Could not load the OpenTable overview'), 'error');
      setLoading(false);
    }
  }, [notify]);

  const loadStatus = useCallback(
    async (id: string, refresh = false) => {
      try {
        const payload = await api<OpenTableVenueStatus>(`/api/integrations/opentable/venues/${id}${refresh ? '?refresh=1' : ''}`);
        setStatus(payload);
      } catch (error) {
        notify(errorMessage(error, 'Could not load the venue status'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!venueId) return;
    setLoading(true);
    setStatus(null);
    void loadStatus(venueId);
  }, [venueId, loadStatus]);

  const run = useCallback(
    async (key: string, action: () => Promise<string | void>) => {
      if (!venueId) return;
      setBusy(key);
      setMessage(null);
      try {
        const text = await action();
        if (text) notify(text);
        await loadStatus(venueId);
        await loadOverview();
      } catch (error) {
        notify(errorMessage(error, 'The action failed'), 'error');
      } finally {
        setBusy(null);
      }
    },
    [venueId, loadStatus, loadOverview, notify]
  );

  return (
    <div className="admin-page-stack ot-page">
      <Card
        title="OpenTable"
        subtitle={
          overview
            ? `Free partner APIs only (Menus Partner, Restaurant Content Partner) · ${overview.environment === 'production' ? 'Production' : 'Pre-production'} hosts · outbound calls ${overview.apiEnabled ? 'enabled' : 'disabled'}`
            : 'Menus and restaurant profile, pushed from Alma Suite on request'
        }
        action={
          <Button type="button" variant="secondary" onClick={() => venueId && void loadStatus(venueId, true)} disabled={!venueId || busy !== null}>
            Refresh
          </Button>
        }
      >
        <ActionFeedback message={message} tone={tone} />
        {overview && overview.venues.length > 0 ? (
          <div className="ot-venue-switch" role="tablist" aria-label="Venue">
            {overview.venues.map((venue) => (
              <Button
                key={venue.id}
                type="button"
                role="tab"
                aria-selected={venue.id === venueId}
                variant={venue.id === venueId ? 'primary' : 'secondary'}
                onClick={() => setVenueId(venue.id)}
              >
                {venue.name}
                {venue.rid ? <span className="ot-venue-rid">rid {venue.rid}</span> : null}
              </Button>
            ))}
          </div>
        ) : overview ? (
          <EmptyState title="No venues in your Menus scope" description="Ask an admin to widen your Menus access to see a venue here." />
        ) : null}
        <p className="muted small ot-note">
          The booking hand-off on the website is unchanged by anything on this page. Reviews, reservations and guest data are paid OpenTable APIs and are
          not used.
        </p>
      </Card>

      {loading && !status ? (
        <div className="ot-loading">
          <Spinner /> Loading…
        </div>
      ) : null}

      {status ? (
        <>
          <ConnectionPanel status={status} busy={busy} onRun={run} />
          <MenusPanel status={status} busy={busy} onRun={run} />
          <ProfilePanel status={status} busy={busy} onRun={run} />
          <ActivityPanel status={status} />
        </>
      ) : null}
    </div>
  );
}

type PanelProps = {
  status: OpenTableVenueStatus;
  busy: string | null;
  onRun: (key: string, action: () => Promise<string | void>) => Promise<void>;
};

// ---------------------------------------------------------------------------
// CONNECTION
// ---------------------------------------------------------------------------

function ConnectionPanel({ status, busy, onRun }: PanelProps) {
  const [rid, setRid] = useState(status.rid ?? '');
  const [enabled, setEnabled] = useState(status.enabled);
  const [menusEnabled, setMenusEnabled] = useState(status.menusEnabled);
  const [profileEnabled, setProfileEnabled] = useState(status.profileEnabled);
  useEffect(() => {
    setRid(status.rid ?? '');
    setEnabled(status.enabled);
    setMenusEnabled(status.menusEnabled);
    setProfileEnabled(status.profileEnabled);
  }, [status.venue.id, status.rid, status.enabled, status.menusEnabled, status.profileEnabled]);

  const dirty = rid !== (status.rid ?? '') || enabled !== status.enabled || menusEnabled !== status.menusEnabled || profileEnabled !== status.profileEnabled;
  const c = status.connection;

  return (
    <Card
      title={
        <span className="ot-title">
          Connection <StateBadge state={c.state} connection />
        </span>
      }
      subtitle={c.detail}
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || !status.rid}
          onClick={() =>
            void onRun('check', async () => {
              const result = await api<OpenTableVenueStatus['connection']>(`/api/integrations/opentable/venues/${status.venue.id}/connection/check`, { method: 'POST' });
              return result.state === 'CONNECTED' ? 'OpenTable issued a token for these credentials.' : result.detail;
            })
          }
        >
          {busy === 'check' ? 'Checking…' : 'Check connection'}
        </Button>
      }
    >
      <div className="ot-grid-2">
        <div className="detail-list">
          <div>
            <span>Server credentials</span>
            <strong className="ot-ticks">
              <Tick on={c.configured.clientId} label="Client id" />
              <Tick on={c.configured.clientSecret} label="Secret" />
              <Tick on={c.configured.partnerName} label="Partner name" />
            </strong>
          </div>
          <div>
            <span>Server flags</span>
            <strong className="ot-ticks">
              <Tick on={c.flags.api} label="API" />
              <Tick on={c.flags.menusWrite} label="Menus write" />
              <Tick on={c.flags.menusRead} label="Menus read" />
              <Tick on={c.flags.profileWrite} label="Profile write" />
            </strong>
          </div>
          <div>
            <span>Hosts</span>
            <strong>{c.environment === 'production' ? 'platform.opentable.com' : 'platform.otqa.com (pre-production)'}</strong>
          </div>
          <div>
            <span>Last check</span>
            <strong>
              {when(c.lastCheckAt)}
              {c.lastOk === true ? ' · token issued' : c.lastOk === false ? ' · failed' : ''}
            </strong>
          </div>
          {c.lastError ? <div className="integration-health-error">{c.lastError}</div> : null}
        </div>

        <form
          className="ot-settings"
          onSubmit={(event) => {
            event.preventDefault();
            void onRun('settings', async () => {
              await api(`/api/integrations/opentable/venues/${status.venue.id}/settings`, {
                method: 'PUT',
                body: JSON.stringify({ rid, enabled, menusEnabled, profileEnabled })
              });
              return 'Venue settings saved.';
            });
          }}
        >
          <Input label="OpenTable restaurant id (rid)" value={rid} onChange={(event) => setRid(event.target.value)} placeholder="e.g. 211307" inputMode="numeric" hint="The number in the website's booking link (restref)." />
          <label className="field-checkbox">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> OpenTable on for {status.venue.name}
          </label>
          <label className="field-checkbox">
            <input type="checkbox" checked={menusEnabled} onChange={(event) => setMenusEnabled(event.target.checked)} /> Allow menu publishing
          </label>
          <label className="field-checkbox">
            <input type="checkbox" checked={profileEnabled} onChange={(event) => setProfileEnabled(event.target.checked)} /> Allow profile publishing
          </label>
          <div className="admin-form-actions">
            <Button type="submit" size="sm" disabled={!dirty || busy !== null}>
              {busy === 'settings' ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MENUS
// ---------------------------------------------------------------------------

function MenusPanel({ status, busy, onRun }: PanelProps) {
  const m = status.menus;
  const [preview, setPreview] = useState<OpenTableMenusPreview | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    setPreview(null);
    setConfirmed([]);
    setAcknowledged(false);
  }, [status.venue.id, m.currentHash]);

  const removalsOutstanding = m.removals.filter((name) => !confirmed.includes(name));
  const needsAcknowledgement = m.firstSubmission || m.shrink !== null;
  const publishBlocked =
    m.state === 'NOT_CONFIGURED' || m.state === 'SUBMITTED' || !m.canPublish || m.included.length === 0 || m.validation.length > 0 || removalsOutstanding.length > 0 || (needsAcknowledgement && !acknowledged);
  const alreadyAccepted = m.lastAcceptedHash === m.currentHash;
  const remote = m.remote?.comparison ?? null;

  const publish = (force: boolean) =>
    onRun(force ? 'resend' : 'publish', async () => {
      const result = await api<OpenTablePublishResult>(`/api/integrations/opentable/venues/${status.venue.id}/menus/publish`, {
        method: 'POST',
        body: JSON.stringify({ hash: m.currentHash, confirmRemovals: confirmed, acknowledgeReplace: acknowledged, force })
      });
      return result.message;
    });

  return (
    <Card
      title={
        <span className="ot-title">
          Menus <StateBadge state={m.state} verified={m.verified} />
        </span>
      }
      subtitle={m.detail}
      action={
        <div className="inline-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void onRun('preview', async () => {
                setPreview(await api<OpenTableMenusPreview>(`/api/integrations/opentable/venues/${status.venue.id}/menus/preview`));
              })
            }
          >
            {preview ? 'Reload JSON' : 'Preview JSON'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy !== null || !status.rid}
            onClick={() =>
              void onRun('read', async () => {
                const result = await api<OpenTablePublishResult>(`/api/integrations/opentable/venues/${status.venue.id}/menus/read`, { method: 'POST' });
                return result.message;
              })
            }
          >
            {busy === 'read' ? 'Reading…' : 'Read from OpenTable'}
          </Button>
          {alreadyAccepted && m.state === 'SYNCED' ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy !== null || publishBlocked} onClick={() => void publish(true)}>
              {busy === 'resend' ? 'Sending…' : 'Resend'}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy !== null || publishBlocked || alreadyAccepted} onClick={() => void publish(false)} title={!m.canPublish ? 'You are not a publisher for this venue' : undefined}>
              {busy === 'publish' ? 'Sending…' : 'Publish to OpenTable'}
            </Button>
          )}
        </div>
      }
    >
      {!m.canPublish ? (
        <p className="integration-health-paused">
          You can view and compare, but publishing {status.venue.name}'s menus to OpenTable needs the same permission as publishing them in Alma Menus.
        </p>
      ) : null}

      <div className="detail-list ot-detail-row">
        <div>
          <span>Last accepted by API</span>
          <strong>
            {when(m.lastAcceptedAt)}
            {m.lastRequestId ? ` · request ${m.lastRequestId}` : ''}
          </strong>
        </div>
        <div>
          <span>Publication</span>
          <strong>{m.verified ? `Verified by read-back ${when(m.remote?.readAt)}` : m.lastAcceptedAt ? 'Not verified — check OpenTable for Restaurants or read back' : '—'}</strong>
        </div>
        <div>
          <span>Current payload</span>
          <strong className="ot-mono">{m.currentHash.slice(0, 12)}</strong>
        </div>
      </div>

      <h4 className="ot-h4">What will be sent</h4>
      {m.included.length === 0 ? (
        <EmptyState title="Nothing to send" description="No published, public menu for this venue yet. Publish one in Alma Menus first." />
      ) : (
        <div className="table-card ot-table">
          <table>
            <thead>
              <tr>
                <th>Menu</th>
                <th>Kind</th>
                <th>Version</th>
                <th>Published</th>
                <th>Groups</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {m.included.map((menu) => (
                <tr key={menu.slug}>
                  <td>
                    <strong>{menu.displayName}</strong>
                    <span className="subtle"> {menu.slug}</span>
                  </td>
                  <td>{menu.kind}</td>
                  <td>v{menu.versionNumber}</td>
                  <td>{when(menu.publishedAt)}</td>
                  <td>{menu.groups}</td>
                  <td>{menu.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {m.excluded.length ? (
        <p className="muted small">
          Not sent: {m.excluded.map((menu) => `${menu.name} (${menu.reason})`).join(' · ')}
        </p>
      ) : null}
      {m.warnings.length ? (
        <ul className="ot-warnings">
          {m.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {m.validation.length ? (
        <div className="integration-health-error">
          <strong>Not safe to send.</strong> A full-menu submission replaces everything on OpenTable, so a broken payload is refused:
          <ul>
            {m.validation.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {needsAcknowledgement && m.included.length > 0 ? (
        <div className="integration-health-paused">
          <p>
            <strong>{m.firstSubmission ? 'First submission.' : 'This submission is much smaller than the last one OpenTable accepted.'}</strong>{' '}
            {m.firstSubmission
              ? 'Sending replaces every menu OpenTable currently holds for this restaurant, including anything entered by hand in OpenTable for Restaurants. Check the list above and the JSON preview first.'
              : `It carries ${m.shrink?.nextItems} items where OpenTable last accepted ${m.shrink?.previousItems}. Anything not in this payload is removed.`}
          </p>
          <label className="field-checkbox">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I understand this replaces the menus OpenTable holds today
          </label>
        </div>
      ) : null}

      <h4 className="ot-h4">Pending changes since the last accepted submission</h4>
      {!m.diff ? (
        <p className="muted small">OpenTable has never accepted a submission for this venue, so everything above is new.</p>
      ) : m.diff.unchanged ? (
        <p className="muted small">No differences. What OpenTable last accepted matches Alma.</p>
      ) : (
        <div className="ot-diff">
          {m.diff.menusAdded.length ? <p>Menus added: {m.diff.menusAdded.join(', ')}</p> : null}
          {m.diff.menusChanged.length ? <p>Menus changed: {m.diff.menusChanged.join(', ')}</p> : null}
          {m.diff.menusRemoved.length ? (
            <div className="integration-health-error">
              <p>
                <strong>Menus that will disappear from OpenTable:</strong> a submission replaces every menu, so anything not listed above is removed.
              </p>
              {m.diff.menusRemoved.map((name) => (
                <label key={name} className="field-checkbox">
                  <input type="checkbox" checked={confirmed.includes(name)} onChange={(event) => setConfirmed((current) => (event.target.checked ? [...current, name] : current.filter((entry) => entry !== name)))} />
                  Yes, remove “{name}” from OpenTable
                </label>
              ))}
            </div>
          ) : null}
          {m.diff.items.length ? (
            <div className="table-card ot-table">
              <table>
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>Menu</th>
                    <th>Group</th>
                    <th>Item</th>
                    <th>Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {m.diff.items.slice(0, 200).map((entry, index) => (
                    <tr key={`${entry.menu}-${entry.group}-${entry.item}-${index}`}>
                      <td>
                        <span className={`pill status-${entry.change === 'removed' ? 'closed' : entry.change === 'added' ? 'open' : 'partial'}`}>{entry.change}</span>
                      </td>
                      <td>{entry.menu}</td>
                      <td>{entry.group}</td>
                      <td>{entry.item}</td>
                      <td className="subtle">{entry.fields.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      <h4 className="ot-h4">Alma Suite vs OpenTable</h4>
      {!status.connection.flags.menusRead ? (
        <p className="muted small">
          Reading menus back from OpenTable is switched off on the server (OPENTABLE_MENUS_READ_ENABLED) and may not be available to a publishing
          partner at all. Compare by eye in{' '}
          <a href={status.links.restaurantCentre} target="_blank" rel="noreferrer">
            OpenTable for Restaurants → Menus
          </a>
          .
        </p>
      ) : null}
      {remote ? (
        <div className="ot-compare">
          <p className="muted small">Read {when(m.remote?.readAt)}.</p>
          {remote.hostedMenuUrl ? (
            <p className="integration-health-paused">
              OpenTable currently serves a hosted menu link ({remote.hostedMenuUrl}) rather than native menus. Your submission will replace that once
              the restaurant enables native menus in OpenTable for Restaurants.
            </p>
          ) : null}
          {remote.inSync ? <p className="integration-health-line">In sync: every Alma item is on OpenTable with the same price and description.</p> : null}
          <CompareList title="Menus only in Alma" rows={remote.menusOnlyInAlma} />
          <CompareList title="Menus only on OpenTable (left alone; remove in OpenTable for Restaurants if unwanted)" rows={remote.menusOnlyOnOpenTable} />
          <CompareList title="Items missing on OpenTable" rows={remote.itemsMissingOnOpenTable.map((row) => `${row.menu} › ${row.group} › ${row.item}`)} />
          <CompareList title="Items only on OpenTable" rows={remote.itemsOnlyOnOpenTable.map((row) => `${row.menu} › ${row.group} › ${row.item}`)} />
          <CompareList title="Price differences" rows={remote.priceDifferences.map((row) => `${row.menu} › ${row.item}: Alma ${row.alma} · OpenTable ${row.opentable}`)} />
          <CompareList title="Description differences" rows={remote.descriptionDifferences.map((row) => `${row.menu} › ${row.item}`)} />
        </div>
      ) : null}

      {preview ? (
        <details className="admin-collapsible" open>
          <summary>Exact JSON that will be sent ({preview.hash.slice(0, 12)})</summary>
          <pre className="ot-json">{JSON.stringify(preview.payload, null, 2)}</pre>
        </details>
      ) : null}
    </Card>
  );
}

function CompareList({ title, rows }: { title: string; rows: string[] }) {
  if (!rows.length) return null;
  return (
    <div className="ot-compare-block">
      <strong>{title}</strong>
      <ul>
        {rows.slice(0, 100).map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RESTAURANT PROFILE
// ---------------------------------------------------------------------------

type ProfileDraft = {
  name: string;
  description: string;
  primaryCuisine: string;
  otherCuisines: string[];
  phone: string;
  website: string;
  locale: string;
  currency: string;
  timeZone: string;
  priceBandId: string;
  diningStyle: string;
  dressCode: string;
  publicTransit: string;
  privateEventDetails: string;
  cateringDetails: string;
  executiveChef: string;
  crossStreet: string;
  menuUrl: string;
  profileImageUrl: string;
  imageUrls: string;
  tags: string;
  openingTimes: Record<string, string>;
  paymentOptions: string[];
  beverages: string[];
  dietaryOptions: string[];
  smokingOptions: string[];
};

function toDraft(profile: AlmaVenueProfile): ProfileDraft {
  return {
    name: profile.name,
    description: profile.description ?? '',
    primaryCuisine: profile.primaryCuisine ?? '',
    otherCuisines: profile.otherCuisines,
    phone: profile.phone ?? '',
    website: profile.website ?? '',
    locale: profile.locale,
    currency: profile.currency,
    timeZone: profile.timeZone,
    priceBandId: profile.priceBandId ? String(profile.priceBandId) : '',
    diningStyle: profile.diningStyle ?? '',
    dressCode: profile.dressCode ?? '',
    publicTransit: profile.publicTransit ?? '',
    privateEventDetails: profile.privateEventDetails ?? '',
    cateringDetails: profile.cateringDetails ?? '',
    executiveChef: profile.executiveChef ?? '',
    crossStreet: profile.crossStreet ?? '',
    menuUrl: profile.menuUrl ?? '',
    profileImageUrl: profile.profileImageUrl ?? '',
    imageUrls: profile.imageUrls.join('\n'),
    tags: profile.tags.join(', '),
    openingTimes: Object.fromEntries(OPENTABLE_DAYS.map((day) => [day, (profile.openingTimes[day] ?? []).map((range) => `${range.start}-${range.end}`).join(', ')])),
    paymentOptions: profile.paymentOptions,
    beverages: profile.beverages,
    dietaryOptions: profile.dietaryOptions,
    smokingOptions: profile.smokingOptions
  };
}

function fromDraft(draft: ProfileDraft, previous: AlmaVenueProfile): AlmaVenueProfile {
  const list = (text: string, separator: RegExp) => text.split(separator).map((entry) => entry.trim()).filter(Boolean);
  const openingTimes: Record<string, Array<{ start: string; end: string }>> = {};
  for (const day of OPENTABLE_DAYS) {
    const ranges = list(draft.openingTimes[day] ?? '', /[,;]/).map((range) => {
      const [start, end] = range.split(/\s*[-–]\s*/);
      return { start: start ?? '', end: end ?? '' };
    });
    if (ranges.length) openingTimes[day] = ranges;
  }
  return almaVenueProfileSchema.parse({
    name: draft.name,
    description: draft.description,
    primaryCuisine: draft.primaryCuisine || undefined,
    otherCuisines: draft.otherCuisines,
    phone: draft.phone,
    website: draft.website,
    locale: draft.locale,
    currency: draft.currency,
    timeZone: draft.timeZone,
    priceBandId: draft.priceBandId ? Number(draft.priceBandId) : undefined,
    diningStyle: draft.diningStyle || undefined,
    dressCode: draft.dressCode || undefined,
    publicTransit: draft.publicTransit,
    privateEventDetails: draft.privateEventDetails,
    cateringDetails: draft.cateringDetails,
    executiveChef: draft.executiveChef,
    crossStreet: draft.crossStreet,
    menuUrl: draft.menuUrl,
    profileImageUrl: draft.profileImageUrl,
    imageUrls: list(draft.imageUrls, /\n/),
    tags: list(draft.tags, /,/),
    openingTimes,
    paymentOptions: draft.paymentOptions,
    beverages: draft.beverages,
    dietaryOptions: draft.dietaryOptions,
    smokingOptions: draft.smokingOptions,
    location: previous.location
  });
}

const PROFILE_STATE_TONE: Record<'in_sync' | 'pending' | 'never_sent' | 'unmanaged', Tone> = { in_sync: 'positive', pending: 'warning', never_sent: 'info', unmanaged: 'muted' };
const PROFILE_STATE_LABEL = { in_sync: 'In sync', pending: 'Pending', never_sent: 'Not yet sent', unmanaged: 'Not managed' } as const;

function ProfilePanel({ status, busy, onRun }: PanelProps) {
  const p = status.profile;
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(p.profile));
  const [managed, setManaged] = useState<string[]>(p.managedFields);
  const [preview, setPreview] = useState<OpenTableProfilePreview | null>(null);
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(toDraft(p.profile));
    setManaged(p.managedFields);
    setPreview(null);
    setFormError(null);
  }, [status.venue.id, p.currentHash, p.profile, p.managedFields]);

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleManaged = (key: string, on: boolean) => setManaged((current) => (on ? Array.from(new Set([...current, key])) : current.filter((entry) => entry !== key)));
  const toggleIn = (key: 'otherCuisines' | 'paymentOptions' | 'beverages' | 'dietaryOptions' | 'smokingOptions', value: string, on: boolean) =>
    setDraft((current) => ({ ...current, [key]: on ? Array.from(new Set([...current[key], value])) : current[key].filter((entry) => entry !== value) }));

  const managedLabel = (key: string, label: string) => (
    <label className="field-checkbox ot-managed">
      <input type="checkbox" checked={managed.includes(key)} onChange={(event) => toggleManaged(key, event.target.checked)} /> Alma manages {label.toLowerCase()}
    </label>
  );

  const pendingCount = p.comparison.filter((row) => row.state === 'pending' || row.state === 'never_sent').length;
  const alreadyAccepted = p.lastAcceptedHash === p.currentHash;
  const publishBlocked = p.state === 'NOT_CONFIGURED' || p.managedFields.length === 0;

  const save = () =>
    onRun('profile-save', async () => {
      let profile: AlmaVenueProfile;
      try {
        profile = fromDraft(draft, p.profile);
      } catch (error) {
        const issue = error instanceof Error && 'issues' in error ? (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues[0] : null;
        throw new Error(issue ? `${issue.path.join('.')}: ${issue.message}` : 'The profile has an invalid value.');
      }
      await api(`/api/integrations/opentable/venues/${status.venue.id}/profile`, { method: 'PUT', body: JSON.stringify({ profile, managedFields: managed }) });
      setEditing(false);
      return 'Profile saved in Alma. Nothing was sent to OpenTable.';
    });

  const publish = (force: boolean) =>
    onRun(force ? 'profile-resend' : 'profile-publish', async () => {
      const result = await api<OpenTablePublishResult>(`/api/integrations/opentable/venues/${status.venue.id}/profile/publish`, { method: 'POST', body: JSON.stringify({ hash: p.currentHash, force }) });
      return result.message;
    });

  return (
    <Card
      title={
        <span className="ot-title">
          Restaurant profile <StateBadge state={p.state} />
        </span>
      }
      subtitle={p.detail}
      action={
        <div className="inline-actions">
          <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => setEditing((current) => !current)}>
            {editing ? 'Close editor' : 'Edit profile'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void onRun('profile-preview', async () => {
                setPreview(await api<OpenTableProfilePreview>(`/api/integrations/opentable/venues/${status.venue.id}/profile/preview`));
              })
            }
          >
            Preview JSON
          </Button>
          {alreadyAccepted && p.state === 'SYNCED' ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy !== null || publishBlocked} onClick={() => void publish(true)}>
              {busy === 'profile-resend' ? 'Sending…' : 'Resend'}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy !== null || publishBlocked || alreadyAccepted} onClick={() => void publish(false)}>
              {busy === 'profile-publish' ? 'Sending…' : `Publish ${p.managedFields.length} field${p.managedFields.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      }
    >
      <p className="muted small">
        The Restaurant Content API writes field by field and cannot read the live profile back. "OpenTable" below is what Alma last sent and OpenTable
        accepted; check the public page in{' '}
        <a href={status.links.restaurantCentre} target="_blank" rel="noreferrer">
          OpenTable for Restaurants
        </a>{' '}
        for anything not managed here. Only ticked fields are ever sent; everything else on OpenTable is left untouched.
      </p>

      <div className="table-card ot-table">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Alma Suite</th>
              <th>OpenTable (last accepted)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {p.comparison.map((row) => (
              <tr key={row.key} className={row.managed ? '' : 'ot-row-muted'}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                <td className="ot-cell">{row.alma || <span className="subtle">—</span>}</td>
                <td className="ot-cell">{row.lastSent === null ? <span className="subtle">never sent</span> : row.lastSent || <span className="subtle">cleared</span>}</td>
                <td>
                  <Badge tone={PROFILE_STATE_TONE[row.state]}>{PROFILE_STATE_LABEL[row.state]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {pendingCount ? `${pendingCount} managed field${pendingCount === 1 ? '' : 's'} differ${pendingCount === 1 ? 's' : ''} from what OpenTable last accepted.` : 'Managed fields match what OpenTable last accepted.'}
        {Object.keys(p.websiteHints).length ? ` Website / POS values for reference: ${Object.entries(p.websiteHints).map(([key, value]) => `${key} ${value}`).join(' · ')}.` : ''}
      </p>

      {editing ? (
        <form
          className="ot-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            void save();
          }}
        >
          <div className="form-grid two">
            <div>
              <Input label="Restaurant name" value={draft.name} onChange={(event) => set('name', event.target.value)} required />
              {managedLabel('name', 'Restaurant name')}
            </div>
            <div>
              <Input label="Phone (international, e.g. +61…)" value={draft.phone} onChange={(event) => set('phone', event.target.value)} />
              {managedLabel('phone', 'Phone')}
            </div>
            <div className="ot-span-2">
              <Textarea label="Description" value={draft.description} onChange={(event) => set('description', event.target.value)} rows={3} />
              {managedLabel('description', 'Description')}
            </div>
            <div>
              <Select label="Primary cuisine" value={draft.primaryCuisine} onChange={(event) => set('primaryCuisine', event.target.value)} options={[{ label: '—', value: '' }, ...OPENTABLE_CUISINES.map((cuisine) => ({ label: cuisine, value: cuisine }))]} />
              {managedLabel('primaryCuisine', 'Primary cuisine')}
            </div>
            <div>
              <Select label="Price band" value={draft.priceBandId} onChange={(event) => set('priceBandId', event.target.value)} options={[{ label: '—', value: '' }, { label: '1 · $', value: '1' }, { label: '2 · $$', value: '2' }, { label: '3 · $$$', value: '3' }, { label: '4 · $$$$', value: '4' }]} />
              {managedLabel('priceBandId', 'Price band')}
            </div>
            <div>
              <Select label="Dining style" value={draft.diningStyle} onChange={(event) => set('diningStyle', event.target.value)} options={[{ label: '—', value: '' }, ...OPENTABLE_DINING_STYLES.map((style) => ({ label: style, value: style }))]} />
              {managedLabel('diningStyle', 'Dining style')}
            </div>
            <div>
              <Select label="Dress code" value={draft.dressCode} onChange={(event) => set('dressCode', event.target.value)} options={[{ label: '—', value: '' }, ...OPENTABLE_DRESS_CODES.map((code) => ({ label: code, value: code }))]} />
              {managedLabel('dressCode', 'Dress code')}
            </div>
            <div>
              <Input label="Website" value={draft.website} onChange={(event) => set('website', event.target.value)} placeholder="https://" />
              {managedLabel('website', 'Website')}
            </div>
            <div>
              <Input label="Menu URL" value={draft.menuUrl} onChange={(event) => set('menuUrl', event.target.value)} placeholder={p.websiteHints.menuUrl ?? 'https://'} hint="The public A4 PDF from Alma Menus works here." />
              {managedLabel('menuUrl', 'Menu URL')}
            </div>
            <div>
              <Input label="Executive chef" value={draft.executiveChef} onChange={(event) => set('executiveChef', event.target.value)} />
              {managedLabel('executiveChef', 'Executive chef')}
            </div>
            <div>
              <Input label="Cross street" value={draft.crossStreet} onChange={(event) => set('crossStreet', event.target.value)} />
              {managedLabel('crossStreet', 'Cross street')}
            </div>
            <div className="ot-span-2">
              <Textarea label="Public transit (≤ 1000 chars)" value={draft.publicTransit} onChange={(event) => set('publicTransit', event.target.value)} rows={2} />
              {managedLabel('publicTransit', 'Public transit')}
            </div>
            <div>
              <Textarea label="Private event details (≤ 350)" value={draft.privateEventDetails} onChange={(event) => set('privateEventDetails', event.target.value)} rows={2} />
              {managedLabel('privateEventDetails', 'Private event details')}
            </div>
            <div>
              <Textarea label="Catering details (≤ 350)" value={draft.cateringDetails} onChange={(event) => set('cateringDetails', event.target.value)} rows={2} />
              {managedLabel('cateringDetails', 'Catering details')}
            </div>
            <div>
              <Input label="Profile image URL (≥ 1280×720, ≤ 10 MB)" value={draft.profileImageUrl} onChange={(event) => set('profileImageUrl', event.target.value)} placeholder="https://" />
              {managedLabel('profileImageUrl', 'Profile image')}
            </div>
            <div>
              <Textarea label="Gallery image URLs (one per line)" value={draft.imageUrls} onChange={(event) => set('imageUrls', event.target.value)} rows={2} />
              {managedLabel('imageUrls', 'Gallery images')}
            </div>
            <div>
              <Input label="Tags (comma separated)" value={draft.tags} onChange={(event) => set('tags', event.target.value)} />
              {managedLabel('tags', 'Tags')}
            </div>
            <div>
              <Input label="Time zone (format unconfirmed in the docs)" value={draft.timeZone} onChange={(event) => set('timeZone', event.target.value)} />
              {managedLabel('timeZone', 'Time zone')}
              <div className="ot-inline-pair">
                <Input label="Locale" value={draft.locale} onChange={(event) => set('locale', event.target.value)} />
                <Input label="Currency" value={draft.currency} onChange={(event) => set('currency', event.target.value)} />
              </div>
              {managedLabel('locale', 'Locale')}
              {managedLabel('currency', 'Currency')}
            </div>
          </div>

          <fieldset className="ot-fieldset">
            <legend>Opening times (24h ranges, e.g. 12:00-15:00, 17:00-22:00; blank = closed)</legend>
            <div className="form-grid three">
              {OPENTABLE_DAYS.map((day) => (
                <Input key={day} label={day[0]!.toUpperCase() + day.slice(1)} value={draft.openingTimes[day] ?? ''} onChange={(event) => set('openingTimes', { ...draft.openingTimes, [day]: event.target.value })} placeholder="closed" />
              ))}
            </div>
            {managedLabel('openingTimes', 'Opening times')}
          </fieldset>

          <CheckGroup title="Other cuisines (max 5)" options={OPENTABLE_CUISINES} value={draft.otherCuisines} onToggle={(value, on) => toggleIn('otherCuisines', value, on)} managed={managedLabel('otherCuisines', 'Other cuisines')} compact />
          <CheckGroup title="Payment options" options={OPENTABLE_PAYMENT_OPTIONS} value={draft.paymentOptions} onToggle={(value, on) => toggleIn('paymentOptions', value, on)} managed={managedLabel('paymentOptions', 'Payment options')} />
          <CheckGroup title="Beverages" options={OPENTABLE_BEVERAGES} value={draft.beverages} onToggle={(value, on) => toggleIn('beverages', value, on)} managed={managedLabel('beverages', 'Beverages')} />
          <CheckGroup title="Dietary options" options={OPENTABLE_DIETARY_OPTIONS} value={draft.dietaryOptions} onToggle={(value, on) => toggleIn('dietaryOptions', value, on)} managed={managedLabel('dietaryOptions', 'Dietary options')} />
          <CheckGroup title="Smoking" options={OPENTABLE_SMOKING_OPTIONS} value={draft.smokingOptions} onToggle={(value, on) => toggleIn('smokingOptions', value, on)} managed={managedLabel('smokingOptions', 'Smoking options')} />

          <p className="muted small">
            Address is shown only in the docs' example, not in the field table, so it is held back: {OPENTABLE_PROFILE_FIELDS.find((field) => field.key === 'location')?.label}. Change it in OpenTable for Restaurants.
          </p>
          {formError ? <ActionFeedback message={formError} tone="error" /> : null}
          <div className="admin-form-actions">
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === 'profile-save' ? 'Saving…' : 'Save profile in Alma'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {preview ? (
        <details className="admin-collapsible" open>
          <summary>
            Exact JSON that will be sent ({preview.hash.slice(0, 12)}) · {preview.sentFields.length} field{preview.sentFields.length === 1 ? '' : 's'}
          </summary>
          <pre className="ot-json">{JSON.stringify(preview.payload, null, 2)}</pre>
        </details>
      ) : null}
    </Card>
  );
}

function CheckGroup({ title, options, value, onToggle, managed, compact }: { title: string; options: readonly string[]; value: string[]; onToggle: (value: string, on: boolean) => void; managed: React.ReactNode; compact?: boolean }) {
  return (
    <fieldset className={`ot-fieldset ${compact ? 'is-compact' : ''}`.trim()}>
      <legend>{title}</legend>
      <div className="ot-checks">
        {options.map((option) => (
          <label key={option} className="field-checkbox">
            <input type="checkbox" checked={value.includes(option)} onChange={(event) => onToggle(option, event.target.checked)} /> {option}
          </label>
        ))}
      </div>
      {managed}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// ACTIVITY
// ---------------------------------------------------------------------------

function ActivityPanel({ status }: { status: OpenTableVenueStatus }) {
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<(OpenTableRunSummary & { payload: unknown; response: unknown }) | null>(null);
  const rows = useMemo(() => status.activity, [status.activity]);

  const show = async (runId: string) => {
    if (open === runId) {
      setOpen(null);
      setDetail(null);
      return;
    }
    setOpen(runId);
    setDetail(await api(`/api/integrations/opentable/venues/${status.venue.id}/activity/${runId}`));
  };

  return (
    <Card title="Activity" subtitle="Every attempt, including the ones the server flags stopped. Click a row for the exact payload and OpenTable's response.">
      {rows.length === 0 ? (
        <EmptyState title="No activity yet" description="Connection checks, previews that were sent, and submissions will appear here." />
      ) : (
        <div className="table-card ot-table">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Summary</th>
                <th>Request</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <tr key={run.id} className="ot-click" onClick={() => void show(run.id)}>
                  <td>{when(run.createdAt)}</td>
                  <td>{run.kind}</td>
                  <td>
                    <Badge tone={RUN_TONE[run.status]}>{run.status}</Badge>
                  </td>
                  <td className="ot-cell">
                    {run.summary}
                    {run.error ? <div className="integration-health-error">{run.error}</div> : null}
                  </td>
                  <td className="ot-mono">
                    {run.requestId ? `OT ${run.requestId}` : ''}
                    {run.requestKey ? <div className="subtle">{run.requestKey}</div> : null}
                    {run.httpStatus ? <div className="subtle">HTTP {run.httpStatus} · {run.attempts} attempt{run.attempts === 1 ? '' : 's'}</div> : null}
                  </td>
                  <td>{run.triggeredByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && detail ? (
        <details className="admin-collapsible" open>
          <summary>
            {detail.kind} · {detail.status} · {when(detail.createdAt)}
          </summary>
          <div className="ot-grid-2">
            <div>
              <strong>Payload</strong>
              <pre className="ot-json">{detail.payload ? JSON.stringify(detail.payload, null, 2) : '(none stored)'}</pre>
            </div>
            <div>
              <strong>Response</strong>
              <pre className="ot-json">{detail.response ? JSON.stringify(detail.response, null, 2) : '(none)'}</pre>
            </div>
          </div>
        </details>
      ) : null}
    </Card>
  );
}

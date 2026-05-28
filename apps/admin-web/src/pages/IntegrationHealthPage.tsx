import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminIntegrationsStatusPayload, IntegrationProviderStatus } from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

type Tone = 'positive' | 'warning' | 'danger' | 'muted' | 'info';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function statusTone(connected: boolean, hasError: boolean, configured: boolean): Tone {
  if (hasError) return 'danger';
  if (connected) return 'positive';
  if (configured) return 'warning';
  return 'muted';
}

function statusLabel(connected: boolean, hasError: boolean, configured: boolean): string {
  if (hasError) return 'Error';
  if (connected) return 'Connected';
  if (configured) return 'Setup required';
  return 'Not configured';
}

type Tile = {
  id: string;
  name: string;
  provider: string;
  status: ReturnType<typeof statusLabel>;
  tone: Tone;
  // null = unknown, 'n/a' = the concept doesn't apply (e.g. email is push-only,
  // the encryption key isn't a sync target), otherwise an ISO timestamp.
  lastSyncAt: string | null | 'n/a';
  lastError: string | null;
  detail: string | null;
  account?: string | null;
  canResync: boolean;
  resyncAction?: () => Promise<void>;
  backfillAction?: () => Promise<void>;
};

export function IntegrationHealthPage() {
  const [data, setData] = useState<AdminIntegrationsStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  const load = useCallback(async () => {
    setLoading((current) => (data ? current : true));
    setRefreshing(true);
    try {
      const payload = await api<AdminIntegrationsStatusPayload>('/api/admin/integrations/status');
      setData(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load integration status');
      setTone('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [data]);

  useEffect(() => {
    void load();
  }, [load]);

  const resyncSquare = useCallback(async (account?: string) => {
    const key = `square-${account ?? 'primary'}`;
    setBusyKey(key);
    setMessage(null);
    try {
      const query = account ? `?account=${encodeURIComponent(account)}` : '';
      await api(`/api/integrations/square/refresh${query}`, { method: 'POST' });
      setMessage('Square credentials refreshed.');
      setTone('success');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh Square');
      setTone('error');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const backfillSquare = useCallback(async (account?: string) => {
    const key = `square-${account ?? 'primary'}`;
    setBusyKey(key);
    setMessage(null);
    try {
      const result = await api<{
        chunks: number;
        paymentsRead: number;
        salesRows: number;
        itemRows: number;
        totalSalesCents: number;
        warnings: string[];
      }>(`/api/integrations/square/backfill${account ? `?account=${encodeURIComponent(account)}` : ''}`, {
        method: 'POST',
        body: JSON.stringify({ days: 90 })
      });
      const dollars = (result.totalSalesCents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
      setMessage(
        `Square backfill done — ${result.chunks} weekly chunks, ${result.paymentsRead} payments, ${result.salesRows} day-rows, ${result.itemRows} item-sales rows, ${dollars}.${result.warnings.length > 0 ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.` : ''}`
      );
      setTone(result.warnings.length > 0 ? 'error' : 'success');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not backfill Square');
      setTone('error');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const backfillXero = useCallback(async () => {
    setBusyKey('xero');
    setMessage(null);
    try {
      const result = await api<{
        tenantCount: number;
        billCandidates: number;
        billsImported: number;
        warnings: string[];
      }>('/api/integrations/xero/backfill', {
        method: 'POST',
        body: JSON.stringify({ days: 90 })
      });
      setMessage(
        `Xero backfill done — ${result.tenantCount} tenant${result.tenantCount === 1 ? '' : 's'}, ${result.billCandidates} candidate bills, ${result.billsImported} imported.${result.warnings.length > 0 ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.` : ''}`
      );
      setTone(result.warnings.length > 0 ? 'error' : 'success');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not backfill Xero');
      setTone('error');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const backfillDeputy = useCallback(async () => {
    setBusyKey('deputy');
    setMessage(null);
    try {
      const result = await api<{
        roster?: { shiftsCreated: number };
        employees?: { created: number; updated: number };
        documents?: { complianceCreated: number; reviewsCreated: number };
      }>('/api/integrations/deputy/backfill', { method: 'POST' });
      const parts: string[] = [];
      if (result.roster) parts.push(`${result.roster.shiftsCreated} shifts`);
      if (result.employees) parts.push(`${result.employees.created} new staff, ${result.employees.updated} updated`);
      if (result.documents) parts.push(`${result.documents.complianceCreated + result.documents.reviewsCreated} docs`);
      setMessage(`Deputy backfill done — ${parts.join(', ')}.`);
      setTone('success');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not backfill Deputy');
      setTone('error');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const syncDeputy = useCallback(async () => {
    setBusyKey('deputy');
    setMessage(null);
    try {
      const result = await api<{
        roster?: { shiftsCreated: number };
        employees?: { created: number; updated: number };
        documents?: { complianceCreated: number; reviewsCreated: number };
      }>('/api/integrations/deputy/sync-all', { method: 'POST' });
      const parts: string[] = [];
      if (result.roster) parts.push(`${result.roster.shiftsCreated} shifts`);
      if (result.employees) parts.push(`${result.employees.created} new staff, ${result.employees.updated} updated`);
      if (result.documents) parts.push(`${result.documents.complianceCreated + result.documents.reviewsCreated} docs`);
      setMessage(`Deputy sync complete — ${parts.join(', ')}.`);
      setTone('success');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sync Deputy');
      setTone('error');
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const connectDeputy = useCallback(() => {
    window.location.href = '/api/integrations/deputy/connect';
  }, []);

  const tiles = useMemo<Tile[]>(() => {
    if (!data) return [];
    const out: Tile[] = [];

    // Square — handle multi-account
    const squareAccounts = data.squareAccounts;
    if (squareAccounts && Object.keys(squareAccounts).length > 0) {
      for (const [accountKey, status] of Object.entries(squareAccounts) as Array<[string, IntegrationProviderStatus]>) {
        const connected = !!status.connected;
        const hasError = !!status.lastError;
        out.push({
          id: `square-${accountKey}`,
          name: `Square (${accountKey})`,
          provider: 'Point of sale, sales, menu sync',
          status: statusLabel(connected, hasError, status.configured),
          tone: statusTone(connected, hasError, status.configured),
          lastSyncAt: status.lastSyncAt,
          lastError: status.lastError,
          detail: status.providerAccountName ?? null,
          account: accountKey,
          canResync: connected,
          resyncAction: connected ? () => resyncSquare(accountKey) : undefined,
          backfillAction: connected ? () => backfillSquare(accountKey) : undefined
        });
      }
    } else if (data.square) {
      const status = data.square;
      const connected = !!status.connected;
      const hasError = !!status.lastError;
      out.push({
        id: 'square',
        name: 'Square',
        provider: 'Point of sale, sales, menu sync',
        status: statusLabel(connected, hasError, status.configured),
        tone: statusTone(connected, hasError, status.configured),
        lastSyncAt: status.lastSyncAt,
        lastError: status.lastError,
        detail: status.providerAccountName ?? null,
        canResync: connected,
        resyncAction: connected ? () => resyncSquare() : undefined,
        backfillAction: connected ? () => backfillSquare() : undefined
      });
    }

    // Xero — one OAuth connection can cover multiple tenants/orgs
    // (e.g. both Alma Avalon and St Alma). Surface the full tenant
    // list when there's more than one so the operator can see at a
    // glance which orgs the scheduler is syncing.
    if (data.xero) {
      const status = data.xero;
      const connected = !!status.connected;
      const hasError = !!status.lastError;
      const tenantCount = status.tenants?.length ?? 0;
      const detail = tenantCount > 1
        ? `${tenantCount} tenants: ${status.tenants!.map((tenant) => tenant.name ?? tenant.idMasked ?? 'tenant').join(' · ')}`
        : status.providerAccountName ?? null;
      out.push({
        id: 'xero',
        name: 'Xero',
        provider: tenantCount > 1
          ? 'Bookkeeping, supplier bills, payroll sync — multi-tenant'
          : 'Bookkeeping, supplier bills, payroll sync',
        status: statusLabel(connected, hasError, status.configured),
        tone: statusTone(connected, hasError, status.configured),
        lastSyncAt: status.lastSyncAt,
        lastError: status.lastError,
        detail,
        canResync: false,
        backfillAction: connected ? backfillXero : undefined
      });
    }

    // Deputy — roster + employees + documents from the Deputy API.
    // Re-sync runs all three handlers; connect kicks off OAuth if not connected.
    if (data.deputy) {
      const status = data.deputy;
      const connected = !!status.connected;
      const hasError = !!status.lastError;
      out.push({
        id: 'deputy',
        name: 'Deputy',
        provider: 'Roster, employees, compliance documents',
        status: statusLabel(connected, hasError, status.configured),
        tone: statusTone(connected, hasError, status.configured),
        lastSyncAt: status.lastSyncAt,
        lastError: status.lastError,
        detail: status.providerAccountName ?? null,
        canResync: connected || (status.configured && !connected),
        resyncAction: connected ? syncDeputy : status.configured ? async () => connectDeputy() : undefined,
        backfillAction: connected ? backfillDeputy : undefined
      });
    }

    // Meta (Facebook + Instagram)
    if (data.meta) {
      const m = data.meta;
      const isConnected = m.status === 'CALLBACK_RECEIVED';
      const isReady = m.status === 'READY_TO_CONNECT';
      const tone: Tone = isConnected ? 'positive' : isReady ? 'warning' : 'muted';
      out.push({
        id: 'meta',
        name: 'Meta (Facebook + Instagram)',
        provider: 'Social posts, ads, audience targeting',
        status: isConnected ? 'Connected' : isReady ? 'Setup required' : 'Not configured',
        tone,
        lastSyncAt: null,
        lastError: null,
        detail: m.allowedDomains?.[0] ?? null,
        canResync: false
      });
    }

    // Govee — real lastSyncedAt from temperatureIntegration row.
    // If the API key is set but no sync has run yet, the tile shows
    // "Connected" with "Never" until Cloud Scheduler or a manual sync fires.
    if (data.govee) {
    const goveeHasError = Boolean(data.govee.lastError);
    out.push({
      id: 'govee',
      name: 'Govee',
      provider: 'Temperature sensors, compliance alerts',
      status: goveeHasError
        ? 'Error'
        : data.govee.status === 'CONFIGURED'
          ? 'Connected'
          : 'Not configured',
      tone: goveeHasError
        ? 'danger'
        : data.govee.status === 'CONFIGURED'
          ? 'positive'
          : 'muted',
      lastSyncAt: data.govee.lastSyncedAt,
      lastError: data.govee.lastError,
      detail: [
        data.govee.baseUrl,
        data.govee.sensorCount ? `${data.govee.sensorCount} sensor${data.govee.sensorCount === 1 ? '' : 's'} discovered` : null
      ].filter(Boolean).join(' · ') || null,
      canResync: false
    });
    }

    // Email service — push-only, no sync timestamp applies.
    if (data.email) {
      out.push({
        id: 'email',
        name: 'Email service',
        provider: 'Notifications, gift cards, comms',
        status: data.email.status === 'CONFIGURED' ? 'Connected' : 'Not configured',
        tone: data.email.status === 'CONFIGURED' ? 'positive' : 'danger',
        lastSyncAt: 'n/a',
        lastError: null,
        detail: data.email.provider !== 'none' ? `Provider: ${data.email.provider} · push-only` : null,
        canResync: false
      });
    }

    // Token storage (encryption key) — stateless secret, nothing to sync.
    if (data.tokenStorage) {
      out.push({
        id: 'token-storage',
        name: 'Token storage',
        provider: 'Encryption key for connected integrations',
        status: data.tokenStorage.configured ? 'Configured' : 'Not configured',
        tone: data.tokenStorage.configured ? 'positive' : 'danger',
        lastSyncAt: 'n/a',
        lastError: null,
        detail: `Required env var: ${data.tokenStorage.requiredEnvVar} · stateless`,
        canResync: false
      });
    }

    return out;
  }, [data, resyncSquare, syncDeputy, connectDeputy, backfillSquare, backfillXero, backfillDeputy]);

  const counts = useMemo(() => {
    const total = tiles.length;
    const healthy = tiles.filter((t) => t.tone === 'positive').length;
    const warnings = tiles.filter((t) => t.tone === 'warning').length;
    const errors = tiles.filter((t) => t.tone === 'danger').length;
    return { total, healthy, warnings, errors };
  }, [tiles]);

  if (loading) {
    return (
      <Card title="Integration health" subtitle="Status across every connected system">
        <Spinner label="Loading integration status..." />
      </Card>
    );
  }

  return (
    <div className="admin-page-stack">
      <Card
        title="Integration health"
        subtitle={data ? `Generated ${timeAgo(data.generatedAt)} · ${counts.healthy} healthy · ${counts.warnings} warnings · ${counts.errors} errors` : 'Status across every connected system'}
        action={
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        }
      >
        {!data ? (
          <EmptyState title="No status data" description="Could not load integration status from the API." />
        ) : (
          <div className="integration-health-grid">
            {tiles.map((tile) => (
              <div key={tile.id} className={`integration-health-tile is-${tile.tone}`}>
                <div className="integration-health-tile-head">
                  <div>
                    <strong>{tile.name}</strong>
                    <span className="subtle">{tile.provider}</span>
                  </div>
                  <Badge tone={tile.tone}>{tile.status}</Badge>
                </div>
                <div className="integration-health-tile-body">
                  {tile.lastSyncAt !== 'n/a' ? (
                    <div className="integration-health-line">
                      <span>Last sync</span>
                      <strong>{timeAgo(tile.lastSyncAt)}</strong>
                    </div>
                  ) : null}
                  {tile.detail ? (
                    <div className="integration-health-line">
                      <span>Account</span>
                      <strong>{tile.detail}</strong>
                    </div>
                  ) : null}
                  {tile.lastError ? (
                    <div className="integration-health-error">{tile.lastError}</div>
                  ) : null}
                </div>
                <div className="integration-health-tile-actions">
                  {tile.canResync && tile.resyncAction ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void tile.resyncAction!()}
                      disabled={busyKey === tile.id}
                    >
                      {busyKey === tile.id ? 'Working...' : 'Re-sync'}
                    </Button>
                  ) : null}
                  {tile.backfillAction ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void tile.backfillAction!()}
                      disabled={busyKey === tile.id}
                      title="Pull 90 days of history (sales for Square, supplier bills for Xero, roster + staff for Deputy)"
                    >
                      {busyKey === tile.id ? 'Backfilling...' : 'Backfill 90d'}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <ActionFeedback message={message} tone={tone} />
      </Card>

      {data?.latestSyncRuns?.length ? (
        <Card title="Recent sync activity" subtitle="Latest runs across all providers">
          <div className="integration-health-runs">
            {data.latestSyncRuns.slice(0, 10).map((run) => (
              <div key={run.id} className="integration-health-run">
                <div>
                  <strong>{run.provider.toUpperCase()}</strong>
                  <span className="subtle">{run.syncType} · {run.recordsImported + run.recordsUpdated} records</span>
                </div>
                <Badge tone={run.status === 'SUCCESS' ? 'positive' : run.status === 'ERROR' ? 'danger' : 'info'}>
                  {run.status}
                </Badge>
                <span className="subtle">{timeAgo(run.startedAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

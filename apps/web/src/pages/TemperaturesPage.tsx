import { useEffect, useMemo, useState } from 'react';
import type { TemperatureAsset, TemperatureIntegration, TemperatureSensor, TemperatureSummary } from '@alma/shared';
import { ActionFeedback, Button, Card, Input, Select } from '@alma/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type SyncResult = {
  assetsScanned: number;
  provider: 'govee';
  results: Array<Record<string, unknown>>;
  success: boolean;
  synced: number;
};

type DiscoveryResult = {
  importedCount: number;
  integration: TemperatureIntegration;
  sensors: TemperatureSensor[];
};

const BASE_VENUES = ['Alma Avalon', 'St Alma'];

function toDateTimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
}

export function TemperaturesPage() {
  const { user } = useAuth();
  const assets = useAsync<TemperatureAsset[]>(() => api('/api/temperatures/assets'), []);
  const integrations = useAsync<TemperatureIntegration[]>(() => api('/api/temperatures/integrations'), []);
  const sensors = useAsync<TemperatureSensor[]>(() => api('/api/temperatures/sensors'), []);
  const summary = useAsync<TemperatureSummary>(() => api('/api/temperatures/meta'), []);

  const [form, setForm] = useState({
    area: '',
    assetType: 'Fridge',
    externalDeviceId: '',
    externalModel: '',
    integrationProvider: 'govee',
    maxTempC: '5',
    minTempC: '1',
    name: '',
    venue: ''
  });
  const [selectedVenue, setSelectedVenue] = useState('all');
  const [manualLog, setManualLog] = useState({
    assetId: '',
    correctiveAction: '',
    humidityPct: '',
    recordedAt: toDateTimeLocal(new Date()),
    recordedBy: '',
    temperatureC: ''
  });
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [logging, setLogging] = useState(false);
  const loadErrors = [
    assets.error && `Assets: ${assets.error}`,
    integrations.error && `Connector: ${integrations.error}`,
    sensors.error && `Sensors: ${sensors.error}`,
    summary.error && `Summary: ${summary.error}`
  ].filter(Boolean);
  const allAssets = assets.data ?? [];
  const knownVenues = useMemo(
    () => uniqueSorted([...BASE_VENUES, ...allAssets.map((asset) => asset.venue)]),
    [allAssets]
  );
  const venueOptions = [
    { label: 'All venues', value: 'all' },
    ...knownVenues.map((venue) => ({ label: venue, value: venue }))
  ];
  const assetVenueOptions = [
    { label: 'Select venue', value: '' },
    ...knownVenues.map((venue) => ({ label: venue, value: venue }))
  ];
  const filteredAssets = selectedVenue === 'all'
    ? allAssets
    : allAssets.filter((asset) => asset.venue === selectedVenue);
  const filteredSensors = (sensors.data ?? []).filter((sensor) =>
    selectedVenue === 'all' ? true : sensor.asset?.venue === selectedVenue
  );
  const todayStart = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);
  const filteredStats = {
    activeAssets: filteredAssets.filter((asset) => asset.status === 'ACTIVE').length,
    outOfRangeNow: filteredAssets.filter((asset) => asset.logs[0]?.status === 'OUT_OF_RANGE').length,
    missingToday: filteredAssets.filter((asset) => !asset.logs[0] || new Date(asset.logs[0].recordedAt) < todayStart).length,
    syncedToday: filteredAssets.filter((asset) => asset.lastSyncAt && new Date(asset.lastSyncAt) >= todayStart).length
  };
  const manualAsset = filteredAssets.find((asset) => asset.id === manualLog.assetId) ?? null;

  useEffect(() => {
    const defaultRecorder = user ? `${user.firstName} ${user.lastName}`.trim() : '';
    if (!manualLog.recordedBy && defaultRecorder) {
      setManualLog((current) => ({ ...current, recordedBy: defaultRecorder }));
    }
  }, [manualLog.recordedBy, user]);

  useEffect(() => {
    if (!filteredAssets.length) {
      if (manualLog.assetId) {
        setManualLog((current) => ({ ...current, assetId: '' }));
      }
      return;
    }

    if (!manualLog.assetId || !filteredAssets.some((asset) => asset.id === manualLog.assetId)) {
      setManualLog((current) => ({ ...current, assetId: filteredAssets[0]?.id ?? '' }));
    }
  }, [filteredAssets, manualLog.assetId]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    setMessageTarget('asset');

    try {
      await api('/api/temperatures/assets', {
        method: 'POST',
        body: JSON.stringify(form)
      });

      setForm({
        area: '',
        assetType: 'Fridge',
        externalDeviceId: '',
        externalModel: '',
        integrationProvider: 'govee',
        maxTempC: '5',
        minTempC: '1',
        name: '',
        venue: ''
      });
      await Promise.all([assets.reload(), integrations.reload(), sensors.reload(), summary.reload()]);
      setMessage('Temperature asset saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save temperature asset.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualLog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLogging(true);
    setMessage('');
    setMessageTarget('manual');

    if (!manualLog.assetId || !manualLog.temperatureC.trim()) {
      setLogging(false);
      setMessage('Choose a fridge asset and enter a temperature.');
      return;
    }

    try {
      await api(`/api/temperatures/assets/${manualLog.assetId}/logs`, {
        method: 'POST',
        body: JSON.stringify({
          correctiveAction: manualLog.correctiveAction.trim(),
          humidityPct: manualLog.humidityPct.trim() ? Number(manualLog.humidityPct) : undefined,
          recordedAt: manualLog.recordedAt ? new Date(manualLog.recordedAt).toISOString() : '',
          recordedBy: manualLog.recordedBy.trim(),
          temperatureC: Number(manualLog.temperatureC)
        })
      });

      setManualLog((current) => ({
        ...current,
        correctiveAction: '',
        humidityPct: '',
        recordedAt: toDateTimeLocal(new Date()),
        temperatureC: ''
      }));
      await Promise.all([assets.reload(), summary.reload()]);
      setMessage('Manual temperature log saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save manual temperature log.');
    } finally {
      setLogging(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage('');
    setMessageTarget('sync');

    try {
      const result = await api<SyncResult>('/api/temperatures/sync/govee', {
        method: 'POST',
        body: JSON.stringify({})
      });

      if (!result.success) {
        throw new Error('govee sync did not return success.');
      }

      await Promise.all([assets.reload(), integrations.reload(), sensors.reload(), summary.reload()]);
      setMessage(`govee sync ran across ${result.assetsScanned} assets and synced ${result.synced}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'govee sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDiscover() {
    setDiscovering(true);
    setMessage('');
    setMessageTarget('discover');

    try {
      const result = await api<DiscoveryResult>('/api/temperatures/integrations/govee/discover', {
        method: 'POST',
        body: JSON.stringify({ apiKey: apiKey || undefined })
      });

      setApiKey('');
      await Promise.all([assets.reload(), integrations.reload(), sensors.reload(), summary.reload()]);
      setMessage(`govee discovery found ${result.importedCount} sensors.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'govee discovery failed.');
    } finally {
      setDiscovering(false);
    }
  }

  async function handleMapSensor(sensorId: string, assetId: string) {
    setMessage('');
    setMessageTarget(`sensor:${sensorId}`);

    try {
      await api(`/api/temperatures/sensors/${sensorId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assetId })
      });

      await Promise.all([assets.reload(), integrations.reload(), sensors.reload(), summary.reload()]);
      setMessage('Sensor mapping saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to map sensor.');
    }
  }

  const goveeIntegration = integrations.data?.find((item) => item.provider === 'govee') ?? null;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Temperature Logs</p>
          <h1>Fridge Temps</h1>
          <p className="muted">
            {selectedVenue === 'all' ? 'Viewing all venues' : `Viewing ${selectedVenue}`} · manual logs and latest readings are separated by venue.
          </p>
        </div>
        <div className="inline-actions">
          <Select
            label="Venue"
            value={selectedVenue}
            onChange={(event) => setSelectedVenue(event.target.value)}
            options={venueOptions}
          />
          <Button onClick={() => void handleSync()} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync govee now'}</Button>
          <ActionFeedback
            message={messageTarget === 'sync' ? message : null}
            tone={message.includes('failed') || message.includes('not') ? 'error' : 'success'}
          />
        </div>
      </header>

      {loadErrors.length ? (
        <Card title="Temperature data could not load">
          <div className="page-stack compact">
            {loadErrors.map((error) => (
              <p key={error} className="error-text">{error}</p>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="stats-grid">
        <Card title="Active assets">{assets.loading ? '...' : filteredStats.activeAssets}</Card>
        <Card title="Out of range">{assets.loading ? '...' : filteredStats.outOfRangeNow}</Card>
        <Card title="Missing today">{assets.loading ? '...' : filteredStats.missingToday}</Card>
        <Card title="Synced today">{assets.loading ? '...' : filteredStats.syncedToday}</Card>
      </div>

      <div className="grid two">
        <Card title="Add manual fridge log" subtitle="Use this for daily checks, service reads, and any fridge without a govee sensor.">
          <form onSubmit={(event) => void handleManualLog(event)}>
            <div className="form-grid two">
              <Select
                label="Fridge / asset"
                value={manualLog.assetId}
                onChange={(event) => setManualLog((current) => ({ ...current, assetId: event.target.value }))}
                options={[
                  { label: filteredAssets.length ? 'Select asset' : 'No assets for this venue', value: '' },
                  ...filteredAssets.map((asset) => ({
                    label: `${asset.name}${asset.area ? ` · ${asset.area}` : ''}`,
                    value: asset.id
                  }))
                ]}
                required
              />
              <Input
                label="Temperature °C"
                type="number"
                step="0.1"
                value={manualLog.temperatureC}
                onChange={(event) => setManualLog((current) => ({ ...current, temperatureC: event.target.value }))}
                required
              />
              <Input
                label="Recorded at"
                type="datetime-local"
                value={manualLog.recordedAt}
                onChange={(event) => setManualLog((current) => ({ ...current, recordedAt: event.target.value }))}
              />
              <Input
                label="Recorded by"
                value={manualLog.recordedBy}
                onChange={(event) => setManualLog((current) => ({ ...current, recordedBy: event.target.value }))}
              />
              <Input
                label="Humidity %"
                type="number"
                step="0.1"
                value={manualLog.humidityPct}
                onChange={(event) => setManualLog((current) => ({ ...current, humidityPct: event.target.value }))}
              />
              <Input
                label="Corrective action"
                value={manualLog.correctiveAction}
                onChange={(event) => setManualLog((current) => ({ ...current, correctiveAction: event.target.value }))}
                placeholder="Door closed, stock moved, tech called"
              />
            </div>

            <div className="inline-actions">
              <Button type="submit" disabled={logging || !filteredAssets.length}>
                {logging ? 'Saving log...' : 'Save manual log'}
              </Button>
              <ActionFeedback
                message={messageTarget === 'manual' ? message : null}
                tone={message.includes('Failed') || message.includes('Choose') ? 'error' : 'success'}
              />
              {manualAsset ? (
                <span className="muted">
                  Range {manualAsset.minTempC.toFixed(1)}°C to {manualAsset.maxTempC.toFixed(1)}°C
                </span>
              ) : null}
            </div>
          </form>
        </Card>

        <Card title="Add monitored asset">
          <form onSubmit={(event) => void handleCreate(event)}>
            <div className="form-grid two">
              <Input label="Asset name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
              <Select label="Asset type" value={form.assetType} onChange={(event) => setForm((current) => ({ ...current, assetType: event.target.value }))} options={[{ label: 'Fridge', value: 'Fridge' }, { label: 'Cool Room', value: 'Cool Room' }, { label: 'Freezer', value: 'Freezer' }]} />
              <Select label="Venue" value={form.venue} onChange={(event) => setForm((current) => ({ ...current, venue: event.target.value }))} options={assetVenueOptions} />
              <Input label="Area" value={form.area} onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))} />
              <Input label="Min temp °C" type="number" step="0.1" value={form.minTempC} onChange={(event) => setForm((current) => ({ ...current, minTempC: event.target.value }))} required />
              <Input label="Max temp °C" type="number" step="0.1" value={form.maxTempC} onChange={(event) => setForm((current) => ({ ...current, maxTempC: event.target.value }))} required />
              <Select label="Integration" value={form.integrationProvider} onChange={(event) => setForm((current) => ({ ...current, integrationProvider: event.target.value }))} options={[{ label: 'govee', value: 'govee' }, { label: 'Manual only', value: '' }]} />
              <Input label="govee device id" value={form.externalDeviceId} onChange={(event) => setForm((current) => ({ ...current, externalDeviceId: event.target.value }))} />
              <Input label="govee model" value={form.externalModel} onChange={(event) => setForm((current) => ({ ...current, externalModel: event.target.value }))} />
            </div>

            <div className="inline-actions">
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save asset'}</Button>
              <ActionFeedback
                message={messageTarget === 'asset' ? message : null}
                tone={message.includes('Failed') ? 'error' : 'success'}
              />
            </div>
          </form>

          {message && !messageTarget ? <p className={message.includes('saved') || message.includes('synced') ? 'muted' : 'error-text'}>{message}</p> : null}
        </Card>
      </div>

      <div className="grid two">
        <Card title="govee connector">
          <div className="page-stack compact">
            <div className="form-grid">
              <Input label="API key override" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Uses server env when blank" />
            </div>

            <div className="stats-grid">
              <Card title="Status">{goveeIntegration?.status || 'Not connected'}</Card>
              <Card title="Discovered">{sensors.data?.length ?? 0}</Card>
              <Card title="Mapped">{filteredSensors.filter((sensor) => sensor.assetId).length}</Card>
              <Card title="Last sync">{goveeIntegration?.lastSyncedAt ? new Date(goveeIntegration.lastSyncedAt).toLocaleTimeString() : 'Never'}</Card>
            </div>

            <div className="inline-actions">
              <Button onClick={() => void handleDiscover()} disabled={discovering}>{discovering ? 'Discovering...' : 'Discover govee sensors'}</Button>
              <ActionFeedback
                message={messageTarget === 'discover' ? message : null}
                tone={message.includes('failed') ? 'error' : 'success'}
              />
            </div>

            {goveeIntegration?.lastError ? <p className="error-text">{goveeIntegration.lastError}</p> : null}
          </div>
        </Card>
      </div>

      <div className="grid two">
        <Card title="External sensors">
          {sensors.loading ? <p>Loading sensors...</p> : null}
          {sensors.error ? <p className="error-text">{sensors.error}</p> : null}

          <div className="page-stack compact">
            {filteredSensors.map((sensor) => (
              <article key={sensor.id} className="soft-panel">
                <div className="cell-stack">
                  <strong>{sensor.externalName || sensor.externalSensorId}</strong>
                  <span className="muted">{sensor.externalModel || 'Unknown model'} · {sensor.externalSensorId}</span>
                  <span className="muted">
                    {sensor.lastTemperature == null ? 'No reading yet' : `${sensor.lastTemperature.toFixed(1)}°C`} · {sensor.lastSeenAt ? new Date(sensor.lastSeenAt).toLocaleString() : 'Never seen'}
                  </span>
                </div>

                <div className="cell-stack">
                  <Select
                    label="Mapped asset"
                    value={sensor.assetId || ''}
                    onChange={(event) => void handleMapSensor(sensor.id, event.target.value)}
                    options={[
                      { label: 'Not mapped', value: '' },
                      ...filteredAssets.map((asset) => ({ label: asset.name, value: asset.id }))
                    ]}
                  />
                  <ActionFeedback
                    message={messageTarget === `sensor:${sensor.id}` ? message : null}
                    tone={message.includes('Failed') ? 'error' : 'success'}
                  />
                </div>
              </article>
            ))}

            {!sensors.loading && !filteredSensors.length ? <p className="muted">No external sensors for this venue yet.</p> : null}
          </div>
        </Card>

        <Card title="Latest readings">
          {assets.loading ? <p>Loading assets...</p> : null}
          {assets.error ? <p className="error-text">{assets.error}</p> : null}

          <div className="page-stack compact">
            {filteredAssets.map((asset) => {
              const latest = asset.logs[0];
              return (
                <article key={asset.id} className="soft-panel">
                  <div className="cell-stack">
                    <strong>{asset.name}</strong>
                    <span className="muted">{asset.venue || 'Venue not set'} · {asset.area || 'Area not set'} · {asset.assetType}</span>
                    <span className="muted">
                      Range {asset.minTempC.toFixed(1)}°C to {asset.maxTempC.toFixed(1)}°C
                    </span>
                  </div>

                  <div className="cell-stack">
                    <strong>{latest ? `${latest.temperatureC.toFixed(1)}°C` : 'No reading'}</strong>
                    <span className={`pill ${latest?.status === 'OUT_OF_RANGE' ? 'status-blocked' : 'status-resolved'}`}>
                      {latest?.status ?? 'MISSING'}
                    </span>
                    <span className="muted">
                      {latest ? `${latest.source} · ${new Date(latest.recordedAt).toLocaleString()}` : 'Waiting for first log'}
                    </span>
                  </div>
                </article>
              );
            })}
            {!assets.loading && !filteredAssets.length ? <p className="muted">No temperature assets for this venue yet.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

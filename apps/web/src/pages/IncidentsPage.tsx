import { Fragment, useState } from 'react';
import type { IncidentReport, IncidentStatus, IncidentSummary } from '@alma/shared';
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
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { IssueSeverityPill } from '../features/issues/IssueSeverityPill';
import {
  IconCheck,
  IconClock,
  IconIncident,
  IconPlus,
  IconRefresh
} from '../lib/icons';

const statusTone: Record<IncidentStatus, 'warning' | 'indigo' | 'muted'> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'indigo',
  CLOSED: 'muted'
};

const statusLabel: Record<IncidentStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  CLOSED: 'Closed'
};

export function IncidentsPage() {
  const incidents = useAsync<IncidentReport[]>(() => api('/api/incidents'), []);
  const summary = useAsync<IncidentSummary>(() => api('/api/incidents/meta'), []);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    createIssue: false,
    incidentType: 'First Aid',
    location: '',
    occurredAt: new Date().toISOString().slice(0, 16),
    reportedBy: '',
    summary: '',
    title: '',
    venue: ''
  });
  const [severity, setSeverity] = useState('MEDIUM');
  const [message, setMessage] = useState('');
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    setMessageTarget('incident');

    try {
      await api('/api/incidents', {
        method: 'POST',
        body: JSON.stringify({
          createIssue: form.createIssue,
          incidentType: form.incidentType,
          location: form.location,
          occurredAt: new Date(form.occurredAt).toISOString(),
          reportedBy: form.reportedBy,
          severity,
          summary: form.summary,
          title: form.title,
          venue: form.venue
        })
      });

      setForm({
        createIssue: false,
        incidentType: 'First Aid',
        location: '',
        occurredAt: new Date().toISOString().slice(0, 16),
        reportedBy: '',
        summary: '',
        title: '',
        venue: ''
      });
      setSeverity('MEDIUM');
      await Promise.all([incidents.reload(), summary.reload()]);
      setMessage('Incident report saved.');
      window.setTimeout(() => setShowForm(false), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save incident.');
    } finally {
      setSubmitting(false);
    }
  }

  async function progress(
    incident: IncidentReport,
    nextStatus: IncidentStatus,
    resolutionNotes?: string
  ) {
    try {
      setSavingStatus(incident.id);
      setMessage('');
      setMessageTarget(`incident:${incident.id}`);
      const patch: Record<string, unknown> = { status: nextStatus };
      if (resolutionNotes !== undefined) {
        patch.followUpNotes =
          [incident.followUpNotes, resolutionNotes].filter(Boolean).join('\n\n');
        patch.followUpRequired = nextStatus !== 'CLOSED';
      }
      await api(`/api/incidents/${incident.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await Promise.all([incidents.reload(), summary.reload()]);
      setMessage(nextStatus === 'CLOSED' ? 'Incident closed.' : 'Incident updated.');
      window.setTimeout(() => {
        setActiveId(null);
        setResolution('');
      }, 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update incident.');
    } finally {
      setSavingStatus(null);
    }
  }

  const rows = incidents.data ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Incidents"
        title="First aid, injuries, and near-miss reports"
        description="Log what happened, who was involved, and close the loop once actions are complete."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => {
                void incidents.reload();
                void summary.reload();
              }}
            >
              Refresh
            </Button>
            <Button
              leftIcon={<IconPlus size={14} />}
              onClick={() => setShowForm((current) => !current)}
            >
              {showForm ? 'Hide form' : 'New incident'}
            </Button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Total reports"
          value={summary.data?.total ?? 0}
          hint="All time"
          icon={<IconIncident size={16} />}
          loading={summary.loading}
        />
        <StatCard
          label="Open"
          value={summary.data?.open ?? 0}
          hint="Open or under review"
          icon={<IconClock size={16} />}
          tone={(summary.data?.open ?? 0) > 0 ? 'warning' : 'positive'}
          loading={summary.loading}
        />
        <StatCard
          label="Follow-up"
          value={summary.data?.followUpRequired ?? 0}
          hint="Awaiting follow-up"
          icon={<IconClock size={16} />}
          tone={(summary.data?.followUpRequired ?? 0) > 0 ? 'warning' : 'neutral'}
          loading={summary.loading}
        />
        <StatCard
          label="Critical"
          value={summary.data?.critical ?? 0}
          hint="Critical severity"
          icon={<IconIncident size={16} />}
          tone={(summary.data?.critical ?? 0) > 0 ? 'danger' : 'neutral'}
          loading={summary.loading}
        />
      </div>

      {showForm ? (
        <Card title="New incident report" subtitle="Capture the basics — detail can be added later">
          <form onSubmit={(event) => void handleSubmit(event)} className="page-stack compact">
            <div className="form-grid two">
              <Input
                label="Title"
                value={form.title}
                onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
                required
              />
              <Input
                label="Reported by"
                value={form.reportedBy}
                onChange={(event) => setForm((c) => ({ ...c, reportedBy: event.target.value }))}
                required
              />
              <Input
                label="Venue"
                value={form.venue}
                onChange={(event) => setForm((c) => ({ ...c, venue: event.target.value }))}
              />
              <Input
                label="Location"
                value={form.location}
                onChange={(event) => setForm((c) => ({ ...c, location: event.target.value }))}
              />
              <Input
                label="Occurred at"
                type="datetime-local"
                value={form.occurredAt}
                onChange={(event) => setForm((c) => ({ ...c, occurredAt: event.target.value }))}
                required
              />
              <Select
                label="Type"
                value={form.incidentType}
                onChange={(event) => setForm((c) => ({ ...c, incidentType: event.target.value }))}
                options={[
                  { label: 'First Aid', value: 'First Aid' },
                  { label: 'Injury', value: 'Injury' },
                  { label: 'Near Miss', value: 'Near Miss' },
                  { label: 'Safety Breach', value: 'Safety Breach' }
                ]}
              />
              <Select
                label="Severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
                options={[
                  { label: 'Low', value: 'LOW' },
                  { label: 'Medium', value: 'MEDIUM' },
                  { label: 'High', value: 'HIGH' },
                  { label: 'Critical', value: 'CRITICAL' }
                ]}
              />
            </div>
            <Textarea
              label="Summary"
              value={form.summary}
              onChange={(event) => setForm((c) => ({ ...c, summary: event.target.value }))}
              rows={4}
              required
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.createIssue}
                onChange={(event) => setForm((c) => ({ ...c, createIssue: event.target.checked }))}
              />
              <span>Also create an open issue for follow through</span>
            </label>
            <div className="toolbar-right">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save incident'}
              </Button>
              <ActionFeedback
                message={messageTarget === 'incident' ? message : null}
                tone={message.includes('Failed') ? 'error' : 'success'}
              />
            </div>
            {message && !message.includes('saved') && !messageTarget ? (
              <p className="error-text">{message}</p>
            ) : null}
          </form>
        </Card>
      ) : null}

      <Card padding="none">
        <div className="table-toolbar">
          <span>
            {incidents.loading ? (
              <Spinner label="Loading incidents…" />
            ) : (
              <>
                <strong style={{ color: 'var(--color-text)' }}>{rows.length}</strong>{' '}
                {rows.length === 1 ? 'report' : 'reports'} tracked
              </>
            )}
          </span>
        </div>

        {incidents.error ? (
          <EmptyState
            icon={<IconIncident size={22} />}
            title="Could not load incidents"
            description={incidents.error}
            action={
              <Button size="sm" variant="secondary" onClick={() => void incidents.reload()}>
                Retry
              </Button>
            }
          />
        ) : null}

        {!incidents.loading && !incidents.error && rows.length === 0 ? (
          <EmptyState
            icon={<IconIncident size={22} />}
            title="No incidents reported yet"
            description="When something happens on the floor, capture it here so the loop can be closed."
            action={
              <Button
                size="sm"
                leftIcon={<IconPlus size={14} />}
                onClick={() => setShowForm(true)}
              >
                New incident
              </Button>
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Occurred</th>
                <th>Reported by</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((incident) => {
                const isOpen = activeId === incident.id;
                const busy = savingStatus === incident.id;
                return (
                  <Fragment key={incident.id}>
                    <tr key={incident.id}>
                      <td>
                        <div className="cell-stack">
                          <strong>{incident.title}</strong>
                          <span className="line-clamp">{incident.summary}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone="muted">{incident.incidentType}</Badge>
                      </td>
                      <td>
                        <IssueSeverityPill severity={incident.severity} />
                      </td>
                      <td>
                        <Badge tone={statusTone[incident.status]} dot>
                          {statusLabel[incident.status]}
                        </Badge>
                      </td>
                      <td>{new Date(incident.occurredAt).toLocaleDateString()}</td>
                      <td>{incident.reportedBy}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {incident.status !== 'CLOSED' ? (
                          <Button
                            size="sm"
                            variant={isOpen ? 'ghost' : 'secondary'}
                            onClick={() => {
                              setActiveId(isOpen ? null : incident.id);
                              setResolution('');
                            }}
                          >
                            {isOpen ? 'Close panel' : 'Resolve'}
                          </Button>
                        ) : (
                          <Badge tone="positive" dot>
                            Closed
                          </Badge>
                        )}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr key={`${incident.id}-resolve`}>
                        <td colSpan={7} style={{ background: 'var(--color-surface-muted)' }}>
                          <div className="page-stack compact" style={{ padding: '6px 4px' }}>
                            <div className="detail-list" style={{ gridTemplateColumns: '1fr 1fr' }}>
                              <div>
                                <span>Immediate actions</span>
                                <strong>{incident.immediateActions || '—'}</strong>
                              </div>
                              <div>
                                <span>Treatment provided</span>
                                <strong>{incident.treatmentProvided || '—'}</strong>
                              </div>
                              <div>
                                <span>Follow-up notes</span>
                                <strong>{incident.followUpNotes || '—'}</strong>
                              </div>
                              <div>
                                <span>People involved</span>
                                <strong>
                                  {incident.people.length === 0
                                    ? 'None recorded'
                                    : incident.people.map((p) => p.name).join(', ')}
                                </strong>
                              </div>
                            </div>
                            <Textarea
                              label="Resolution notes"
                              value={resolution}
                              onChange={(event) => setResolution(event.target.value)}
                              rows={3}
                              placeholder="What was done to close this incident out?"
                            />
                            <div className="toolbar-right">
                              {incident.status === 'OPEN' ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void progress(incident, 'UNDER_REVIEW', resolution || undefined)
                                  }
                                >
                                  {busy ? 'Saving…' : 'Mark under review'}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                disabled={busy}
                                leftIcon={<IconCheck size={14} />}
                                onClick={() => void progress(incident, 'CLOSED', resolution)}
                              >
                                {busy ? 'Saving…' : 'Mark closed'}
                              </Button>
                              <ActionFeedback
                                message={messageTarget === `incident:${incident.id}` ? message : null}
                                tone={message.includes('Failed') ? 'error' : 'success'}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}

import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import type { AuditRun } from '@alma/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea
} from '@alma/ui';
import { useAsync } from '../../hooks/useAsync';
import { api, apiUrl } from '../../lib/api';
import {
  IconArrowLeft,
  IconAudit,
  IconPlus,
  IconRefresh
} from '../../lib/icons';

export function AuditRunDetailPage() {
  const { id = '' } = useParams();
  const { data, loading, error, reload } = useAsync<AuditRun>(
    () => api(`/api/audits/runs/${id}`),
    [id]
  );

  const [findingSection, setFindingSection] = useState('');
  const [findingText, setFindingText] = useState('');
  const [findingScore, setFindingScore] = useState('');
  const [createIssue, setCreateIssue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  async function convertFindingToIssue(findingId: string) {
    setConvertingId(findingId);
    try {
      await api(`/api/audits/runs/${id}/findings/${findingId}/convert-to-issue`, {
        method: 'POST'
      });
      await reload();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not create issue');
    } finally {
      setConvertingId(null);
    }
  }

  async function addFinding() {
    if (!findingSection || !findingText.trim()) return;
    try {
      setSaving(true);
      setAddError(null);
      await api(`/api/audits/runs/${id}/findings`, {
        method: 'POST',
        body: JSON.stringify({
          sectionTitle: findingSection,
          finding: findingText.trim(),
          score: findingScore ? Number(findingScore) : undefined,
          createIssue
        })
      });
      setFindingText('');
      setFindingScore('');
      setCreateIssue(false);
      await reload();
    } catch (submitError) {
      setAddError(
        submitError instanceof Error
          ? submitError.message
          : 'Failed to save finding'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card title="Loading audit">
        <Spinner label="Loading audit…" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card
        title="Audit unavailable"
        action={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<IconRefresh size={14} />}
            onClick={() => void reload()}
          >
            Retry
          </Button>
        }
      >
        <p className="error-text">{error ?? 'Audit not found'}</p>
      </Card>
    );
  }

  const sectionOptions = [
    { label: 'Select section', value: '' },
    ...data.template.sections.map((section) => ({
      label: section.title,
      value: section.title
    }))
  ];

  const findingsBySection = data.template.sections.map((section) => ({
    section,
    findings: data.findings.filter((f) => f.sectionTitle === section.title)
  }));

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Audit run"
        title={data.title}
        description={`${data.template.name} · ${new Date(data.runDate).toLocaleString()}`}
        actions={
          <div className="inline-actions">
            <a
              href={apiUrl(`/api/audits/runs/${id}/export/pdf`)}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="secondary" size="sm">Download PDF</Button>
            </a>
            <a
              href={apiUrl(`/api/audits/runs/${id}/export/xlsx`)}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="secondary" size="sm">Download Excel</Button>
            </a>
            <Link to="/audits">
              <Button variant="ghost" size="sm" leftIcon={<IconArrowLeft size={14} />}>
                Back to audits
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid two-one">
        <Card title="Summary">
          <p style={{ color: 'var(--color-text)', lineHeight: 1.6 }}>
            {data.summary || 'No summary yet.'}
          </p>
        </Card>
        <Card title="Score">
          <div className="detail-list">
            <div>
              <span>Overall</span>
              <strong>
                {typeof data.score === 'number' ? data.score : '—'}
              </strong>
            </div>
            <div>
              <span>Findings</span>
              <strong>{data.findings.length}</strong>
            </div>
            <div>
              <span>Template sections</span>
              <strong>{data.template.sections.length}</strong>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Findings by section"
        subtitle="Everything recorded during the walkthrough"
      >
        {findingsBySection.every((entry) => entry.findings.length === 0) ? (
          <EmptyState
            icon={<IconAudit size={22} />}
            title="No findings recorded"
            description="Add a finding below to flag something for follow-up."
          />
        ) : (
          <div className="page-stack compact">
            {findingsBySection.map(({ section, findings }) => (
              <article key={section.id} className="soft-panel" style={{ flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <strong>{section.title}</strong>
                  <Badge tone="muted">{findings.length} {findings.length === 1 ? 'finding' : 'findings'}</Badge>
                </div>
                {section.description ? (
                  <p className="subtle" style={{ marginTop: 4 }}>
                    {section.description}
                  </p>
                ) : null}
                {findings.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', width: '100%' }}>
                    {findings.map((finding) => (
                      <li
                        key={finding.id}
                        style={{
                          padding: '8px 0',
                          borderTop: '1px solid var(--color-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>{finding.finding}</span>
                          {typeof finding.score === 'number' ? (
                            <Badge tone="muted">{finding.score}</Badge>
                          ) : null}
                        </div>
                        {finding.linkedIssue ? (
                          <Link to={`/issues/${finding.linkedIssue.id}`} className="subtle link">
                            Linked issue: {finding.linkedIssue.title}
                          </Link>
                        ) : (
                          <div className="inline-actions">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={convertingId === finding.id}
                              onClick={() => void convertFindingToIssue(finding.id)}
                            >
                              {convertingId === finding.id ? 'Creating…' : 'Create issue'}
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card title="Add a finding" subtitle="Captures a new finding against this audit run">
        <div className="form-grid two">
          <Select
            label="Section"
            value={findingSection}
            onChange={(event) => setFindingSection(event.target.value)}
            options={sectionOptions}
          />
          <Input
            label="Score (0–10, optional)"
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={findingScore}
            onChange={(event) => setFindingScore(event.target.value)}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Textarea
            label="Finding"
            value={findingText}
            onChange={(event) => setFindingText(event.target.value)}
            rows={3}
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={createIssue}
            onChange={(event) => setCreateIssue(event.target.checked)}
          />
          <span>Also create a tracked issue for this finding</span>
        </label>
        {addError ? <p className="error-text">{addError}</p> : null}
        <div className="toolbar-right">
          <Button
            type="button"
            disabled={!findingSection || !findingText.trim() || saving}
            leftIcon={<IconPlus size={14} />}
            onClick={() => void addFinding()}
          >
            {saving ? 'Saving…' : 'Add finding'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

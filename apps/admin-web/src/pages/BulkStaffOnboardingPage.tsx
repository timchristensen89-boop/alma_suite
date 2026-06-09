import { useMemo, useState } from 'react';
import { ActionFeedback, Badge, Button, Card, Textarea } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

type ParsedRow = {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  roleTitle: string;
  venue: string;
  note: string;
  errors: string[];
};

type SendStatus = 'pending' | 'sent' | 'error';
type ResultRow = ParsedRow & { status: SendStatus; reason?: string };

const SAMPLE = `firstName,lastName,email,roleTitle,venue,note
Jordan,Lee,jordan@example.com,Bartender,Alma Avalon,Starts next Monday
Sam,Patel,sam@example.com,Floor,St Alma,Casual cover
`;

function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headerLine = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const colIndex = (name: string) => headerLine.indexOf(name);
  const idxFirst = colIndex('firstname');
  const idxLast = colIndex('lastname');
  const idxEmail = colIndex('email');
  const idxRole = colIndex('roletitle');
  const idxVenue = colIndex('venue');
  const idxNote = colIndex('note');

  return lines.slice(1).map((rawLine, i) => {
    // very simple CSV parse — handles unquoted commas; quoting not supported.
    const cells = rawLine.split(',');
    const get = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');
    const firstName = get(idxFirst);
    const lastName = get(idxLast);
    const email = get(idxEmail);
    const roleTitle = get(idxRole);
    const venue = get(idxVenue);
    const note = get(idxNote);
    const errors: string[] = [];
    if (!firstName || firstName.length < 2) errors.push('firstName missing or too short');
    if (!lastName || lastName.length < 2) errors.push('lastName missing or too short');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email not a valid address');
    return { line: i + 2, firstName, lastName, email, roleTitle, venue, note, errors };
  });
}

export function BulkStaffOnboardingPage() {
  const [csv, setCsv] = useState(SAMPLE);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const validRows = useMemo(() => parsed.filter((r) => r.errors.length === 0), [parsed]);

  async function runImport() {
    if (validRows.length === 0) return;
    if (!window.confirm(`Create onboarding invites for ${validRows.length} staff member${validRows.length === 1 ? '' : 's'}? This sends invites and can't be undone in bulk.`)) {
      return;
    }
    setRunning(true);
    setMessage(null);
    const initial: ResultRow[] = parsed.map((row) => ({
      ...row,
      status: row.errors.length > 0 ? 'error' : 'pending',
      reason: row.errors.length > 0 ? row.errors.join(', ') : undefined
    }));
    setResults(initial);

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < initial.length; i += 1) {
      const row = initial[i]!;
      if (row.status === 'error') continue;
      try {
        await api('/api/staff/invites', {
          method: 'POST',
          body: JSON.stringify({
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email || undefined,
            roleTitle: row.roleTitle || undefined,
            venue: row.venue || undefined,
            note: row.note || undefined
          })
        });
        initial[i] = { ...row, status: 'sent' };
        sent += 1;
      } catch (err) {
        initial[i] = {
          ...row,
          status: 'error',
          reason: err instanceof Error ? err.message : 'API rejected the invite'
        };
        failed += 1;
      }
      setResults([...initial]);
    }
    setRunning(false);
    if (failed === 0) {
      setMessage(`Created ${sent} invitation${sent === 1 ? '' : 's'}. They'll show up in Staff > Invites.`);
      setTone('success');
    } else {
      setMessage(`Sent ${sent}, ${failed} failed. See the row-level errors below.`);
      setTone('error');
    }
  }

  return (
    <div className="admin-page-stack">
      <Card
        title="Bulk staff onboarding"
        subtitle="Paste a CSV of new hires to create invite records in one pass. Each row becomes a staff invite — the candidate finishes onboarding via the email link."
      >
        <p className="subtle">
          Required headers: <code>firstName</code>, <code>lastName</code>.
          Optional: <code>email</code>, <code>roleTitle</code>, <code>venue</code>, <code>note</code>.
          One row per person. Don't paste quoted strings with embedded commas.
        </p>
        <Textarea
          label="CSV"
          rows={10}
          value={csv}
          onChange={(event) => setCsv(event.currentTarget.value)}
          placeholder={SAMPLE}
        />
        <div className="bulk-onboarding-summary">
          <Badge tone={validRows.length > 0 ? 'positive' : 'muted'}>{validRows.length} valid row{validRows.length === 1 ? '' : 's'}</Badge>
          <Badge tone={parsed.length - validRows.length > 0 ? 'danger' : 'muted'}>
            {parsed.length - validRows.length} row{parsed.length - validRows.length === 1 ? '' : 's'} with errors
          </Badge>
        </div>
        <div className="toolbar-right">
          <ActionFeedback message={message} tone={tone} />
          <Button type="button" onClick={() => void runImport()} disabled={running || validRows.length === 0}>
            {running ? 'Creating…' : `Create ${validRows.length} invite${validRows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </Card>

      {parsed.length > 0 ? (
        <Card title="Preview" subtitle="What will be created. Errors flagged per row.">
          <div className="bulk-onboarding-table">
            <div className="bulk-onboarding-row bulk-onboarding-head">
              <span>#</span>
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Venue</span>
              <span>Status</span>
            </div>
            {(results.length > 0 ? results : parsed.map((r) => ({ ...r, status: 'pending' as SendStatus, reason: r.errors.join(', ') || undefined }))).map((row) => (
              <div key={row.line} className={`bulk-onboarding-row is-${row.status}`}>
                <span>{row.line}</span>
                <span><strong>{row.firstName} {row.lastName}</strong></span>
                <span>{row.email || '—'}</span>
                <span>{row.roleTitle || '—'}</span>
                <span>{row.venue || '—'}</span>
                <span>
                  {row.status === 'sent' ? <Badge tone="positive">✓ Sent</Badge> : null}
                  {row.status === 'error' ? <Badge tone="danger">⚠ {row.reason ?? 'Error'}</Badge> : null}
                  {row.status === 'pending' ? <Badge tone="muted">Pending</Badge> : null}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

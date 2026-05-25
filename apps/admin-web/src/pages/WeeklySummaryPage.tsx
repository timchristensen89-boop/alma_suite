import { useState } from 'react';
import { ActionFeedback, Button, Card } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

type PreviewResult = {
  previewOnly?: boolean;
  sent?: boolean;
  recipient?: string;
  weekLabel?: string;
  body?: string;
  overdueIssues?: number;
  expiringRecords?: number;
  openLicences?: number;
  reason?: string;
};

export function WeeklySummaryPage() {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  async function load(action: 'preview' | 'send') {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<PreviewResult>(
        `/api/admin/weekly-summary/send${action === 'preview' ? '?preview=1' : ''}`,
        { method: 'POST' }
      );
      setPreview(result);
      if (action === 'send') {
        if (result.sent) {
          setMessage(`Sent to ${result.recipient}.`);
          setTone('success');
        } else {
          setMessage(`Could not send: ${result.reason ?? 'unknown reason'}.`);
          setTone('error');
        }
      } else {
        setMessage('Preview generated below.');
        setTone('success');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not run weekly summary');
      setTone('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page-stack">
      <Card
        title="Monday weekly summary"
        subtitle="Composes last week's prime cost, top sellers, compliance overdues, and upcoming expiries into an email. Preview to see what the recipient gets; Send fires the email immediately via the configured mail provider."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" variant="secondary" onClick={() => void load('preview')} disabled={busy}>
              {busy ? 'Loading…' : 'Preview'}
            </Button>
            <Button type="button" onClick={() => void load('send')} disabled={busy}>
              {busy ? 'Sending…' : 'Send now'}
            </Button>
          </div>
        }
      >
        <p className="subtle">
          To automate, point Cloud Scheduler at <code>POST /api/admin/weekly-summary/send</code>
          {' '}with a Monday 07:00 cron. Recipient is taken from Admin → General settings →
          Notification email.
        </p>

        {preview ? (
          <div className="weekly-summary-preview">
            <div className="weekly-summary-meta">
              <span>Week</span>
              <strong>{preview.weekLabel ?? '—'}</strong>
              <span>Overdue issues</span>
              <strong>{preview.overdueIssues ?? 0}</strong>
              <span>Records expiring (30d)</span>
              <strong>{preview.expiringRecords ?? 0}</strong>
              <span>Licences expiring (90d)</span>
              <strong>{preview.openLicences ?? 0}</strong>
            </div>
            {preview.body ? (
              <pre className="weekly-summary-body">{preview.body}</pre>
            ) : null}
          </div>
        ) : null}

        <ActionFeedback message={message} tone={tone} />
      </Card>
    </div>
  );
}

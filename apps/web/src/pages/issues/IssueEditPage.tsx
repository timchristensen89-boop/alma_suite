import { useNavigate, useParams } from 'react-router-dom';
import type { Issue, IssueAssigneeOption, IssueFormInput } from '@alma/shared';
import { useState } from 'react';
import { api } from '../../lib/api';
import { IssueForm } from '../../features/issues/IssueForm';
import { useAsync } from '../../hooks/useAsync';
import { Card } from '@alma/ui';

export function IssueEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data, loading, error } = useAsync<Issue>(() => api(`/api/issues/${id}`), [id]);
  const assignees = useAsync<IssueAssigneeOption[]>(() => api('/api/issues/assignees'), []);

  async function handleSubmit(value: IssueFormInput) {
    try {
      setSubmitting(true);
      setSubmitError(null);
      await api<Issue>(`/api/issues/${id}`, {
        method: 'PUT',
        body: JSON.stringify(value)
      });
      navigate(`/issues/${id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to save issue');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Card title="Loading">Loading issue...</Card>;
  if (error || !data) return <Card title="Could not load issue">{error ?? 'Issue missing'}</Card>;

  return (
    <IssueForm
      mode="edit"
      initialValue={data}
      submitting={submitting}
      error={submitError}
      assignees={assignees.data ?? []}
      assigneesLoading={assignees.loading}
      assigneesError={assignees.error}
      onSubmit={handleSubmit}
    />
  );
}

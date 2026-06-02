import { useNavigate } from 'react-router-dom';
import type { Issue, IssueAssigneeOption, IssueFormInput } from '@alma/shared';
import { useState } from 'react';
import { api } from '../../lib/api';
import { IssueForm } from '../../features/issues/IssueForm';
import { useAsync } from '../../hooks/useAsync';

export function IssueCreatePage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assignees = useAsync<IssueAssigneeOption[]>(() => api('/api/issues/assignees'), []);
  const areas = useAsync<string[]>(() => api('/api/issues/areas'), []);

  async function handleSubmit(value: IssueFormInput) {
    try {
      setSubmitting(true);
      setError(null);
      const created = await api<Issue>('/api/issues', {
        method: 'POST',
        body: JSON.stringify(value)
      });
      navigate(`/issues/${created.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create issue');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <IssueForm
      mode="create"
      submitting={submitting}
      error={error}
      assignees={assignees.data ?? []}
      assigneesLoading={assignees.loading}
      assigneesError={assignees.error}
      areaOptions={areas.data ?? []}
      onSubmit={handleSubmit}
    />
  );
}

import type { IssueStatus, IssueFormInput } from '@alma/shared';

export const ISSUE_STATUSES: IssueStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'PARTIAL',
  'MONITORING',
  'BLOCKED',
  'RESOLVED',
  'CLOSED'
];

// User-facing labels. The enum value IN_PROGRESS stays in code; only its label changes.
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'On it',
  PARTIAL: 'Partial',
  MONITORING: 'Monitoring',
  BLOCKED: 'Blocked',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed'
};

export function issueStatusLabel(status: IssueStatus): string {
  return ISSUE_STATUS_LABELS[status] ?? status.replace('_', ' ');
}

export const emptyIssueForm: IssueFormInput = {
  title: '',
  description: '',
  severity: 'MEDIUM',
  category: '',
  status: 'OPEN',
  assignee: '',
  dueDate: '',
  notes: '',
  resolutionNotes: '',
  evidence: []
};

import type { IssueFormInput } from '@alma/shared';

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

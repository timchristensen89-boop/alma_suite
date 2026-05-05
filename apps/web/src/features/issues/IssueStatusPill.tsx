import type { IssueStatus } from '@alma/shared';

export function IssueStatusPill({ status }: { status: IssueStatus }) {
  return <span className={`pill status-${status.toLowerCase()}`}>{status.replace('_', ' ')}</span>;
}

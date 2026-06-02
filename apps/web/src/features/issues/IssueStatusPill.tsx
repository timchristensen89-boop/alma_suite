import type { IssueStatus } from '@alma/shared';
import { issueStatusLabel } from './defaults';

export function IssueStatusPill({ status }: { status: IssueStatus }) {
  return (
    <span className={`pill status-${status.toLowerCase()}`}>
      {issueStatusLabel(status)}
    </span>
  );
}

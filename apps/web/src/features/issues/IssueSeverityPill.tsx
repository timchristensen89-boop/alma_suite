import type { IssueSeverity } from '@alma/shared';

export function IssueSeverityPill({ severity }: { severity: IssueSeverity }) {
  return <span className={`pill severity-${severity.toLowerCase()}`}>{severity}</span>;
}

// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { NavLink } from 'react-router-dom';
import type { StaffHrRecord } from '@alma/shared';
import { Badge, Card, PageHeader, StatCard } from '@alma/ui';
import { HR_SECTION_LINKS, HrRecordList } from './shared';

export function HrOverviewPage({ records, loading }: { records: StaffHrRecord[]; loading: boolean }) {
  const attentionItems = records.filter((record) =>
    record.status === 'RE_REQUESTED' ||
    record.status === 'EXPIRED' ||
    (record.expiryDate && new Date(record.expiryDate).getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000)
  );
  const recentRecords = records.slice(0, 6);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Restricted HR"
        title="HR records"
        description="HR records are restricted. Only authorised managers can view these documents."
      />
      <div className="stats-grid">
        <StatCard label="HR records" value={records.length} hint="Restricted register" loading={loading} />
        <StatCard label="Attention items" value={attentionItems.length} hint="Expiry or re-request" tone={attentionItems.length ? 'warning' : 'positive'} loading={loading} />
        <StatCard label="Right-to-work" value={records.filter((record) => record.recordType === 'RIGHT_TO_WORK').length} hint="Sensitive work-rights records" loading={loading} />
      </div>
      <Card title="HR sections" subtitle="Each workflow has its own page. Admin owns setup and permissions.">
        <div className="app-access-grid">
          {HR_SECTION_LINKS.map((link) => (
            <NavLink key={link.to} className="app-access-tile" to={link.to}>
              <span className="app-access-title">
                <span className="sidebar-nav-icon" aria-hidden="true">{link.icon}</span>
                <strong>{link.title}</strong>
              </span>
              <span className="subtle">{link.description}</span>
              <Badge tone="info">{link.type ? records.filter((record) => record.recordType === link.type).length : records.length} records</Badge>
            </NavLink>
          ))}
        </div>
      </Card>
      <Card title="Recent HR actions" subtitle="Record activity from the restricted HR register.">
        <HrRecordList records={recentRecords} emptyTitle="No HR actions yet" />
      </Card>
    </div>
  );
}

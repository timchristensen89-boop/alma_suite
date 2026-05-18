import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Badge, Button, Card, PageHeader } from '@alma/ui';
import {
  DEFAULT_HANDBOOK_CONTENT,
  resolveHandbookContent,
  type OrgMember
} from '../../data/handbook';
import {
  IconArrowLeft,
  IconCheck,
  IconMail,
  IconPhone,
  IconUsers
} from '../../lib/icons';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';

type TreeNode = OrgMember & { children: TreeNode[] };

function buildTree(members: OrgMember[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  members.forEach((m) => byId.set(m.id, { ...m, children: [] }));

  const roots: TreeNode[] = [];
  members.forEach((m) => {
    const node = byId.get(m.id);
    if (!node) return;
    if (m.reportsTo === null) {
      roots.push(node);
      return;
    }
    const parent = byId.get(m.reportsTo);
    if (parent) {
      parent.children.push(node);
    } else {
      // Orphaned reportsTo — treat as root so nothing disappears.
      roots.push(node);
    }
  });
  return roots;
}

function initials(name: string) {
  const cleaned = name.replace(/[\[\]]/g, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function OrgNode({ node, depth }: { node: TreeNode; depth: number }) {
  const isPlaceholder = node.name.startsWith('[');

  return (
    <li className="org-node">
      <article className={`org-card ${isPlaceholder ? 'is-placeholder' : ''}`.trim()}>
        <div className="org-card-header">
          <span className="org-avatar" aria-hidden="true">
            {initials(node.name)}
          </span>
          <div className="org-card-identity">
            <strong>{node.name}</strong>
            <span>{node.title}</span>
          </div>
          {depth === 0 ? (
            <Badge tone="indigo" dot>
              Top of structure
            </Badge>
          ) : null}
        </div>

        {node.responsibilities.length > 0 ? (
          <div className="org-card-section">
            <p className="eyebrow">Responsibilities</p>
            <ul className="org-responsibilities">
              {node.responsibilities.map((item, index) => (
                <li key={index}>
                  <span className="org-bullet" aria-hidden="true">
                    <IconCheck size={12} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {node.email || node.phone || node.venue ? (
          <div className="org-card-footer">
            {node.venue ? <Badge tone="muted">{node.venue}</Badge> : null}
            {node.email ? (
              <a className="org-contact" href={`mailto:${node.email}`}>
                <IconMail size={12} /> {node.email}
              </a>
            ) : null}
            {node.phone ? (
              <a className="org-contact" href={`tel:${node.phone}`}>
                <IconPhone size={12} /> {node.phone}
              </a>
            ) : null}
          </div>
        ) : null}
      </article>

      {node.children.length > 0 ? (
        <ul className="org-children">
          {node.children.map((child) => (
            <OrgNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgChartPage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);
  const roots = useMemo(() => buildTree(handbook.orgMembers), [handbook.orgMembers]);
  const totalRoles = handbook.orgMembers.length;
  const placeholderCount = handbook.orgMembers.filter((m) => m.name.startsWith('[')).length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Handbook"
        title="Org chart & responsibilities"
        description="Who to ask, who checks what, and how service questions should be escalated."
        actions={
          <Link to="/handbook">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<IconArrowLeft size={14} />}
            >
              Back to handbook
            </Button>
          </Link>
        }
      />

      <div className="handbook-quick-facts">
        <div>
          <strong>{totalRoles}</strong>
          <span>roles in total</span>
        </div>
        <div>
          <strong>{roots.length}</strong>
          <span>at the top</span>
        </div>
        <div>
          <strong>{totalRoles - placeholderCount}</strong>
          <span>filled · {placeholderCount} to fill</span>
        </div>
      </div>

      {placeholderCount > 0 ? (
        <Card>
          <div className="inline-actions" style={{ gap: 12, alignItems: 'flex-start' }}>
            <IconUsers size={18} />
            <div>
            <strong>This chart has {placeholderCount} placeholder roles.</strong>{' '}
            <span className="muted">
              Names wrapped in [brackets] are placeholders. Ask a manager if
              something is unclear.
            </span>
          </div>
        </div>
        </Card>
      ) : null}

      <Card padding="none">
        <div className="org-tree-wrapper">
          <ul className="org-tree">
            {roots.map((root) => (
              <OrgNode key={root.id} node={root} depth={0} />
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

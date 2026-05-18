import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, PageHeader } from '@alma/ui';
import {
  DEFAULT_HANDBOOK_CONTENT,
  resolveHandbookContent,
  type HandbookContent,
  type HandbookSection,
  type Guideline,
  type MaintenanceCategory,
  type OnboardingStep,
  type OrgMember
} from '../../data/handbook';
import { IconArrowRight, IconHandbook, IconUsers } from '../../lib/icons';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';

const iconBySection: Record<string, JSX.Element> = {
  'org-chart': <IconUsers size={20} />,
  guidelines: <IconHandbook size={20} />,
  onboarding: <IconHandbook size={20} />,
  maintenance: <IconHandbook size={20} />
};

type EditorState = {
  orgMembers: OrgMember[];
  handbookSections: HandbookSection[];
  guidelines: Guideline[];
  onboardingSteps: OnboardingStep[];
  maintenanceCategories: MaintenanceCategory[];
};

function cloneHandbook(content: HandbookContent): EditorState {
  return {
    orgMembers: [...(content.orgMembers ?? [])],
    handbookSections: [...(content.handbookSections ?? [])],
    guidelines: [...(content.guidelines ?? [])],
    onboardingSteps: [...(content.onboardingSteps ?? [])],
    maintenanceCategories: [...(content.maintenanceCategories ?? [])]
  };
}

function splitLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function setArrayItem<T>(items: T[], index: number, patch: Partial<T>) {
  return items.map((item, current) => (current === index ? { ...item, ...patch } : item));
}

function OrgEditor({
  orgMembers,
  setOrgMembers
}: {
  orgMembers: OrgMember[];
  setOrgMembers: (value: OrgMember[]) => void;
}) {
  return (
    <Card title="Org chart" subtitle="Edit names, titles, and reporting lines.">
      <div className="page-stack compact">
        {orgMembers.map((member, index) => (
          <div key={member.id} className="soft-panel">
            <div className="form-grid two">
              <label>
                <span className="field-label">Name</span>
                <input
                  className="field-control"
                  value={member.name}
                  onChange={(event) => setOrgMembers(setArrayItem(orgMembers, index, { name: event.target.value }))}
                />
              </label>
              <label>
                <span className="field-label">Title</span>
                <input
                  className="field-control"
                  value={member.title}
                  onChange={(event) => setOrgMembers(setArrayItem(orgMembers, index, { title: event.target.value }))}
                />
              </label>
              <label>
                <span className="field-label">Reports to</span>
                <input
                  className="field-control"
                  value={member.reportsTo ?? ''}
                  onChange={(event) =>
                    setOrgMembers(setArrayItem(orgMembers, index, { reportsTo: event.target.value || null }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Venue</span>
                <input
                  className="field-control"
                  value={member.venue ?? ''}
                  onChange={(event) =>
                    setOrgMembers(setArrayItem(orgMembers, index, { venue: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Email</span>
                <input
                  className="field-control"
                  value={member.email ?? ''}
                  onChange={(event) =>
                    setOrgMembers(setArrayItem(orgMembers, index, { email: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Phone</span>
                <input
                  className="field-control"
                  value={member.phone ?? ''}
                  onChange={(event) =>
                    setOrgMembers(setArrayItem(orgMembers, index, { phone: event.target.value || undefined }))
                  }
                />
              </label>
            </div>
            <label>
              <span className="field-label">Responsibilities, one per line</span>
              <textarea
                className="field-control field-textarea"
                rows={4}
                value={member.responsibilities.join('\n')}
                onChange={(event) =>
                  setOrgMembers(setArrayItem(orgMembers, index, {
                    responsibilities: splitLines(event.target.value)
                  }))
                }
              />
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SectionsEditor({
  handbookSections,
  setHandbookSections
}: {
  handbookSections: HandbookSection[];
  setHandbookSections: (value: HandbookSection[]) => void;
}) {
  return (
    <Card title="Handbook cards" subtitle="These are the main handbook landing cards.">
      <div className="page-stack compact">
        {handbookSections.map((section, index) => (
          <div key={section.id} className="soft-panel">
            <div className="form-grid two">
              <label>
                <span className="field-label">Title</span>
                <input
                  className="field-control"
                  value={section.title}
                  onChange={(event) =>
                    setHandbookSections(setArrayItem(handbookSections, index, { title: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Status</span>
                <input
                  className="field-control"
                  value={section.status}
                  onChange={(event) =>
                    setHandbookSections(setArrayItem(handbookSections, index, { status: event.target.value as HandbookSection['status'] }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Href</span>
                <input
                  className="field-control"
                  value={section.href}
                  onChange={(event) =>
                    setHandbookSections(setArrayItem(handbookSections, index, { href: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Summary</span>
                <textarea
                  className="field-control field-textarea"
                  rows={4}
                  value={section.summary}
                  onChange={(event) =>
                    setHandbookSections(setArrayItem(handbookSections, index, { summary: event.target.value }))
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GuidelinesEditor({
  guidelines,
  setGuidelines
}: {
  guidelines: Guideline[];
  setGuidelines: (value: Guideline[]) => void;
}) {
  return (
    <Card title="Guidelines" subtitle="Edit the guideline copy and update date.">
      <div className="page-stack compact">
        {guidelines.map((guideline, index) => (
          <div key={guideline.id} className="soft-panel">
            <div className="form-grid two">
              <label>
                <span className="field-label">Title</span>
                <input
                  className="field-control"
                  value={guideline.title}
                  onChange={(event) =>
                    setGuidelines(setArrayItem(guidelines, index, { title: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Category</span>
                <input
                  className="field-control"
                  value={guideline.category}
                  onChange={(event) =>
                    setGuidelines(setArrayItem(guidelines, index, { category: event.target.value as Guideline['category'] }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Summary</span>
                <textarea
                  className="field-control field-textarea"
                  rows={3}
                  value={guideline.summary}
                  onChange={(event) =>
                    setGuidelines(setArrayItem(guidelines, index, { summary: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Last updated</span>
                <input
                  className="field-control"
                  value={guideline.lastUpdated ?? ''}
                  onChange={(event) =>
                    setGuidelines(setArrayItem(guidelines, index, { lastUpdated: event.target.value || undefined }))
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OnboardingEditor({
  onboardingSteps,
  setOnboardingSteps
}: {
  onboardingSteps: OnboardingStep[];
  setOnboardingSteps: (value: OnboardingStep[]) => void;
}) {
  return (
    <Card title="Onboarding" subtitle="Edit the onboarding steps staff see on their first day.">
      <div className="page-stack compact">
        {onboardingSteps.map((step, index) => (
          <div key={step.id} className="soft-panel">
            <div className="form-grid two">
              <label>
                <span className="field-label">Title</span>
                <input
                  className="field-control"
                  value={step.title}
                  onChange={(event) =>
                    setOnboardingSteps(setArrayItem(onboardingSteps, index, { title: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Phase</span>
                <input
                  className="field-control"
                  value={step.phase}
                  onChange={(event) =>
                    setOnboardingSteps(setArrayItem(onboardingSteps, index, { phase: event.target.value as OnboardingStep['phase'] }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Contact</span>
                <input
                  className="field-control"
                  value={step.contact ?? ''}
                  onChange={(event) =>
                    setOnboardingSteps(setArrayItem(onboardingSteps, index, { contact: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Systems, one per line</span>
                <textarea
                  className="field-control field-textarea"
                  rows={3}
                  value={(step.systems ?? []).join('\n')}
                  onChange={(event) =>
                    setOnboardingSteps(setArrayItem(onboardingSteps, index, {
                      systems: splitLines(event.target.value)
                    }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Description</span>
                <textarea
                  className="field-control field-textarea"
                  rows={4}
                  value={step.description}
                  onChange={(event) =>
                    setOnboardingSteps(setArrayItem(onboardingSteps, index, { description: event.target.value }))
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MaintenanceEditor({
  maintenanceCategories,
  setMaintenanceCategories
}: {
  maintenanceCategories: MaintenanceCategory[];
  setMaintenanceCategories: (value: MaintenanceCategory[]) => void;
}) {
  return (
    <Card title="Maintenance contacts" subtitle="Edit who to call and what to check first.">
      <div className="page-stack compact">
        {maintenanceCategories.map((category, index) => (
          <div key={category.id} className="soft-panel">
            <div className="form-grid two">
              <label>
                <span className="field-label">Title</span>
                <input
                  className="field-control"
                  value={category.title}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, { title: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Urgency</span>
                <input
                  className="field-control"
                  value={category.urgency}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, { urgency: event.target.value as MaintenanceCategory['urgency'] }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Description</span>
                <textarea
                  className="field-control field-textarea"
                  rows={3}
                  value={category.description}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, { description: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Before you call, one per line</span>
                <textarea
                  className="field-control field-textarea"
                  rows={4}
                  value={(category.beforeYouCall ?? []).join('\n')}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, {
                      beforeYouCall: splitLines(event.target.value)
                    }))
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function HandbookIndexPage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);
  const readySections = handbook.handbookSections.filter((section) => section.status === 'ready');
  const topLevelCount = handbook.orgMembers.filter((m) => m.reportsTo === null).length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Handbook"
        title="Staff handbook"
        description="Read the venue guidance before service, check the policy that applies, and ask a manager if something is unclear."
      />

      <div className="handbook-grid">
        {handbook.handbookSections.map((section) => {
          const isReady = section.status === 'ready';
          const Wrapper = ({ children }: { children: JSX.Element }) =>
            isReady ? (
              <Link to={section.href} className="handbook-card-link">
                {children}
              </Link>
            ) : (
              <div className="handbook-card-link handbook-card-link-disabled">
                {children}
              </div>
            );

          return (
            <Wrapper key={section.id}>
              <article className={`handbook-card ${isReady ? '' : 'is-disabled'}`.trim()}>
                <div className="handbook-card-icon">
                  {iconBySection[section.id] ?? <IconHandbook size={20} />}
                </div>
                <div className="handbook-card-body">
                  <div className="handbook-card-header">
                    <h3>{section.title}</h3>
                    {isReady ? (
                      <Badge tone="positive" dot>
                        Ready
                      </Badge>
                    ) : (
                      <Badge tone="muted">Unavailable</Badge>
                    )}
                  </div>
                  <p>{section.summary}</p>
                  {isReady ? (
                    <span className="handbook-card-cta">
                      Open section <IconArrowRight size={14} />
                    </span>
                  ) : null}
                </div>
              </article>
            </Wrapper>
          );
        })}
      </div>

      <Card title="Before service" subtitle="Use the handbook to check how the venue handles common questions, records, and escalation.">
        <div className="handbook-quick-facts">
          <div>
            <strong>{readySections.length}</strong>
            <span>sections ready to read</span>
          </div>
          <div>
            <strong>{handbook.guidelines.length}</strong>
            <span>guidelines available</span>
          </div>
          <div>
            <strong>{topLevelCount}</strong>
            <span>leadership contacts listed</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function HandbookAdminPage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EditorState | null>(null);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);

  useEffect(() => {
    if (!draft && settings.data) {
      setDraft(cloneHandbook(handbook));
    }
  }, [draft, handbook, settings.data]);

  const editable = draft ?? cloneHandbook(handbook);
  const topLevelCount = editable.orgMembers.filter((m) => m.reportsTo === null).length;

  async function saveHandbook() {
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          handbookContent: {
            orgMembers: editable.orgMembers,
            handbookSections: editable.handbookSections,
            guidelines: editable.guidelines,
            onboardingSteps: editable.onboardingSteps,
            maintenanceCategories: editable.maintenanceCategories
          }
        })
      });
      await settings.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin"
        title="Manage handbook"
        description="Edit the sections, guidance, onboarding notes, org chart, and maintenance contacts that appear in the staff-facing handbook."
        actions={
          <Link to="/handbook">
            <Button variant="ghost" size="sm">
              View staff handbook
            </Button>
          </Link>
        }
      />

      <div className="handbook-grid">
        {editable.handbookSections.map((section) => {
          const isReady = section.status === 'ready';
          const Wrapper = ({ children }: { children: JSX.Element }) =>
            isReady ? (
              <Link to={section.href} className="handbook-card-link">
                {children}
              </Link>
            ) : (
              <div className="handbook-card-link handbook-card-link-disabled">
                {children}
              </div>
            );

          return (
            <Wrapper key={section.id}>
              <article className={`handbook-card ${isReady ? '' : 'is-disabled'}`.trim()}>
                <div className="handbook-card-icon">
                  {iconBySection[section.id] ?? <IconHandbook size={20} />}
                </div>
                <div className="handbook-card-body">
                  <div className="handbook-card-header">
                    <h3>{section.title}</h3>
                    {isReady ? (
                      <Badge tone="positive" dot>
                        Ready
                      </Badge>
                    ) : (
                      <Badge tone="muted">Unavailable</Badge>
                    )}
                  </div>
                  <p>{section.summary}</p>
                  {isReady ? (
                    <span className="handbook-card-cta">
                      Open <IconArrowRight size={14} />
                    </span>
                  ) : null}
                </div>
              </article>
            </Wrapper>
          );
        })}
      </div>

      <Card
        title="Quick facts"
        subtitle="These counts come from the saved handbook settings."
      >
        <div className="handbook-quick-facts">
          <div>
            <strong>{editable.orgMembers.length}</strong>
            <span>roles in the org chart</span>
          </div>
          <div>
            <strong>{topLevelCount}</strong>
            <span>at the top of the structure</span>
          </div>
          <div>
            <strong>{editable.handbookSections.filter((s) => s.status === 'ready').length}</strong>
            <span>of {editable.handbookSections.length} sections ready</span>
          </div>
        </div>
      </Card>

      <OrgEditor orgMembers={editable.orgMembers} setOrgMembers={(value) => setDraft((current) => ({ ...(current ?? editable), orgMembers: value }))} />
      <SectionsEditor handbookSections={editable.handbookSections} setHandbookSections={(value) => setDraft((current) => ({ ...(current ?? editable), handbookSections: value }))} />
      <GuidelinesEditor guidelines={editable.guidelines} setGuidelines={(value) => setDraft((current) => ({ ...(current ?? editable), guidelines: value }))} />
      <OnboardingEditor onboardingSteps={editable.onboardingSteps} setOnboardingSteps={(value) => setDraft((current) => ({ ...(current ?? editable), onboardingSteps: value }))} />
      <MaintenanceEditor maintenanceCategories={editable.maintenanceCategories} setMaintenanceCategories={(value) => setDraft((current) => ({ ...(current ?? editable), maintenanceCategories: value }))} />

      <Card>
        <div className="inline-actions" style={{ justifyContent: 'space-between', gap: 12 }}>
          <span className="muted small">Changes save to the settings record and update the handbook pages immediately after refresh.</span>
          <Button onClick={() => void saveHandbook()} disabled={saving}>
            {saving ? 'Saving...' : 'Publish handbook updates'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

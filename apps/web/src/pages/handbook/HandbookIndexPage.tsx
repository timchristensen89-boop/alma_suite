import { Link } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { Badge, Button, Card, CollapsibleCard, Input, PageHeader, Textarea } from '@alma/ui';
import {
  DEFAULT_HANDBOOK_CONTENT,
  resolveHandbookContent,
  newCmsSection,
  newMaintenanceContact,
  type CmsSection,
  type HandbookContent,
  type HandbookSection,
  type Guideline,
  type MaintenanceCategory,
  type MaintenanceContactEntry,
  type OnboardingStep,
  type OrgMember,
  type ResolvedHandbookContent
} from '../../data/handbook';
import { IconArrowRight, IconHandbook, IconUsers } from '../../lib/icons';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

function splitLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function setArrayItem<T>(items: T[], index: number, patch: Partial<T>): T[] {
  return items.map((item, current) => (current === index ? { ...item, ...patch } : item));
}

function moveItem<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const next = [...items];
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return next;
  const temp = next[index] as T;
  next[index] = next[target] as T;
  next[target] = temp;
  return next;
}

function formatDate(iso: string | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
}

const CATEGORY_LABELS: Record<MaintenanceContactEntry['category'], string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  gas: 'Gas',
  refrigeration: 'Refrigeration',
  hvac: 'HVAC / Air con',
  locksmith: 'Locksmith',
  'pest-control': 'Pest control',
  general: 'General repairs'
};

const VENUE_LABELS: Record<CmsSection['venue'], string> = {
  all: 'All venues',
  'st-alma': 'St Alma',
  'alma-avalon': 'Alma Avalon'
};

const AUDIENCE_LABELS: Record<CmsSection['audience'], string> = {
  all: 'All staff',
  foh: 'FOH',
  kitchen: 'Kitchen',
  managers: 'Managers'
};

/* --------------------------------------------------------------------------
 * Fixed-section sub-editors (collapsible, nested inside the CMS panel)
 * ------------------------------------------------------------------------ */

function OrgEditor({
  orgMembers,
  setOrgMembers
}: {
  orgMembers: OrgMember[];
  setOrgMembers: (value: OrgMember[]) => void;
}) {
  return (
    <CollapsibleCard title="Org chart members" description="Edit names, titles, and reporting lines.">
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
                <span className="field-label">Reports to (id)</span>
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
                  type="email"
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
                  type="tel"
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
    </CollapsibleCard>
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
    <CollapsibleCard title="Guidelines" description="Edit guideline copy and update dates.">
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
    </CollapsibleCard>
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
    <CollapsibleCard title="Onboarding steps" description="Edit the onboarding steps staff see on their first day.">
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
                <span className="field-label">Description</span>
                <textarea
                  className="field-control field-textarea"
                  rows={3}
                  value={step.description}
                  onChange={(event) =>
                    setOnboardingSteps(setArrayItem(onboardingSteps, index, { description: event.target.value }))
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
            </div>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

function MaintenanceCategoryEditor({
  maintenanceCategories,
  setMaintenanceCategories
}: {
  maintenanceCategories: MaintenanceCategory[];
  setMaintenanceCategories: (value: MaintenanceCategory[]) => void;
}) {
  return (
    <CollapsibleCard title="Maintenance category text" description="Edit urgency levels, descriptions, and before-you-call checklist items.">
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
                <select
                  className="field-control"
                  value={category.urgency}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, {
                      urgency: event.target.value as MaintenanceCategory['urgency']
                    }))
                  }
                >
                  <option value="Routine">Routine</option>
                  <option value="Same-day">Same-day</option>
                  <option value="Immediate">Immediate</option>
                </select>
              </label>
              <label>
                <span className="field-label">Primary contact name</span>
                <input
                  className="field-control"
                  value={category.primary.name}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, {
                      primary: { ...category.primary, name: event.target.value }
                    }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Primary contact phone</span>
                <input
                  className="field-control"
                  type="tel"
                  value={category.primary.phone ?? ''}
                  onChange={(event) =>
                    setMaintenanceCategories(setArrayItem(maintenanceCategories, index, {
                      primary: { ...category.primary, phone: event.target.value || undefined }
                    }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Before you call (one per line)</span>
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
    </CollapsibleCard>
  );
}

function MaintenanceContactsEditor({
  contacts,
  setContacts
}: {
  contacts: MaintenanceContactEntry[];
  setContacts: (value: MaintenanceContactEntry[]) => void;
}) {
  function addContact() {
    setContacts([...contacts, newMaintenanceContact({ sortOrder: contacts.length })]);
  }

  function removeContact(index: number) {
    setContacts(contacts.filter((_, i) => i !== index));
  }

  return (
    <CollapsibleCard
      title="Maintenance contacts"
      description="Phone numbers and emails for maintenance contractors and emergency contacts."
    >
      <div style={{ marginBottom: 12 }}>
        <Button type="button" size="sm" variant="secondary" onClick={addContact}>
          Add contact
        </Button>
      </div>
      {contacts.length === 0 ? (
        <p className="subtle small">No contacts yet. Add one to display phone and email on the Maintenance page.</p>
      ) : null}
      <div className="page-stack compact">
        {contacts.map((contact, index) => (
          <div key={contact.id} className="soft-panel">
            <div className="form-grid three">
              <label>
                <span className="field-label">Category</span>
                <select
                  className="field-control"
                  value={contact.category}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { category: event.target.value as MaintenanceContactEntry['category'] }))
                  }
                >
                  {(Object.entries(CATEGORY_LABELS) as [MaintenanceContactEntry['category'], string][]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Venue</span>
                <select
                  className="field-control"
                  value={contact.venue}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { venue: event.target.value as MaintenanceContactEntry['venue'] }))
                  }
                >
                  <option value="all">All venues</option>
                  <option value="st-alma">St Alma</option>
                  <option value="alma-avalon">Alma Avalon</option>
                </select>
              </label>
              <label>
                <span className="field-label">Company / name</span>
                <input
                  className="field-control"
                  value={contact.companyName ?? ''}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { companyName: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Contact name</span>
                <input
                  className="field-control"
                  value={contact.contactName ?? ''}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { contactName: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Phone</span>
                <input
                  className="field-control"
                  type="tel"
                  value={contact.phone ?? ''}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { phone: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Email</span>
                <input
                  className="field-control"
                  type="email"
                  value={contact.email ?? ''}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { email: event.target.value || undefined }))
                  }
                />
              </label>
              <label>
                <span className="field-label">Notes</span>
                <input
                  className="field-control"
                  value={contact.notes ?? ''}
                  onChange={(event) =>
                    setContacts(setArrayItem(contacts, index, { notes: event.target.value || undefined }))
                  }
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <label className="check-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={contact.isEmergency}
                    onChange={(event) =>
                      setContacts(setArrayItem(contacts, index, { isEmergency: event.target.checked }))
                    }
                  />
                  Emergency
                </label>
                <label className="check-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={contact.isActive}
                    onChange={(event) =>
                      setContacts(setArrayItem(contacts, index, { isActive: event.target.checked }))
                    }
                  />
                  Active
                </label>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm('Remove this contact?')) removeContact(index);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

/* --------------------------------------------------------------------------
 * CMS section editor
 * ------------------------------------------------------------------------ */

type FixedSectionId = 'org-chart' | 'guidelines' | 'onboarding' | 'maintenance';

const FIXED_SECTIONS: { id: FixedSectionId; label: string; description: string }[] = [
  { id: 'org-chart', label: 'Org chart', description: 'Team structure and reporting lines' },
  { id: 'guidelines', label: 'Guidelines', description: 'RSA, allergens, service standards' },
  { id: 'onboarding', label: 'Onboarding', description: 'First-day steps and setup tasks' },
  { id: 'maintenance', label: 'Maintenance', description: 'Contacts, categories, and before-you-call' }
];

function CmsSectionEditor({
  section,
  onChange,
  onSaveDraft,
  onPublish,
  onHide,
  onDelete,
  saving
}: {
  section: CmsSection;
  onChange: (patch: Partial<CmsSection>) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  onHide: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const hasDraft = section.draftBody !== undefined;
  const draftDiffersFromPublished = section.draftBody !== section.body;

  if (preview) {
    return (
      <div className="handbook-section-preview">
        <div className="handbook-editor-panel-header">
          <div>
            <h3>{section.title}</h3>
            {section.subtitle ? <p className="subtle">{section.subtitle}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(false)}>← Edit</Button>
        </div>
        {section.body ? (
          <div className="handbook-preview-body">
            {section.body.split('\n').map((line, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <p key={i}>{line || <br />}</p>
            ))}
          </div>
        ) : (
          <p className="subtle">No published content yet.</p>
        )}
        {hasDraft && draftDiffersFromPublished ? (
          <div className="handbook-preview-draft-note">
            <Badge tone="warning">Unpublished draft</Badge>
            <span className="subtle small">This preview shows the published version. Draft changes are not shown.</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="handbook-section-editor">
      <div className="handbook-editor-panel-header">
        <div>
          <Badge
            tone={section.status === 'PUBLISHED' ? 'positive' : section.status === 'HIDDEN' ? 'muted' : 'warning'}
          >
            {section.status === 'PUBLISHED' ? 'Published' : section.status === 'HIDDEN' ? 'Hidden' : 'Draft'}
          </Badge>
          {section.publishedAt ? (
            <span className="subtle small" style={{ marginLeft: 8 }}>
              Last published {formatDate(section.publishedAt)}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(true)}>Preview ↗</Button>
      </div>

      <div className="page-stack compact">
        <Input
          label="Title"
          value={section.title}
          onChange={(event) => onChange({ title: event.currentTarget.value })}
        />
        <Input
          label="Subtitle (optional)"
          value={section.subtitle ?? ''}
          onChange={(event) => onChange({ subtitle: event.currentTarget.value || undefined })}
        />

        <div className="form-grid two">
          <label>
            <span className="field-label">Venue</span>
            <select
              className="field-control"
              value={section.venue}
              onChange={(event) => onChange({ venue: event.target.value as CmsSection['venue'] })}
            >
              {(Object.entries(VENUE_LABELS) as [CmsSection['venue'], string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Audience</span>
            <select
              className="field-control"
              value={section.audience}
              onChange={(event) => onChange({ audience: event.target.value as CmsSection['audience'] })}
            >
              {(Object.entries(AUDIENCE_LABELS) as [CmsSection['audience'], string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <Textarea
          label={hasDraft && draftDiffersFromPublished ? 'Draft content (unpublished changes)' : 'Content'}
          rows={12}
          value={section.draftBody ?? section.body}
          onChange={(event) => onChange({ draftBody: event.currentTarget.value })}
          placeholder="Write section content here. Plain text — each paragraph on its own line."
        />

        {hasDraft && draftDiffersFromPublished ? (
          <p className="subtle small">Draft differs from published version. Save draft to preserve, or publish to make it live.</p>
        ) : null}
      </div>

      <div className="handbook-section-actions">
        <Button type="button" variant="secondary" disabled={saving} onClick={onSaveDraft}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button type="button" disabled={saving} onClick={onPublish}>
          {saving ? 'Publishing…' : section.status === 'PUBLISHED' ? 'Republish' : 'Publish'}
        </Button>
        {section.status === 'PUBLISHED' ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={onHide}>
            Hide from staff
          </Button>
        ) : null}
        <span style={{ flex: 1 }} />
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            if (window.confirm(`Delete "${section.title}"? This cannot be undone.`)) onDelete();
          }}
        >
          Delete section
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Sidebar — section list
 * ------------------------------------------------------------------------ */

function StatusChip({ status }: { status: CmsSection['status'] }) {
  return (
    <Badge
      tone={status === 'PUBLISHED' ? 'positive' : status === 'HIDDEN' ? 'muted' : 'warning'}
      dot
    >
      {status === 'PUBLISHED' ? 'Published' : status === 'HIDDEN' ? 'Hidden' : 'Draft'}
    </Badge>
  );
}

/* --------------------------------------------------------------------------
 * Handbook Admin Page — main CMS editor
 * ------------------------------------------------------------------------ */

type EditorSelection =
  | { type: 'fixed'; id: FixedSectionId }
  | { type: 'cms'; id: string }
  | null;

type EditorState = {
  orgMembers: OrgMember[];
  handbookSections: HandbookSection[];
  guidelines: Guideline[];
  onboardingSteps: OnboardingStep[];
  maintenanceCategories: MaintenanceCategory[];
  maintenanceContacts: MaintenanceContactEntry[];
  cmsSections: CmsSection[];
  lastPublishedAt?: string;
};

function cloneState(content: ResolvedHandbookContent): EditorState {
  return {
    orgMembers: [...content.orgMembers],
    handbookSections: [...content.handbookSections],
    guidelines: [...content.guidelines],
    onboardingSteps: [...content.onboardingSteps],
    maintenanceCategories: [...content.maintenanceCategories],
    maintenanceContacts: [...content.maintenanceContacts],
    cmsSections: content.cmsSections.map((s) => ({ ...s })),
    lastPublishedAt: content.lastPublishedAt
  };
}

export function HandbookAdminPage({ staffHandbookHref = '/handbook' }: { staffHandbookHref?: string }) {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const [saved, setSaved] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<EditorState | null>(null);
  const [selected, setSelected] = useState<EditorSelection>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [search, setSearch] = useState('');

  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);

  useEffect(() => {
    if (!saved && settings.data) {
      const state = cloneState(handbook);
      setSaved(state);
      setDraft(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const editable: EditorState = draft ?? cloneState(handbook);

  const externalStaffHandbook = /^https?:\/\//i.test(staffHandbookHref);

  function staffHref(sectionHref = '/handbook') {
    const root = staffHandbookHref.replace(/\/+$/, '');
    const suffix = sectionHref.replace(/^\/handbook/, '');
    return `${root}${suffix}`;
  }

  async function persist(state: EditorState) {
    setSaving(true);
    setFeedback(null);
    try {
      const handbookContent: HandbookContent = {
        orgMembers: state.orgMembers,
        handbookSections: state.handbookSections,
        guidelines: state.guidelines,
        onboardingSteps: state.onboardingSteps,
        maintenanceCategories: state.maintenanceCategories,
        maintenanceContacts: state.maintenanceContacts,
        cmsSections: state.cmsSections,
        lastPublishedAt: state.lastPublishedAt
      };
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ handbookContent })
      });
      await settings.reload();
      setSaved(state);
      return true;
    } catch (err) {
      setFeedback({ text: err instanceof Error ? err.message : 'Could not save', tone: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function updateCmsSection(id: string, patch: Partial<CmsSection>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        cmsSections: current.cmsSections.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s))
      };
    });
  }

  async function saveDraftSection(id: string) {
    const state = draft;
    if (!state) return;
    const ok = await persist(state);
    if (ok) setFeedback({ text: 'Draft saved.', tone: 'success' });
  }

  async function publishSection(id: string) {
    const state = draft;
    if (!state) return;
    const now = new Date().toISOString();
    const next: EditorState = {
      ...state,
      lastPublishedAt: now,
      cmsSections: state.cmsSections.map((s) => {
        if (s.id !== id) return s;
        const body = s.draftBody !== undefined ? s.draftBody : s.body;
        return { ...s, body, draftBody: undefined, status: 'PUBLISHED', publishedAt: now, updatedAt: now };
      })
    };
    setDraft(next);
    const ok = await persist(next);
    if (ok) setFeedback({ text: 'Section published.', tone: 'success' });
  }

  async function hideSection(id: string) {
    const state = draft;
    if (!state) return;
    const next: EditorState = {
      ...state,
      cmsSections: state.cmsSections.map((s) =>
        s.id === id ? { ...s, status: 'HIDDEN', updatedAt: new Date().toISOString() } : s
      )
    };
    setDraft(next);
    const ok = await persist(next);
    if (ok) setFeedback({ text: 'Section hidden from staff.', tone: 'success' });
  }

  async function deleteSection(id: string) {
    const state = draft;
    if (!state) return;
    const next: EditorState = {
      ...state,
      cmsSections: state.cmsSections.filter((s) => s.id !== id)
    };
    setDraft(next);
    setSelected(null);
    const ok = await persist(next);
    if (ok) setFeedback({ text: 'Section deleted.', tone: 'success' });
  }

  function addCmsSection() {
    const now = new Date().toISOString();
    const newSection = newCmsSection({ sortOrder: editable.cmsSections.length, createdAt: now, updatedAt: now });
    const next: EditorState = {
      ...editable,
      cmsSections: [...editable.cmsSections, newSection]
    };
    setDraft(next);
    setSelected({ type: 'cms', id: newSection.id });
  }

  async function saveFixed() {
    const ok = await persist(editable);
    if (ok) setFeedback({ text: 'Changes saved.', tone: 'success' });
  }

  function moveSection(id: string, direction: 'up' | 'down') {
    setDraft((current) => {
      if (!current) return current;
      const index = current.cmsSections.findIndex((s) => s.id === id);
      if (index < 0) return current;
      return { ...current, cmsSections: moveItem(current.cmsSections, index, direction) };
    });
  }

  // Filtered section list
  const filteredFixed = FIXED_SECTIONS.filter((s) =>
    !search || s.label.toLowerCase().includes(search.toLowerCase())
  );
  const filteredCms = editable.cmsSections.filter((s) =>
    !search || s.title.toLowerCase().includes(search.toLowerCase())
  );

  const selectedCmsSection =
    selected?.type === 'cms' ? editable.cmsSections.find((s) => s.id === selected.id) ?? null : null;

  // Render the right-panel content based on selection
  function renderPanel() {
    if (!selected) {
      return (
        <div className="handbook-editor-empty">
          <p className="subtle">Select a section from the list to edit it, or add a new section below.</p>
        </div>
      );
    }

    if (selected.type === 'cms' && selectedCmsSection) {
      return (
        <CmsSectionEditor
          section={selectedCmsSection}
          onChange={(patch) => updateCmsSection(selected.id, patch)}
          onSaveDraft={() => void saveDraftSection(selected.id)}
          onPublish={() => void publishSection(selected.id)}
          onHide={() => void hideSection(selected.id)}
          onDelete={() => void deleteSection(selected.id)}
          saving={saving}
        />
      );
    }

    // Fixed section editors
    if (selected.type === 'fixed') {
      return (
        <div className="handbook-editor-fixed-panel">
          <div className="handbook-editor-panel-header">
            <h3>{FIXED_SECTIONS.find((s) => s.id === selected.id)?.label}</h3>
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void saveFixed()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
          {selected.id === 'org-chart' && (
            <OrgEditor
              orgMembers={editable.orgMembers}
              setOrgMembers={(value) => setDraft((c) => ({ ...(c ?? editable), orgMembers: value }))}
            />
          )}
          {selected.id === 'guidelines' && (
            <GuidelinesEditor
              guidelines={editable.guidelines}
              setGuidelines={(value) => setDraft((c) => ({ ...(c ?? editable), guidelines: value }))}
            />
          )}
          {selected.id === 'onboarding' && (
            <OnboardingEditor
              onboardingSteps={editable.onboardingSteps}
              setOnboardingSteps={(value) => setDraft((c) => ({ ...(c ?? editable), onboardingSteps: value }))}
            />
          )}
          {selected.id === 'maintenance' && (
            <div className="page-stack">
              <MaintenanceContactsEditor
                contacts={editable.maintenanceContacts}
                setContacts={(value) => setDraft((c) => ({ ...(c ?? editable), maintenanceContacts: value }))}
              />
              <MaintenanceCategoryEditor
                maintenanceCategories={editable.maintenanceCategories}
                setMaintenanceCategories={(value) => setDraft((c) => ({ ...(c ?? editable), maintenanceCategories: value }))}
              />
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  const lastPublished = editable.lastPublishedAt;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin"
        title="Handbook editor"
        description={
          lastPublished
            ? `Last published ${formatDate(lastPublished)}`
            : 'Manage the staff handbook sections, contacts, and org chart.'
        }
        actions={
          externalStaffHandbook ? (
            <a href={staffHandbookHref} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm">View staff handbook ↗</Button>
            </a>
          ) : (
            <Link to={staffHandbookHref}>
              <Button variant="ghost" size="sm">View staff handbook</Button>
            </Link>
          )
        }
      />

      {feedback ? (
        <div className={`handbook-editor-feedback handbook-editor-feedback-${feedback.tone}`}>
          {feedback.text}
        </div>
      ) : null}

      <div className="handbook-editor">
        {/* Left sidebar: section list */}
        <div className="handbook-editor-sidebar">
          <div className="handbook-editor-search">
            <Input
              label=""
              placeholder="Search sections…"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>

          <div className="handbook-editor-section-group">
            <span className="handbook-editor-section-group-label">Fixed sections</span>
            {filteredFixed.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`handbook-editor-section-item ${selected?.id === section.id ? 'is-selected' : ''}`}
                onClick={() => setSelected({ type: 'fixed', id: section.id as FixedSectionId })}
              >
                <span className="handbook-editor-section-item-title">{section.label}</span>
                <span className="handbook-editor-section-item-desc subtle small">{section.description}</span>
              </button>
            ))}
          </div>

          <div className="handbook-editor-section-group">
            <span className="handbook-editor-section-group-label">Custom sections ({filteredCms.length})</span>
            {filteredCms.map((section, index) => (
              <div
                key={section.id}
                className={`handbook-editor-section-item ${selected?.id === section.id ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelected({ type: 'cms', id: section.id })}
                onKeyDown={(event) => { if (event.key === 'Enter') setSelected({ type: 'cms', id: section.id }); }}
              >
                <span className="handbook-editor-section-item-title">{section.title}</span>
                <div className="handbook-editor-section-item-meta">
                  <StatusChip status={section.status} />
                  <div className="handbook-editor-section-item-controls">
                    <button
                      type="button"
                      className="handbook-editor-section-move"
                      disabled={index === 0}
                      title="Move up"
                      onClick={(event) => { event.stopPropagation(); moveSection(section.id, 'up'); }}
                    >↑</button>
                    <button
                      type="button"
                      className="handbook-editor-section-move"
                      disabled={index === filteredCms.length - 1}
                      title="Move down"
                      onClick={(event) => { event.stopPropagation(); moveSection(section.id, 'down'); }}
                    >↓</button>
                  </div>
                </div>
              </div>
            ))}
            {filteredCms.length === 0 && !search ? (
              <p className="subtle small" style={{ padding: '8px 12px' }}>
                No custom sections yet.
              </p>
            ) : null}
            <div className="handbook-editor-add-section">
              <Button type="button" variant="secondary" size="sm" onClick={addCmsSection}>
                + Add section
              </Button>
            </div>
          </div>
        </div>

        {/* Right panel: editor */}
        <div className="handbook-editor-panel">
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Staff-facing reading view
 * ------------------------------------------------------------------------ */

const iconBySection: Record<string, JSX.Element> = {
  'org-chart': <IconUsers size={20} />,
  guidelines: <IconHandbook size={20} />,
  onboarding: <IconHandbook size={20} />,
  maintenance: <IconHandbook size={20} />
};

export function HandbookIndexPage() {
  const settings = useAsync<{ handbookContent?: Record<string, unknown> }>(() => api('/api/settings'), []);
  const handbook = resolveHandbookContent(settings.data?.handbookContent ?? DEFAULT_HANDBOOK_CONTENT);
  const readySections = handbook.handbookSections.filter((section) => section.status === 'ready');
  const topLevelCount = handbook.orgMembers.filter((m) => m.reportsTo === null).length;
  const publishedCmsSections = handbook.cmsSections.filter((s) => s.status === 'PUBLISHED');

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
                      <Badge tone="positive" dot>Ready</Badge>
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

      {publishedCmsSections.length > 0 ? (
        <div className="page-stack">
          <h2 className="section-heading">Policies &amp; guidance</h2>
          {publishedCmsSections.map((section) => (
            <Card key={section.id} title={section.title} subtitle={section.subtitle}>
              {section.body ? (
                <div className="handbook-section-body">
                  {section.body.split('\n\n').map((paragraph, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
              {section.publishedAt ? (
                <p className="subtle small" style={{ marginTop: 12 }}>
                  Last updated {formatDate(section.publishedAt)}
                  {section.audience !== 'all' ? ` · ${AUDIENCE_LABELS[section.audience]}` : ''}
                  {section.venue !== 'all' ? ` · ${VENUE_LABELS[section.venue]}` : ''}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

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

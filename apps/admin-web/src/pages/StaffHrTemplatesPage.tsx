import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Textarea } from '@alma/ui';
import type {
  StaffHrDocumentTemplate,
  StaffHrDocumentTemplateOptionalClause,
  StaffHrDocumentTemplatePreview,
  StaffHrDocumentTemplateStatus,
  StaffHrRecordType
} from '@alma/shared';
import { api } from '../../../web/src/lib/api';

const TEMPLATE_STATUSES: StaffHrDocumentTemplateStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const TEMPLATE_TYPES: StaffHrRecordType[] = ['CONTRACT', 'WARNING', 'PAY_CHANGE', 'RIGHT_TO_WORK', 'GENERAL'];

const TEMPLATE_VARIABLES = [
  'dateOfLetter',
  'employeeFirstName',
  'employeeLastName',
  'employeeFullName',
  'employeeAddress',
  'employerName',
  'employerEntity',
  'positionTitle',
  'employmentType',
  'startDate',
  'awardName',
  'classification',
  'primaryLocation',
  'hourlyRate',
  'baseRate',
  'casualLoading',
  'payFrequency',
  'superannuationFund',
  'managerName',
  'employerSignatureName',
  'employerJobTitle',
  'additionalEntitlements',
  'companyProperty',
  'rightToDisconnectExamples',
  'additionalBenefits',
  'venueName',
  'venueAddress'
];

const PLACEHOLDER_CASUAL_CONTRACT_BODY = `Casual Employment Contract

Date: {{dateOfLetter}}

Employee: {{employeeFullName}}
Address: {{employeeAddress}}
Employer: {{employerEntity}}
Position: {{positionTitle}}
Primary location: {{primaryLocation}}
Employment type: {{employmentType}}
Start date: {{startDate}}

Important: This draft is a structure placeholder only. Review legal wording before issuing.

1. Engagement
Insert contract clause here.

2. Duties and location
Insert contract clause here.

3. Hours, rate, and pay
Insert contract clause here. Use {{hourlyRate}}, {{baseRate}}, {{casualLoading}}, and {{payFrequency}} where approved.

4. Award and classification
Insert contract clause here. Confirm {{awardName}} and {{classification}} before issue.

5. Superannuation
Insert contract clause here. Confirm {{superannuationFund}} before issue.

6. Policies, conduct, and confidentiality
Insert contract clause here.

7. Ending employment
Insert contract clause here.

Employer signatory: {{employerSignatureName}}, {{employerJobTitle}}
Manager: {{managerName}}`;

const DEFAULT_OPTIONAL_CLAUSES: StaffHrDocumentTemplateOptionalClause[] = [
  {
    key: 'employmentOptionWithStartDate',
    label: 'Employment option with start date',
    body: 'Insert optional clause here. Review legal wording before issuing.',
    enabledByDefault: true
  },
  {
    key: 'employmentOptionWithoutFixedStartDate',
    label: 'Employment option without fixed start date',
    body: 'Insert optional clause here. Review legal wording before issuing.',
    enabledByDefault: false
  },
  {
    key: 'additionalEntitlements',
    label: 'Additional entitlements',
    body: 'Insert optional clause here. Use {{additionalEntitlements}} only after approval.',
    enabledByDefault: false
  },
  {
    key: 'companyProperty',
    label: 'Company property',
    body: 'Insert optional clause here. Use {{companyProperty}} only after approval.',
    enabledByDefault: false
  },
  {
    key: 'rightToDisconnectExtraBenefits',
    label: 'Right to disconnect / extra benefits',
    body: 'Insert optional clause here. Use {{rightToDisconnectExamples}} and {{additionalBenefits}} only after approval.',
    enabledByDefault: false
  }
];

type TemplateForm = {
  id: string | null;
  name: string;
  recordType: StaffHrRecordType;
  status: StaffHrDocumentTemplateStatus;
  body: string;
  variablesText: string;
  optionalClauses: StaffHrDocumentTemplateOptionalClause[];
};

function placeholderForm(): TemplateForm {
  return {
    id: null,
    name: 'Casual Employment Contract',
    recordType: 'CONTRACT',
    status: 'DRAFT',
    body: PLACEHOLDER_CASUAL_CONTRACT_BODY,
    variablesText: TEMPLATE_VARIABLES.join('\n'),
    optionalClauses: DEFAULT_OPTIONAL_CLAUSES
  };
}

function templateToForm(template: StaffHrDocumentTemplate): TemplateForm {
  return {
    id: template.id,
    name: template.name,
    recordType: template.recordType,
    status: template.status,
    body: template.body,
    variablesText: template.variables.join('\n'),
    optionalClauses: template.optionalClauses
  };
}

function variablesFromText(value: string) {
  return Array.from(new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean)));
}

function statusTone(status: StaffHrDocumentTemplateStatus): 'positive' | 'warning' | 'muted' {
  if (status === 'ACTIVE') return 'positive';
  if (status === 'DRAFT') return 'warning';
  return 'muted';
}

export function StaffHrTemplatesPage() {
  const [templates, setTemplates] = useState<StaffHrDocumentTemplate[]>([]);
  const [form, setForm] = useState<TemplateForm>(placeholderForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<StaffHrDocumentTemplatePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTemplates() {
    setLoading(true);
    setError(null);
    try {
      const nextTemplates = await api<StaffHrDocumentTemplate[]>('/api/staff/hr/templates');
      setTemplates(nextTemplates);
      if (nextTemplates[0]) setForm(templateToForm(nextTemplates[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load HR templates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  const variables = useMemo(() => variablesFromText(form.variablesText), [form.variablesText]);

  function updateForm<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setMessage(null);
    setError(null);
  }

  function updateClause(index: number, patch: Partial<StaffHrDocumentTemplateOptionalClause>) {
    setForm((current) => ({
      ...current,
      optionalClauses: current.optionalClauses.map((clause, clauseIndex) => (clauseIndex === index ? { ...clause, ...patch } : clause))
    }));
    setPreview(null);
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload = {
        name: form.name,
        recordType: form.recordType,
        status: form.status,
        body: form.body,
        variables,
        optionalClauses: form.optionalClauses
      };
      const saved = form.id
        ? await api<StaffHrDocumentTemplate>(`/api/staff/hr/templates/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<StaffHrDocumentTemplate>('/api/staff/hr/templates', { method: 'POST', body: JSON.stringify(payload) });
      setForm(templateToForm(saved));
      setMessage('HR template saved.');
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save HR template.');
    } finally {
      setSaving(false);
    }
  }

  async function previewTemplate() {
    if (!form.id) {
      setError('Save the template before using the API preview.');
      return;
    }
    setPreviewing(true);
    setError(null);
    setMessage(null);
    try {
      setPreview(await api<StaffHrDocumentTemplatePreview>(`/api/staff/hr/templates/${form.id}/preview`, {
        method: 'POST',
        body: JSON.stringify({ sampleData: {} })
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview HR template.');
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Restricted HR setup"
        title="HR document templates"
        description="Create editable HR document templates for contracts, warnings, pay letters, right-to-work requests and general HR letters."
      />

      <Card title="Legal review required" subtitle="Alma stores template structure. It does not replace legal review.">
        <p className="subtle">
          Templates must be reviewed before issuing. Do not use draft wording as a final employment contract. Upload the signed final document to the staff HR record after issue.
        </p>
      </Card>

      <div className="split-grid">
        <Card title="Templates" subtitle="Admin-only template register. Venue iPads and ordinary staff cannot access this setup page.">
          {loading ? <Spinner label="Loading HR templates..." /> : null}
          {!loading && templates.length === 0 ? (
            <EmptyState title="No saved templates yet" description="Start with the safe Casual Employment Contract placeholder, then save it as an editable draft." />
          ) : null}
          <div className="page-stack compact">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`record-button ${form.id === template.id ? 'active' : ''}`}
                onClick={() => setForm(templateToForm(template))}
              >
                <strong>{template.name}</strong>
                <span>{template.recordType.replaceAll('_', ' ')}</span>
                <Badge tone={statusTone(template.status)}>{template.status}</Badge>
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <Button type="button" variant="secondary" onClick={() => setForm(placeholderForm())}>Use placeholder</Button>
          </div>
        </Card>

        <Card title={form.id ? 'Edit template' : 'New template'} subtitle="Use placeholder clauses until Alma-approved wording is provided.">
          <form className="page-stack compact" onSubmit={saveTemplate}>
            <div className="form-grid two">
              <Input label="Template name" value={form.name} onChange={(event) => updateForm('name', event.currentTarget.value)} />
              <Select
                label="Document type"
                value={form.recordType}
                onChange={(event) => updateForm('recordType', event.currentTarget.value as StaffHrRecordType)}
                options={TEMPLATE_TYPES.map((type) => ({ label: type.replaceAll('_', ' '), value: type }))}
              />
              <Select
                label="Status"
                value={form.status}
                onChange={(event) => updateForm('status', event.currentTarget.value as StaffHrDocumentTemplateStatus)}
                options={TEMPLATE_STATUSES.map((status) => ({ label: status, value: status }))}
              />
            </div>
            <Textarea label="Template body" rows={18} value={form.body} onChange={(event) => updateForm('body', event.currentTarget.value)} />
            <Textarea label="Variables" rows={6} value={form.variablesText} onChange={(event) => updateForm('variablesText', event.currentTarget.value)} />

            <div className="page-stack compact">
              <strong>Optional clauses</strong>
              {form.optionalClauses.map((clause, index) => (
                <div key={clause.key} className="settings-panel">
                  <label className="inline-checkbox">
                    <input
                      type="checkbox"
                      checked={clause.enabledByDefault}
                      onChange={(event) => updateClause(index, { enabledByDefault: event.currentTarget.checked })}
                    />
                    <span>{clause.label}</span>
                  </label>
                  <Textarea
                    label="Clause placeholder"
                    rows={3}
                    value={clause.body}
                    onChange={(event) => updateClause(index, { body: event.currentTarget.value })}
                  />
                </div>
              ))}
            </div>

            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : form.id ? 'Save template' : 'Save as draft'}</Button>
              <Button type="button" variant="secondary" disabled={previewing || !form.id} onClick={() => void previewTemplate()}>
                {previewing ? 'Previewing...' : 'Preview'}
              </Button>
            </div>
            {message ? <p className="success-text">{message}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
          </form>
        </Card>
      </div>

      <Card title="Supported variables" subtitle="Use double braces in template text, for example {{employeeFullName}}.">
        <div className="tag-list">
          {TEMPLATE_VARIABLES.map((variable) => <Badge key={variable} tone={variables.includes(variable) ? 'positive' : 'muted'}>{variable}</Badge>)}
        </div>
      </Card>

      <Card title="Preview" subtitle={form.id ? 'Preview uses sample data only.' : 'Save the template before API preview.'}>
        {preview ? (
          <div className="page-stack compact">
            {preview.unresolvedVariables.length ? (
              <p className="error-text">Unresolved variables: {preview.unresolvedVariables.join(', ')}</p>
            ) : null}
            <pre className="admin-preview-text">{preview.renderedBody}</pre>
          </div>
        ) : (
          <EmptyState title="No preview yet" description="Save the template, then preview it with sample data." />
        )}
      </Card>
    </div>
  );
}

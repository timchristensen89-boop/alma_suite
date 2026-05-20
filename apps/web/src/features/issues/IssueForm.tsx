import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  Issue,
  IssueAssigneeOption,
  IssueFormInput,
  IssueSeverity,
  IssueStatus
} from '@alma/shared';
import {
  ActionFeedback,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Textarea
} from '@alma/ui';
import { emptyIssueForm } from './defaults';
import {
  IconArrowLeft,
  IconInbox,
  IconPlus,
  IconTrash
} from '../../lib/icons';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return await readAsDataUrl(file);
  }

  const originalUrl = await readAsDataUrl(file);
  try {
    const image = await loadImage(originalUrl);
    let { width, height } = image;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return originalUrl;
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return originalUrl;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image'));
    image.src = src;
  });
}

const severities: IssueSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const statuses: IssueStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'RESOLVED',
  'CLOSED'
];

function assigneeValue(
  value: string | null | undefined,
  assignees: IssueAssigneeOption[]
) {
  if (!value) return '';
  const match = assignees.find((assignee) =>
    assignee.id === value ||
    assignee.name === value ||
    assignee.label === value ||
    assignee.email === value
  );
  return match?.id ?? value;
}

function assigneeOptions(
  value: string | null | undefined,
  assignees: IssueAssigneeOption[]
) {
  const selectedValue = assigneeValue(value, assignees);
  const options = [
    { label: 'Unassigned', value: '' },
    ...assignees.map((assignee) => ({
      label: assignee.label,
      value: assignee.id
    }))
  ];

  if (selectedValue && !options.some((option) => option.value === selectedValue)) {
    options.push({ label: value ?? selectedValue, value: selectedValue });
  }

  return options;
}

type Props = {
  initialValue?: Issue;
  mode: 'create' | 'edit';
  submitting: boolean;
  error?: string | null;
  assignees?: IssueAssigneeOption[];
  assigneesLoading?: boolean;
  assigneesError?: string | null;
  onSubmit: (value: IssueFormInput) => Promise<void>;
};

export function IssueForm({
  initialValue,
  mode,
  submitting,
  error,
  assignees = [],
  assigneesLoading = false,
  assigneesError,
  onSubmit
}: Props) {
  const [form, setForm] = useState<IssueFormInput>(() =>
    initialValue
      ? {
          title: initialValue.title,
          description: initialValue.description,
          severity: initialValue.severity,
          category: initialValue.category,
          status: initialValue.status,
          assignee: initialValue.assignee ?? '',
          dueDate: initialValue.dueDate ? initialValue.dueDate.slice(0, 10) : '',
          notes: initialValue.notes ?? '',
          resolutionNotes: initialValue.resolutionNotes ?? '',
          evidence: initialValue.evidence.map((item) => ({
            name: item.name,
            url: item.url,
            fileType: item.fileType ?? ''
          }))
        }
      : emptyIssueForm
  );
  const evidenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const canSubmit = useMemo(
    () => form.title.trim().length > 2 && form.category.trim().length > 0,
    [form]
  );

  function update<K extends keyof IssueFormInput>(key: K, value: IssueFormInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addEvidence() {
    update('evidence', [
      ...(form.evidence ?? []),
      { name: '', url: '', fileType: '' }
    ]);
  }

  function updateEvidence(
    index: number,
    key: 'name' | 'url' | 'fileType',
    value: string
  ) {
    update(
      'evidence',
      (form.evidence ?? []).map((item, currentIndex) =>
        currentIndex === index ? { ...item, [key]: value } : item
      )
    );
  }

  function removeEvidence(index: number) {
    update(
      'evidence',
      (form.evidence ?? []).filter((_, currentIndex) => currentIndex !== index)
    );
  }

  const evidence = form.evidence ?? [];

  async function addEvidenceFromFile(file: File) {
    setUploadingEvidence(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      update('evidence', [
        ...evidence,
        {
          name: file.name,
          url: dataUrl,
          fileType: file.type || ''
        }
      ]);
    } finally {
      setUploadingEvidence(false);
    }
  }

  return (
    <form
      className="page-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          ...form,
          evidence: evidence.filter((item) => item.name.trim() && item.url.trim())
        });
      }}
    >
      <PageHeader
        eyebrow={mode === 'create' ? 'New issue' : 'Edit issue'}
        title={mode === 'create' ? 'Log a new issue' : `Edit ${form.title || 'issue'}`}
        description="Track every hazard, defect, or follow-up so nothing gets lost on the floor."
        actions={
          <Link to="/issues">
            <Button variant="ghost" size="sm" leftIcon={<IconArrowLeft size={14} />}>
              Back to issues
            </Button>
          </Link>
        }
      />

      <Card title="Core details">
        <div className="form-grid two">
          <Input
            label="Title"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            required
          />
          <Input
            label="Category"
            value={form.category}
            onChange={(event) => update('category', event.target.value)}
            required
          />
          <Select
            label="Severity"
            value={form.severity}
            onChange={(event) => update('severity', event.target.value as IssueSeverity)}
            options={severities.map((value) => ({
              label: value.replace('_', ' '),
              value
            }))}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(event) => update('status', event.target.value as IssueStatus)}
            options={statuses.map((value) => ({
              label: value.replace('_', ' '),
              value
            }))}
          />
          <Select
            label="Assignee"
            value={assigneeValue(form.assignee, assignees)}
            onChange={(event) => update('assignee', event.target.value)}
            options={assigneeOptions(form.assignee, assignees)}
            disabled={assigneesLoading}
            hint={
              assigneesLoading
                ? 'Loading active staff...'
                : assigneesError
                  ? `Could not load staff: ${assigneesError}`
                  : 'Choose an active staff member.'
            }
          />
          <Input
            label="Due date"
            type="date"
            value={form.dueDate ?? ''}
            onChange={(event) => update('dueDate', event.target.value)}
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <Textarea
            label="Description"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            rows={5}
          />
        </div>
        <div className="form-grid two" style={{ marginTop: 16 }}>
          <Textarea
            label="Notes"
            value={form.notes ?? ''}
            onChange={(event) => update('notes', event.target.value)}
            rows={4}
          />
          <Textarea
            label="Resolution notes"
            value={form.resolutionNotes ?? ''}
            onChange={(event) => update('resolutionNotes', event.target.value)}
            rows={4}
          />
        </div>
      </Card>

      <Card
        title="Evidence"
        subtitle="Upload photos or documents straight into the issue record"
        action={
          <div className="inline-actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<IconPlus size={14} />}
              onClick={addEvidence}
            >
              Add blank row
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<IconPlus size={14} />}
              onClick={() => evidenceFileInputRef.current?.click()}
              disabled={uploadingEvidence}
            >
              {uploadingEvidence ? 'Uploading…' : 'Upload file'}
            </Button>
            <input
              ref={evidenceFileInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void addEvidenceFromFile(file);
                event.target.value = '';
              }}
            />
          </div>
        }
      >
        <div className="page-stack compact">
          {evidence.length === 0 ? (
            <EmptyState
              icon={<IconInbox size={22} />}
              title="No evidence attached yet"
              description="Upload a photo or document, or add a blank row if you need to paste a link."
            />
          ) : (
            evidence.map((item, index) => (
              <div key={index} className="evidence-row">
                <Input
                  label="Name"
                  value={item.name}
                  onChange={(event) => updateEvidence(index, 'name', event.target.value)}
                />
                <Input
                  label="URL or data"
                  value={item.url}
                  onChange={(event) => updateEvidence(index, 'url', event.target.value)}
                />
                <Input
                  label="Type"
                  value={item.fileType ?? ''}
                  onChange={(event) => updateEvidence(index, 'fileType', event.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<IconTrash size={14} />}
                  onClick={() => removeEvidence(index)}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      <div className="toolbar-right">
        <Link to="/issues">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitting
            ? 'Saving…'
            : mode === 'create'
              ? 'Create issue'
              : 'Save changes'}
        </Button>
        <ActionFeedback message={error} tone="error" />
      </div>
    </form>
  );
}

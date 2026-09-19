// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useState } from 'react';
import type { StaffProfile, StaffTrainingRecord, TrainingOverview } from '@alma/shared';
import {
  ActionFeedback,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  Textarea
} from '@alma/ui';
import { api } from '../lib/api';
import { formatCents } from '../lib/datetime';
import { staffForPicker, ShowTerminatedStaffToggle, sortStaffForSelect } from './shared';

type TrainingModuleDraft = {
  title: string;
  category: string;
  level: string;
  estimatedMinutes: string;
  description: string;
};

type TrainingPayRuleDraft = {
  level: string;
  label: string;
  payRate: string;
  notes: string;
};

export function TrainingPage({ staff, reloadStaff }: { staff: StaffProfile[]; reloadStaff: () => Promise<void> }) {
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [moduleDraft, setModuleDraft] = useState<TrainingModuleDraft>({
    title: '',
    category: 'Venue standards',
    level: '1',
    estimatedMinutes: '30',
    description: ''
  });
  const [ruleDraft, setRuleDraft] = useState<TrainingPayRuleDraft>({
    level: '1',
    label: 'Level 1 trained',
    payRate: '',
    notes: ''
  });
  const [selectedStaffId, setSelectedStaffId] = useState(staff[0]?.id ?? '');
  const [showTerminatedStaff, setShowTerminatedStaff] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState('');

  const modules = overview?.modules ?? [];
  const records = overview?.records ?? [];
  const payRules = overview?.payRules ?? [];
  const completedRecords = records.filter((record) => record.status === 'COMPLETED');
  const assignedRecords = records.filter((record) => record.status !== 'COMPLETED');
  const highestLevel = Math.max(0, ...staff.map((member) => member.trainingLevel ?? 0));

  const staffOptions = [
    { label: 'Select staff', value: '' },
    ...sortStaffForSelect(staffForPicker(staff, showTerminatedStaff, selectedStaffId)).map((member) => ({
      label: `${member.firstName} ${member.lastName}`,
      value: member.id
    }))
  ];
  const moduleOptions = [
    { label: 'Select module', value: '' },
    ...modules
      .filter((module) => module.status === 'ACTIVE')
      .map((module) => ({
        label: `L${module.level} · ${module.title}`,
        value: module.id
      }))
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setOverview(await api<TrainingOverview>('/api/training/overview'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load training');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedStaffId && staff[0]) setSelectedStaffId(staff[0].id);
  }, [selectedStaffId, staff]);

  useEffect(() => {
    if (!selectedModuleId && modules[0]) setSelectedModuleId(modules[0].id);
  }, [modules, selectedModuleId]);

  function updateModuleDraft<K extends keyof TrainingModuleDraft>(key: K, value: TrainingModuleDraft[K]) {
    setModuleDraft((current) => ({ ...current, [key]: value }));
  }

  function updateRuleDraft<K extends keyof TrainingPayRuleDraft>(key: K, value: TrainingPayRuleDraft[K]) {
    setRuleDraft((current) => ({ ...current, [key]: value }));
  }

  async function createModule() {
    setMessageTarget('module');
    if (!moduleDraft.title.trim()) {
      setMessage('Module title is required.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/modules', {
        method: 'POST',
        body: JSON.stringify({
          title: moduleDraft.title.trim(),
          category: moduleDraft.category.trim(),
          level: Number(moduleDraft.level) || 1,
          estimatedMinutes: Number(moduleDraft.estimatedMinutes) || undefined,
          description: moduleDraft.description.trim(),
          status: 'ACTIVE'
        })
      });
      setModuleDraft({ title: '', category: moduleDraft.category, level: moduleDraft.level, estimatedMinutes: '30', description: '' });
      setMessage('Training module created.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create module.');
    } finally {
      setSaving(false);
    }
  }

  async function savePayRule() {
    setMessageTarget('pay-rule');
    const payRate = Number(ruleDraft.payRate.replace(/[^0-9.]/g, ''));
    if (!ruleDraft.label.trim() || !Number.isFinite(payRate)) {
      setMessage('Pay rule needs a label and pay rate.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/pay-rules', {
        method: 'POST',
        body: JSON.stringify({
          level: Number(ruleDraft.level) || 1,
          label: ruleDraft.label.trim(),
          payRateCents: Math.round(payRate * 100),
          notes: ruleDraft.notes.trim()
        })
      });
      setMessage('Academy pay rule saved.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save pay rule.');
    } finally {
      setSaving(false);
    }
  }

  async function assignTraining() {
    setMessageTarget('assign');
    if (!selectedStaffId || !selectedModuleId) {
      setMessage('Choose staff and a module before assigning Academy training.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/assignments', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: selectedStaffId,
          moduleId: selectedModuleId,
          notes: 'Assigned from Alma Academy board.'
        })
      });
      setMessage('Academy module assigned.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not assign training.');
    } finally {
      setSaving(false);
    }
  }

  async function updateTrainingRecord(record: StaffTrainingRecord, status: StaffTrainingRecord['status']) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:${status}`);
    try {
      await api(`/api/training/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString() : '',
          notes: record.notes ?? ''
        })
      });
      setMessage(status === 'COMPLETED' ? 'Academy module completed and pay level recalculated.' : 'Academy record updated.');
      await Promise.all([load(), reloadStaff()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update training.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ALMA Academy"
        title="Academy levels tied to staff pay"
        description="Assign modules to staff profiles, complete Academy training, and automatically lift pay rates when a completed level has a pay rule."
      />

      <div className="stats-grid">
        <StatCard label="Modules" value={modules.length} hint="Academy catalogue" loading={loading} />
        <StatCard label="Assigned" value={assignedRecords.length} hint="Open Academy" loading={loading} />
        <StatCard label="Completed" value={completedRecords.length} hint="Finished modules" loading={loading} />
        <StatCard label="Top level" value={highestLevel} hint="Highest staff level" loading={loading} />
      </div>

      <div className="staff-board">
        <Card title="Create Academy module" subtitle="Keep these short and practical. Levels drive pay uplift rules.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createModule();
            }}
          >
            <Input label="Module title" required value={moduleDraft.title} onChange={(event) => updateModuleDraft('title', event.currentTarget.value)} />
            <datalist id="academy-categories">
              {Array.from(new Set(modules.map((module) => module.category).filter((c): c is string => Boolean(c)))).map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <div className="form-grid three">
              <Input label="Category" list="academy-categories" value={moduleDraft.category} onChange={(event) => updateModuleDraft('category', event.currentTarget.value)} />
              <Input label="Level" type="number" min="1" value={moduleDraft.level} onChange={(event) => updateModuleDraft('level', event.currentTarget.value)} />
              <Input label="Minutes" type="number" min="1" value={moduleDraft.estimatedMinutes} onChange={(event) => updateModuleDraft('estimatedMinutes', event.currentTarget.value)} />
            </div>
            <Textarea label="Description" rows={2} value={moduleDraft.description} onChange={(event) => updateModuleDraft('description', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Academy module'}</Button>
              <ActionFeedback
                message={messageTarget === 'module' ? message : null}
                tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
              />
            </div>
          </form>
        </Card>

        <Card title="Pay rules" subtitle="When a staff member completes this level, their pay rate lifts to this amount if it is higher.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void savePayRule();
            }}
          >
            <div className="form-grid three">
              <Input label="Level" type="number" min="1" value={ruleDraft.level} onChange={(event) => updateRuleDraft('level', event.currentTarget.value)} />
              <Input label="Label" value={ruleDraft.label} onChange={(event) => updateRuleDraft('label', event.currentTarget.value)} />
              <Input label="Pay rate" value={ruleDraft.payRate} onChange={(event) => updateRuleDraft('payRate', event.currentTarget.value)} placeholder="Example: 32.50" />
            </div>
            <Textarea label="Notes" rows={2} value={ruleDraft.notes} onChange={(event) => updateRuleDraft('notes', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save pay rule'}</Button>
              <ActionFeedback
                message={messageTarget === 'pay-rule' ? message : null}
                tone={message?.includes('Could') || message?.includes('needs') ? 'error' : 'success'}
              />
            </div>
          </form>
          <div className="app-access-grid">
            {payRules.map((rule) => (
              <div key={rule.id} className="app-access-tile">
                <strong>Level {rule.level}</strong>
                <span className="subtle">{rule.label}</span>
                <Badge tone="positive">{formatCents(rule.payRateCents)}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Assign Academy module" subtitle="Link a module directly to a staff profile.">
        <div className="form-grid three">
          <div className="staff-picker">
            <Select label="Staff" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.currentTarget.value)} options={staffOptions} />
            <ShowTerminatedStaffToggle staff={staff} checked={showTerminatedStaff} onChange={setShowTerminatedStaff} />
          </div>
          <Select label="Module" value={selectedModuleId} onChange={(event) => setSelectedModuleId(event.currentTarget.value)} options={moduleOptions} />
          <div className="field-action">
            <Button type="button" disabled={saving || modules.length === 0} onClick={() => void assignTraining()}>
              Assign module
            </Button>
            <ActionFeedback
              message={messageTarget === 'assign' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
          </div>
        </div>
        {message && !messageTarget ? <p className={message.includes('Could') || message.includes('required') ? 'error-text' : 'subtle'}>{message}</p> : null}
      </Card>

      <Card title="Academy board" subtitle="Complete modules here. Completed levels update StaffProfile training level and pay.">
        {loading ? <Spinner label="Loading Academy…" /> : null}
        {!loading && records.length === 0 ? (
          <EmptyState title="No Academy modules assigned" description="Create a module, add a pay rule, then assign Academy modules to staff." />
        ) : null}
        <div className="staff-list">
          {records.map((record) => (
            <div key={record.id} className="staff-expiry-row">
              <span>
                <strong>
                  {record.staffProfile?.firstName} {record.staffProfile?.lastName}
                </strong>
                <span className="subtle">
                  L{record.module?.level} · {record.module?.title} · {record.staffProfile?.venue || 'No venue'}
                </span>
                <span className="subtle">
                  Staff pay {formatCents(record.staffProfile?.payRateCents ?? null)} · Academy level {record.staffProfile?.trainingLevel ?? 0}
                </span>
              </span>
              <span className="invite-row-actions">
                <Badge tone={record.status === 'COMPLETED' ? 'positive' : record.status === 'EXPIRED' ? 'danger' : 'warning'}>{record.status}</Badge>
                {record.status !== 'COMPLETED' ? (
                  <>
                    <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void updateTrainingRecord(record, 'IN_PROGRESS')}>
                      Start
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `record:${record.id}:IN_PROGRESS` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                    <Button type="button" size="sm" disabled={saving} onClick={() => void updateTrainingRecord(record, 'COMPLETED')}>
                      Complete
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `record:${record.id}:COMPLETED` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

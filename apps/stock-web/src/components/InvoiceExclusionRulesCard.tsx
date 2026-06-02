import { useCallback, useEffect, useState } from 'react';
import type {
  InvoiceExclusionCondition,
  InvoiceExclusionField,
  InvoiceExclusionRule
} from '@alma/shared';
import { Button, CollapsibleCard, EmptyState, Input, Select, Spinner } from '@alma/ui';
import { api } from '../lib/api';

const FIELD_OPTIONS: Array<{ value: InvoiceExclusionField; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'body', label: 'Body' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'invoiceNumber', label: 'Invoice number' }
];

const FIELD_LABEL: Record<InvoiceExclusionField, string> = {
  title: 'Title',
  body: 'Body',
  supplier: 'Supplier',
  invoiceNumber: 'Invoice number'
};

function describeRule(rule: InvoiceExclusionRule): string {
  return rule.conditions
    .map((c) => `${FIELD_LABEL[c.field]} contains "${c.value}"`)
    .join(' AND ');
}

type DraftCondition = { field: InvoiceExclusionField; value: string };

export function InvoiceExclusionRulesCard({ canManage }: { canManage: boolean }) {
  const [rules, setRules] = useState<InvoiceExclusionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [conditions, setConditions] = useState<DraftCondition[]>([{ field: 'title', value: '' }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRules(await api<InvoiceExclusionRule[]>('/api/invoices/exclusion-rules'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load exclusion rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addCondition = () =>
    setConditions((current) => [...current, { field: 'body', value: '' }]);
  const removeCondition = (index: number) =>
    setConditions((current) => current.filter((_, i) => i !== index));
  const updateCondition = (index: number, patch: Partial<DraftCondition>) =>
    setConditions((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const resetDraft = () => {
    setName('');
    setConditions([{ field: 'title', value: '' }]);
  };

  const createRule = async () => {
    const cleaned: InvoiceExclusionCondition[] = conditions
      .map((c) => ({ field: c.field, value: c.value.trim() }))
      .filter((c) => c.value.length > 0);
    if (!name.trim()) {
      setError('Give the rule a name.');
      return;
    }
    if (cleaned.length === 0) {
      setError('Add at least one condition with a value.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/invoices/exclusion-rules', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), enabled: true, conditions: cleaned })
      });
      resetDraft();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule.');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (rule: InvoiceExclusionRule) => {
    setBusy(true);
    try {
      await api(`/api/invoices/exclusion-rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: rule.name,
          enabled: !rule.enabled,
          conditions: rule.conditions
        })
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the rule.');
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (rule: InvoiceExclusionRule) => {
    if (!window.confirm(`Delete the "${rule.name}" exclusion rule?`)) return;
    setBusy(true);
    try {
      await api(`/api/invoices/exclusion-rules/${rule.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the rule.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleCard
      title="Invoice exclusion rules"
      description="Skip non-supplier documents on import — e.g. Square sales payouts. All conditions in a rule must match; any matching rule excludes the document."
      badge={loading ? 'Loading' : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}
    >
      {error ? <p className="error-text">{error}</p> : null}

      {loading ? (
        <Spinner label="Loading exclusion rules" />
      ) : rules.length === 0 ? (
        <EmptyState
          title="No exclusion rules yet"
          description='Add a rule like: Title contains "Square" AND Body contains "Sales".'
        />
      ) : (
        <div className="settings-category-stack">
          {rules.map((rule) => (
            <div key={rule.id} className="settings-category-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{rule.name}</strong>
                <p className="subtle" style={{ margin: '2px 0 0' }}>
                  {describeRule(rule)}
                </p>
              </div>
              {canManage ? (
                <>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void toggleEnabled(rule)}>
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteRule(rule)}>
                    Delete
                  </Button>
                </>
              ) : (
                <span className="settings-category-count">{rule.enabled ? 'Enabled' : 'Disabled'}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="settings-category-stack" style={{ marginTop: 16 }}>
          <Input
            id="new-exclusion-rule-name"
            label="New rule name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder='e.g. Square sales payouts'
          />
          {conditions.map((condition, index) => (
            <div key={index} className="settings-category-row" style={{ alignItems: 'flex-end' }}>
              <Select
                id={`exclusion-field-${index}`}
                label={index === 0 ? 'Field' : 'AND field'}
                value={condition.field}
                onChange={(e) => updateCondition(index, { field: e.currentTarget.value as InvoiceExclusionField })}
                options={FIELD_OPTIONS}
              />
              <Input
                id={`exclusion-value-${index}`}
                label="Contains"
                value={condition.value}
                onChange={(e) => updateCondition(index, { value: e.currentTarget.value })}
                placeholder="text to match"
              />
              {conditions.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeCondition(index)}>
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <div className="settings-category-row" style={{ justifyContent: 'space-between' }}>
            <Button type="button" variant="ghost" size="sm" onClick={addCondition}>
              + Add condition
            </Button>
            <Button type="button" disabled={busy} onClick={() => void createRule()}>
              {busy ? 'Saving…' : 'Add rule'}
            </Button>
          </div>
        </div>
      ) : null}
    </CollapsibleCard>
  );
}

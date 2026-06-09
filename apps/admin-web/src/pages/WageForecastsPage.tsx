import { useEffect, useMemo, useState } from 'react';
import type { AppSettingsPayload } from '@alma/shared';
import { ActionFeedback, Button, Card, EmptyState, Input, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

type VenueForecast = {
  name: string;
  address?: string;
  phone?: string;
  weeklyForecastSalesCents?: number;
  targetWagePercent?: number;
  targetPrimeCostPercent?: number;
};

type DraftRow = {
  weeklyForecastInput: string;
  targetWagePercentInput: string;
  targetPrimeCostPercentInput: string;
};

function formatMoney(cents: number | undefined) {
  if (cents == null || !Number.isFinite(cents)) return '';
  return (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function parsePercent(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export function WageForecastsPage() {
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [superInput, setSuperInput] = useState('12');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const next = await api<AppSettingsPayload>('/api/settings');
        setSettings(next);
        setSuperInput(next.superGuaranteePercent != null ? String(next.superGuaranteePercent) : '12');
        const initial: Record<string, DraftRow> = {};
        for (const venue of next.venues as VenueForecast[]) {
          initial[venue.name] = {
            weeklyForecastInput: formatMoney(venue.weeklyForecastSalesCents),
            targetWagePercentInput: venue.targetWagePercent != null ? String(venue.targetWagePercent) : '32',
            targetPrimeCostPercentInput: venue.targetPrimeCostPercent != null ? String(venue.targetPrimeCostPercent) : ''
          };
        }
        setDraft(initial);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not load settings');
        setTone('error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const venues = useMemo(() => (settings?.venues ?? []) as VenueForecast[], [settings]);

  async function saveAll() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const updatedVenues = venues.map((venue) => {
        const row = draft[venue.name];
        const cents = row ? parseMoneyToCents(row.weeklyForecastInput) : null;
        const pct = row ? parsePercent(row.targetWagePercentInput) : null;
        const primePct = row ? parsePercent(row.targetPrimeCostPercentInput) : null;
        return {
          name: venue.name,
          address: venue.address ?? '',
          phone: venue.phone ?? '',
          ...(cents != null ? { weeklyForecastSalesCents: cents } : {}),
          ...(pct != null ? { targetWagePercent: pct } : {}),
          ...(primePct != null ? { targetPrimeCostPercent: primePct } : {})
        };
      });
      const superPct = parsePercent(superInput);
      const next = await api<AppSettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          venues: updatedVenues,
          ...(superPct != null ? { superGuaranteePercent: superPct } : {})
        })
      });
      setSettings(next);
      setMessage('Wage forecasts saved. Reports will use these values immediately.');
      setTone('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save wage forecasts');
      setTone('error');
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(name: string, patch: Partial<DraftRow>) {
    setDraft((current) => ({
      ...current,
      [name]: { ...(current[name] ?? { weeklyForecastInput: '', targetWagePercentInput: '32', targetPrimeCostPercentInput: '' }), ...patch }
    }));
  }

  if (loading) {
    return (
      <Card title="Wage forecasts" subtitle="Weekly sales forecast and target wage % per venue. These feed the Reports app's wage budget, variance, and roster planning.">
        <Spinner label="Loading settings..." />
      </Card>
    );
  }

  return (
    <div className="admin-page-stack">
      <Card
        title="Wage forecasts"
        subtitle="Weekly sales forecast and target wage % per venue. These feed the Reports app's wage budget, variance, and roster planning. Leave a field blank to keep its current value; enter 0 to clear it."
        action={<Button type="button" onClick={() => void saveAll()} disabled={saving}>{saving ? 'Saving...' : 'Save all'}</Button>}
      >
        {venues.length === 0 ? (
          <EmptyState
            title="No venues configured"
            description="Add venues in the Settings → Venues area before setting wage forecasts."
          />
        ) : (
          <div className="wage-forecasts-grid">
            {venues.map((venue) => {
              const row = draft[venue.name] ?? { weeklyForecastInput: '', targetWagePercentInput: '32', targetPrimeCostPercentInput: '' };
              const previewCents = parseMoneyToCents(row.weeklyForecastInput);
              const previewPct = parsePercent(row.targetWagePercentInput);
              const previewBudgetCents =
                previewCents != null && previewPct != null
                  ? Math.round(previewCents * (previewPct / 100))
                  : null;
              const previewPrimePct = parsePercent(row.targetPrimeCostPercentInput);
              const previewPrimeCents =
                previewCents != null && previewPrimePct != null
                  ? Math.round(previewCents * (previewPrimePct / 100))
                  : null;
              return (
                <div key={venue.name} className="wage-forecast-row">
                  <div className="wage-forecast-row-head">
                    <strong>{venue.name}</strong>
                    {previewBudgetCents != null ? (
                      <span className="subtle">
                        Wage budget ≈ <strong>${formatMoney(previewBudgetCents)}</strong> per week
                      </span>
                    ) : (
                      <span className="subtle">Enter forecast and target to preview the wage budget</span>
                    )}
                  </div>
                  <div className="form-grid two">
                    <Input
                      label="Weekly sales forecast"
                      value={row.weeklyForecastInput}
                      onChange={(event) => updateDraft(venue.name, { weeklyForecastInput: event.currentTarget.value })}
                      placeholder="e.g. 85000"
                      type="text"
                      inputMode="decimal"
                    />
                    <div>
                      <Input
                        label="Target wage %"
                        value={row.targetWagePercentInput}
                        onChange={(event) => updateDraft(venue.name, { targetWagePercentInput: event.currentTarget.value })}
                        placeholder="32%"
                        type="text"
                        inputMode="decimal"
                      />
                      <span className="subtle">Default: 32% (adjust per venue based on historical actuals)</span>
                    </div>
                  </div>
                  <div className="form-grid two" style={{ marginTop: 8 }}>
                    <div>
                      <Input
                        label="Target prime cost %"
                        value={row.targetPrimeCostPercentInput}
                        onChange={(event) => updateDraft(venue.name, { targetPrimeCostPercentInput: event.currentTarget.value })}
                        placeholder="e.g. 60"
                        type="text"
                        inputMode="decimal"
                      />
                      <span className="subtle">
                        Wages + COGS target as a % of sales. Reports flags variance against this.
                        {previewPrimeCents != null ? <> Target ≈ <strong>${formatMoney(previewPrimeCents)}</strong>/wk.</> : null}
                      </span>
                    </div>
                    <div />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ActionFeedback message={message} tone={tone} />
      </Card>

      <Card
        title="Superannuation guarantee"
        subtitle="The employer super rate baked into every costed hour across Staff costing and Prime cost. A single national rate that steps up over time — update it here when the legislated rate changes. Saved with 'Save all' above."
      >
        <div className="form-grid two">
          <div>
            <Input
              label="Super guarantee %"
              value={superInput}
              onChange={(event) => setSuperInput(event.currentTarget.value)}
              placeholder="12"
              type="text"
              inputMode="decimal"
            />
            <span className="subtle">Currently 12% (from 1 July 2025). Applies to all venues and future costing calculations.</span>
          </div>
          <div />
        </div>
      </Card>

      <Card title="How this is used" padding="tight">
        <p className="subtle" style={{ margin: 0 }}>
          The Reports app reads these per-venue values when calculating wage budgets, wage variance, and
          forecast-adjusted prime cost. The Roster (Staff app) also uses them when generating the weekly
          labour plan. Changes apply immediately — no deploy required.
        </p>
      </Card>
    </div>
  );
}

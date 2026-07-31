// Forecasting module UI.
//
// Separate sections rather than one giant page, per the brief. Two rules run
// through the whole surface:
//
//   1. Every number carries its provenance — actual, accounting estimate,
//      management assumption, model forecast, manual override or proposal
//      term. A figure with no label is a figure nobody should act on.
//   2. The entity selector is never "All". These are two Pty Ltds; the group
//      view is explicitly labelled a comparison and shows them side by side.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Spinner } from '@alma/ui';
import { staffApi } from '../lib/api';

type SectionKey =
  | 'overview'
  | 'sales'
  | 'margins'
  | 'cash-flow'
  | 'scenarios'
  | 'creditors'
  | 'imports'
  | 'data-quality'
  | 'model-performance'
  | 'settings';

const SECTIONS: Array<{ key: SectionKey; label: string; blurb: string }> = [
  { key: 'overview', label: 'Overview', blurb: 'Entity position at a glance.' },
  { key: 'sales', label: 'Sales', blurb: 'Forecast sales with confidence ranges.' },
  { key: 'margins', label: 'Margins', blurb: 'COGS, labour and prime cost.' },
  { key: 'cash-flow', label: 'Cash flow', blurb: 'Bank cash, GST reserve and headroom.' },
  { key: 'scenarios', label: 'Scenarios', blurb: 'Base, conservative and recovery.' },
  { key: 'creditors', label: 'Creditors', blurb: 'Proposal, cap and cents in the dollar.' },
  { key: 'imports', label: 'Imports', blurb: 'Templates, validation and error reports.' },
  { key: 'data-quality', label: 'Data quality', blurb: 'Blocking and warning issues.' },
  { key: 'model-performance', label: 'Model performance', blurb: 'Accuracy and champion models.' },
  { key: 'settings', label: 'Settings', blurb: 'Assumptions and provenance.' }
];

const PROVENANCE_TONE: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  ACTUAL: 'positive',
  ACCOUNTING_ESTIMATE: 'info',
  MANAGEMENT_ASSUMPTION: 'warning',
  MODEL_FORECAST: 'info',
  MANUAL_OVERRIDE: 'danger',
  PROPOSAL_TERM: 'neutral'
};

const PROVENANCE_LABEL: Record<string, string> = {
  ACTUAL: 'Actual',
  ACCOUNTING_ESTIMATE: 'Accounting estimate',
  MANAGEMENT_ASSUMPTION: 'Assumption',
  MODEL_FORECAST: 'Forecast',
  MANUAL_OVERRIDE: 'Override',
  PROPOSAL_TERM: 'Proposal term'
};

function money(cents: number | null | undefined, decimals = 0) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: decimals }).format(cents / 100);
}

function percent(value: number | null | undefined, decimals = 1) {
  return value === null || value === undefined ? '—' : `${value.toFixed(decimals)}%`;
}

/** A number with its provenance. Nothing is displayed without one. */
function Figure({ label, value, provenance, note }: { label: string; value: string; provenance: keyof typeof PROVENANCE_LABEL; note?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <Badge tone={PROVENANCE_TONE[provenance] ?? 'neutral'}>{PROVENANCE_LABEL[provenance] ?? provenance}</Badge>
      </div>
      <div className="stat-card-value">{value}</div>
      {note ? <div className="stat-card-hint">{note}</div> : null}
    </div>
  );
}

interface CompanyOption {
  id: string;
  code: string;
  legalName: string;
  tradingName: string;
  venues: Array<{ id: string; code: string; name: string }>;
}

export function ForecastModulePage() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [section, setSection] = useState<SectionKey>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [assumptions, setAssumptions] = useState<any>(null);

  const company = useMemo(() => companies.find((entry) => entry.id === companyId) ?? null, [companies, companyId]);

  useEffect(() => {
    let cancelled = false;
    staffApi<{ companies: CompanyOption[]; note: string }>('/api/forecast-module/companies')
      .then((data) => {
        if (cancelled) return;
        setCompanies(data.companies);
        setCompanyId((current) => current || data.companies[0]?.id || '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load companies.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const query = `?companyId=${encodeURIComponent(companyId)}`;
      const endpoint =
        section === 'creditors' ? `/api/forecast-module/creditors${query}`
        : section === 'cash-flow' ? `/api/forecast-module/cash-position${query}`
        : section === 'scenarios' ? `/api/forecast-module/operating${query}&years=3`
        : section === 'imports' ? '/api/forecast-module/import-templates'
        : section === 'data-quality' ? `/api/forecast-module/data-quality${query}`
        : section === 'model-performance' ? `/api/forecast-module/model-performance${query}`
        : section === 'settings' ? `/api/forecast-module/assumptions${query}`
        : `/api/forecast-module/operating${query}&years=3`;

      const [data, assumptionData] = await Promise.all([
        staffApi<Record<string, unknown>>(endpoint),
        staffApi<any>(`/api/forecast-module/assumptions${query}`).catch(() => null)
      ]);
      setPayload(data);
      setAssumptions(assumptionData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load this section.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, section]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && companies.length === 0) {
    return (
      <Card>
        <div className="forecast-loading">
          <Spinner /> Loading the forecasting module…
        </div>
      </Card>
    );
  }

  if (companies.length === 0) {
    return (
      <Card title="Forecasting module">
        <p className="subtle">
          No companies are configured yet. Seed the forecasting entities (Two Cooked Chooks Pty Ltd and Alma Freshwater
          Pty Ltd) before using this module.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
      </Card>
    );
  }

  const unconfirmed = assumptions?.unconfirmedCount ?? 0;

  return (
    <div className="page-stack fc-module">
      {/* Entity selector. Deliberately no "All venues" — these are two Pty Ltds. */}
      <Card
        title="Forecasting"
        subtitle="Each legal entity is modelled separately. Cash, creditors and liabilities are never combined."
        action={
          <div className="forecast-venue-tabs">
            {companies.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={companyId === entry.id ? 'is-active' : undefined}
                onClick={() => setCompanyId(entry.id)}
              >
                {entry.tradingName}
              </button>
            ))}
          </div>
        }
      >
        {company ? (
          <p className="subtle fc-entity-line">
            <strong>{company.legalName}</strong> · {company.code} · trading as {company.tradingName}
          </p>
        ) : null}

        {unconfirmed > 0 ? (
          // The API composes this from the actual counts and reasons, so the
          // wording stays true as figures are evidenced and confirmed.
          <p className="fc-warning">
            {assumptions?.warning ?? (
              <>
                <strong>{unconfirmed} assumptions are not yet evidenced.</strong> Treat them as management assumptions
                rather than demonstrated results.
              </>
            )}
          </p>
        ) : null}

        <div className="fc-nav">
          {SECTIONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`fc-nav-item${section === entry.key ? ' is-active' : ''}`}
              onClick={() => setSection(entry.key)}
            >
              <span className="fc-nav-label">{entry.label}</span>
              <span className="fc-nav-blurb">{entry.blurb}</span>
            </button>
          ))}
        </div>
      </Card>

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <div className="forecast-loading">
            <Spinner /> Loading…
          </div>
        </Card>
      ) : (
        <SectionBody section={section} payload={payload} assumptions={assumptions} onRefresh={() => void load()} />
      )}
    </div>
  );
}

function SectionBody({
  section,
  payload,
  assumptions,
  onRefresh
}: {
  section: SectionKey;
  payload: Record<string, unknown> | null;
  assumptions: any;
  onRefresh: () => void;
}) {
  if (!payload) return null;

  if (section === 'creditors') return <CreditorsSection data={payload as any} />;
  if (section === 'cash-flow') return <CashSection data={payload as any} />;
  if (section === 'imports') return <ImportsSection data={payload as any} />;
  if (section === 'data-quality') return <DataQualitySection data={payload as any} onRefresh={onRefresh} />;
  if (section === 'model-performance') return <ModelSection data={payload as any} />;
  if (section === 'settings') return <SettingsSection data={assumptions} />;
  return <OperatingSection data={payload as any} section={section} />;
}

function OperatingSection({ data, section }: { data: any; section: SectionKey }) {
  const scenarios: any[] = data?.scenarios ?? [];
  const base = scenarios.find((entry) => entry.scenarioKey === 'BASE') ?? scenarios[0];
  const firstYear = base?.years?.[0];

  if (!firstYear) {
    return (
      <Card title="No projection available">
        <p className="subtle">Assumptions are missing for this entity, so no forecast has been produced.</p>
      </Card>
    );
  }

  return (
    <div className="page-stack">
      <Card
        title={section === 'margins' ? 'Margins' : section === 'scenarios' ? 'Scenarios' : 'Operating forecast'}
        subtitle={data.note}
      >
        <div className="stat-grid">
          <Figure label="Net sales (ex GST)" value={money(firstYear.netSalesExGstCents)} provenance="MODEL_FORECAST" note="Year 1" />
          <Figure label="COGS" value={`${money(firstYear.cogsCents)} · ${percent(firstYear.cogsPercent)}`} provenance="MANAGEMENT_ASSUMPTION" note="Target percentage of sales" />
          <Figure label="Labour" value={`${money(firstYear.labourCents)} · ${percent(firstYear.labourPercent)}`} provenance="MANAGEMENT_ASSUMPTION" note="Gross wages plus super. PAYG is inside gross wages." />
          <Figure label="Prime cost" value={percent(firstYear.primeCostPercent)} provenance="MODEL_FORECAST" note="COGS plus labour" />
          <Figure label="Free cash before creditors" value={money(firstYear.freeCashCents)} provenance="MODEL_FORECAST" note="Year 1, before any creditor contribution" />
        </div>
      </Card>

      {scenarios.length > 1 ? (
        <Card title="Scenario comparison" subtitle="Each scenario is derived from the base assumptions; the base is never modified.">
          <div className="table-scroll">
            <table className="forecast-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="num">Year 1 free cash</th>
                  <th className="num">Year 2</th>
                  <th className="num">Year 3</th>
                  <th className="num">Total</th>
                  <th className="num">Lowest year</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr key={scenario.scenarioKey}>
                    <td><strong>{scenario.scenarioName}</strong></td>
                    {[0, 1, 2].map((index) => (
                      <td key={index} className="num">{money(scenario.years?.[index]?.freeCashCents)}</td>
                    ))}
                    <td className="num"><strong>{money(scenario.totalFreeCashCents)}</strong></td>
                    <td className="num">{money(scenario.lowestAnnualFreeCashCents)}</td>
                    <td>
                      {scenario.warningYears?.length ? (
                        <Badge tone="danger">Negative in year {scenario.warningYears.join(', ')}</Badge>
                      ) : (
                        <Badge tone="positive">Positive throughout</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function CashSection({ data }: { data: any }) {
  if (!data?.hasBankBalance) {
    return (
      <Card title="Cash position">
        <p className="subtle">{data?.message ?? 'No bank balance recorded.'}</p>
        <p className="subtle">A cash forecast starts from an actual bank balance, so nothing is shown until one exists.</p>
      </Card>
    );
  }
  return (
    <Card title="Cash position" subtitle={`Bank balance as at ${new Date(data.asAt).toLocaleDateString('en-AU')} · ${data.bankAccount}`}>
      <div className="stat-grid">
        <Figure label="Bank cash" value={money(data.bankCashCents)} provenance="ACTUAL" />
        <Figure label="GST reserve" value={money(data.gstReserveCents)} provenance="ACCOUNTING_ESTIMATE" note="Collected, not yet remitted. Not spendable." />
        <Figure label="PAYG payable" value={money(data.paygPayableCents)} provenance="ACCOUNTING_ESTIMATE" note="Withheld from wages, owed at the next BAS." />
        <Figure label="Operating cash" value={money(data.operatingCashCents)} provenance="ACCOUNTING_ESTIMATE" note="Bank cash less money owed to the ATO." />
        <Figure label="Available for creditors" value={money(data.cashAvailableForCreditorsCents)} provenance="ACCOUNTING_ESTIMATE" note="Never more than operating cash." />
      </div>
    </Card>
  );
}

function CreditorsSection({ data }: { data: any }) {
  if (!data?.hasProposal) {
    return (
      <Card title="Creditors">
        <p className="subtle">No proposal recorded for this entity yet. {data?.claims ?? 0} claims are on file.</p>
      </Card>
    );
  }
  const d = data.distribution;
  return (
    <div className="page-stack">
      <Card title={data.proposal.name} subtitle={`${data.legalName} · ${data.note}`}>
        <div className="stat-grid">
          <Figure label="Admitted external pool" value={money(d.admittedExternalPoolCents)} provenance="ACCOUNTING_ESTIMATE" note="Pending admitted proofs of debt" />
          <Figure label="Fixed contribution" value={money(d.fixedDistributionCents)} provenance="PROPOSAL_TERM" />
          <Figure label="Performance contribution" value={money(d.performancePaymentCents)} provenance="PROPOSAL_TERM" note={`Limited by: ${d.performanceLimitedBy.replace(/_/g, ' ').toLowerCase()}`} />
          <Figure label="Total contribution" value={money(d.totalContributionCents)} provenance="PROPOSAL_TERM" />
          <Figure label="Return" value={`${d.centsInDollar.toFixed(1)}c in the dollar`} provenance="PROPOSAL_TERM" note={d.fullyPaid ? 'Creditors made whole' : 'Below 100 cents'} />
        </div>
      </Card>

      <Card title="Payment schedule">
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr><th>Instalment</th><th>Year</th><th className="num">Fixed</th><th className="num">Performance</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {/* A proposal year holds two instalments (December and January),
                  so the month is what distinguishes the rows — keying or
                  labelling by year alone renders them as duplicates. */}
              {data.schedule.map((row: any, index: number) => (
                <tr key={row.periodStart ?? `${row.yearNumber}-${index}`}>
                  <td>
                    <strong>
                      {row.periodStart
                        ? new Date(`${row.periodStart}T00:00:00Z`).toLocaleDateString('en-AU', {
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })
                        : `Instalment ${index + 1}`}
                    </strong>
                  </td>
                  <td className="subtle">Year {row.yearNumber}</td>
                  <td className="num">{money(row.fixedCents)}</td>
                  <td className="num">{money(row.performanceCents)}</td>
                  <td className="num"><strong>{money(row.totalCents)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Claims by class" subtitle="Director loans and intercompany claims are excluded from the dividend unless switched on.">
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr><th>Class</th><th className="num">Claims</th><th className="num">Claimed</th><th className="num">Admitted</th><th>Participates</th></tr>
            </thead>
            <tbody>
              {Object.entries(data.claimsByClass ?? {}).map(([klass, value]: [string, any]) => {
                const participates =
                  klass === 'EXTERNAL_TRADE' || klass === 'STATUTORY' ||
                  (klass === 'DIRECTOR_LOAN' && data.proposal.participation.includeDirectorLoans) ||
                  (klass === 'INTERCOMPANY' && data.proposal.participation.includeIntercompany) ||
                  (klass === 'SECURED' && data.proposal.participation.includeSecuredShortfall) ||
                  (klass === 'PRIORITY_EMPLOYEE' && data.proposal.participation.includePriorityClaims) ||
                  (klass === 'CONTINGENT' && data.proposal.participation.includeContingentClaims);
                return (
                  <tr key={klass}>
                    <td>{klass.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="num">{value.count}</td>
                    <td className="num">{money(value.claimedCents)}</td>
                    <td className="num">{money(value.admittedCents)}</td>
                    <td>{participates ? <Badge tone="info">Included</Badge> : <Badge tone="neutral">Excluded</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ImportsSection({ data }: { data: any }) {
  return (
    <Card title="Import centre" subtitle="Download a template, fill it in, and validate before applying. Money is entered in dollars.">
      <div className="table-scroll">
        <table className="forecast-table">
          <thead>
            <tr><th>Dataset</th><th>Identified by</th><th className="num">Columns</th><th>Template</th></tr>
          </thead>
          <tbody>
            {(data?.datasets ?? []).map((dataset: any) => (
              <tr key={dataset.key}>
                <td>
                  <strong>{dataset.title}</strong>
                  <div className="subtle">{dataset.description}</div>
                </td>
                <td className="subtle">{dataset.naturalKey.join(' + ')}</td>
                <td className="num">{dataset.columns.length}</td>
                <td>
                  <a className="btn btn-sm btn-ghost" href={`/api/forecast-module/import-templates/${dataset.key}.csv`}>
                    Download CSV
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DataQualitySection({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  return (
    <Card
      title="Data quality"
      subtitle="Blocking issues must be resolved before the numbers can be relied on."
      action={<Button size="sm" variant="ghost" onClick={onRefresh}>Refresh</Button>}
    >
      <div className="stat-grid">
        <Figure label="Blocking" value={String(data?.blocking ?? 0)} provenance="ACTUAL" />
        <Figure label="Warnings" value={String(data?.warning ?? 0)} provenance="ACTUAL" />
        <Figure label="Informational" value={String(data?.informational ?? 0)} provenance="ACTUAL" />
      </div>
      {(data?.issues ?? []).length === 0 ? (
        <p className="subtle">No open issues.</p>
      ) : (
        <div className="table-scroll">
          <table className="forecast-table">
            <thead><tr><th>Severity</th><th>Check</th><th>Detail</th><th>Detected</th></tr></thead>
            <tbody>
              {data.issues.map((issue: any) => (
                <tr key={issue.id}>
                  <td>
                    <Badge tone={issue.severity === 'BLOCKING' ? 'danger' : issue.severity === 'WARNING' ? 'warning' : 'neutral'}>
                      {issue.severity.toLowerCase()}
                    </Badge>
                  </td>
                  <td>{issue.checkKey}</td>
                  <td>{issue.message}</td>
                  <td className="subtle">{new Date(issue.detectedAt).toLocaleDateString('en-AU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ModelSection({ data }: { data: any }) {
  return (
    <Card title="Model performance" subtitle="A challenger is promoted only when it beats the champion across multiple backtest windows.">
      {(data?.champions ?? []).length === 0 ? (
        <p className="subtle">No models have been trained yet. Accuracy appears once forecast runs have actuals to compare against.</p>
      ) : (
        <div className="table-scroll">
          <table className="forecast-table">
            <thead><tr><th>Family</th><th>Algorithm</th><th className="num">Version</th><th>Promoted</th></tr></thead>
            <tbody>
              {data.champions.map((model: any) => (
                <tr key={model.id}>
                  <td>{model.family}</td>
                  <td>{model.algorithm}</td>
                  <td className="num">{model.version}</td>
                  <td className="subtle">{model.promotedAt ? new Date(model.promotedAt).toLocaleDateString('en-AU') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SettingsSection({ data }: { data: any }) {
  if (!data) return null;
  return (
    <Card
      title="Assumptions"
      subtitle={`${data.legalName} · every assumption is versioned and editable. Nothing here is hardcoded.`}
    >
      {data.warning ? <p className="fc-warning">{data.warning}</p> : null}
      <div className="table-scroll">
        <table className="forecast-table">
          <thead>
            <tr><th>Assumption</th><th className="num">Value</th><th>Unit</th><th className="num">Version</th><th>Status</th><th>Source</th></tr>
          </thead>
          <tbody>
            {(data.provenance ?? []).map((entry: any) => (
              <tr key={entry.key}>
                <td>{entry.key.replace(/_/g, ' ')}</td>
                <td className="num">
                  {entry.unit === 'cents' || entry.unit?.startsWith('cents') ? money(entry.value) : entry.value}
                </td>
                <td className="subtle">{entry.unit ?? '—'}</td>
                <td className="num">{entry.version}</td>
                <td>{entry.confirmed ? <Badge tone="positive">Confirmed</Badge> : <Badge tone="warning">Unconfirmed</Badge>}</td>
                <td className="subtle fc-source-note">{entry.sourceNote ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

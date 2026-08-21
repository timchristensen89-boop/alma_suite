import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DONATION_ANNUAL_CAP,
  DONATION_ASSUMED_REDEMPTION_RATE,
  DONATION_CRITERIA,
  DONATION_EXPIRY_MONTHS,
  DONATION_FOOD_COST_RATE,
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  EMPTY_DONATION_CRITERIA,
  assessDonation,
  donationConditions,
  type DonationCriteria,
  type DonationCriterionId,
  type DonationRecord,
  type DonationReport
} from '@alma/shared';
import { Badge, Button, Card, Input, Select, Spinner, Textarea } from '@alma/ui';
import { ApiError, api } from './lib/api';

/**
 * Donations and sponsorship.
 *
 * The policy exists so that each request is a lookup rather than a decision, so
 * this screen puts the five rules at the top where they cannot be missed, then
 * makes the only allowed action — issue a voucher — the thing directly beneath
 * them. Cash never appears as an option because the policy does not have one.
 *
 * The register underneath is the separate reporting: a donated voucher is not a
 * sale, carries no paidAt, and never touches takings, so the purchases report
 * cannot see it and should not. The question asked here is a different one —
 * what did the twelve actually cost, against what they look like from outside.
 */

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

const DONATION_VENUES = ['St Alma', 'Alma Avalon', 'Either venue'];
const QUICK_AMOUNTS = [150, 175, 200];

const SIGNATURE = ['Tim Christensen', 'DIRECTOR', '0430 058 410', 'tim@almagroup.com.au'].join('\n');

/** The policy's five lines, verbatim, because paraphrasing a rule loosens it. */
const POLICY_LINES = [
  { head: 'Vouchers, not cash.', body: 'Cash donations are off the table entirely.' },
  { head: `${DONATION_ANNUAL_CAP} per year, maximum.`, body: 'Roughly one a month across all venues.' },
  { head: `${money(DONATION_MIN_CENTS)}–${money(DONATION_MAX_CENTS)} face value each.`, body: 'No exceptions upward without a real reason.' },
  {
    head: `${DONATION_EXPIRY_MONTHS}-month expiry, dine-in only, not valid Fri/Sat night.`,
    body: 'Protects the busy services.'
  },
  { head: `Once the ${DONATION_ANNUAL_CAP} are gone, they're gone.`, body: 'The answer is no until the calendar year turns.' }
];

export function DonationsPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<DonationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (targetYear: number) => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      api<DonationReport>(`/api/gift-cards/donations/report?year=${targetYear}`)
        .then((next) => {
          if (!cancelled) setReport(next);
        })
        .catch(() => {
          if (!cancelled) setError('Could not load the donation register.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    },
    []
  );

  useEffect(() => load(year), [load, year]);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = thisYear; y >= thisYear - 4; y -= 1) list.push(y);
    return list;
  }, [thisYear]);

  return (
    <>
      <PolicyPanel />
      {year === thisYear ? (
        <IssuePanel
          allocation={report?.allocation ?? { year, cap: DONATION_ANNUAL_CAP, used: 0, remaining: DONATION_ANNUAL_CAP }}
          onIssued={() => load(year)}
        />
      ) : null}
      <Card
        title="The register"
        subtitle="Every voucher given away, what it looked like, and what it actually cost."
        action={
          <Select
            label="Year"
            value={String(year)}
            onChange={(event) => setYear(Number(event.currentTarget.value))}
            options={years.map((y) => ({ label: String(y), value: String(y) }))}
          />
        }
      >
        {loading && !report ? <Spinner label="Loading the register…" /> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {report ? <DonationReportBody report={report} onChanged={() => load(year)} /> : null}
      </Card>
      <TemplatesPanel />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The policy                                                          */
/* ------------------------------------------------------------------ */

function PolicyPanel() {
  return (
    <Card
      title="The policy, in five lines"
      subtitle="Written August 2026. The point of writing it down is that each request is a lookup, not a decision."
    >
      <ol className="donation-policy">
        {POLICY_LINES.map((line) => (
          <li key={line.head}>
            <strong>{line.head}</strong>
            <span>{line.body}</span>
          </li>
        ))}
      </ol>
      <div className="donation-why">
        <h4>Why vouchers and not cash</h4>
        <table className="donation-why-table">
          <thead>
            <tr>
              <th scope="col"> </th>
              <th scope="col">{money(200_00)} cash</th>
              <th scope="col">{money(200_00)} voucher</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Cost if used</th>
              <td>{money(200_00)}</td>
              <td>~{money(66_00)}</td>
            </tr>
            <tr>
              <th scope="row">Cost if never redeemed</th>
              <td>{money(200_00)}</td>
              <td>{money(0)}</td>
            </tr>
            <tr>
              <th scope="row">Brings someone into the venue</th>
              <td>No</td>
              <td>Yes</td>
            </tr>
          </tbody>
        </table>
        <p className="subtle">
          Food cost is taken at {Math.round(DONATION_FOOD_COST_RATE * 100)}%. The register below measures the real
          redemption rate rather than assuming the {Math.round(DONATION_ASSUMED_REDEMPTION_RATE * 100)}% the policy
          estimates from.
        </p>
      </div>
      <details className="donation-tax">
        <summary>Tax note — raise with the accountant, don't act on it from here</summary>
        <p>
          The personal DGR gift deduction does not apply to gifts made in the course of carrying on a business, so the
          "donation" framing is the wrong one. If you are named or listed in the fundraiser, the better characterisation
          is <strong>sponsorship</strong> — a business expense with a marketing purpose. Ask for the listing, keep the
          email confirming it, and record it against the voucher below.
        </p>
        <p>
          The {DONATION_EXPIRY_MONTHS}-month expiry is shorter than the three years a card <em>sold</em> to a consumer
          must carry. A prize voucher given at no cost sits inside a carve-out from that minimum; worth confirming
          rather than assuming.
        </p>
      </details>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

type Issued = {
  card: { code: string; initialValueCents: number; expiresAt: string | null };
  donation: DonationRecord;
  warnings: string[];
};

function IssuePanel({
  allocation,
  onIssued
}: {
  allocation: { year: number; cap: number; used: number; remaining: number };
  onIssued: () => void;
}) {
  const [organisation, setOrganisation] = useState('');
  const [cause, setCause] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [venue, setVenue] = useState('St Alma');
  const [amount, setAmount] = useState(200);
  const [custom, setCustom] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [criteria, setCriteria] = useState<DonationCriteria>({ ...EMPTY_DONATION_CRITERIA });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const amountCents = useMemo(() => {
    if (custom.trim()) {
      const parsed = Number(custom.replace(/[^0-9.]/g, ''));
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
    }
    return amount * 100;
  }, [amount, custom]);

  // Assessed live against the same function the API runs, so the screen and the
  // server can never disagree about what the policy says.
  const verdict = useMemo(
    () => assessDonation({ amountCents, used: allocation.used, criteria, organisation }),
    [amountCents, allocation.used, criteria, organisation]
  );

  function toggle(id: DonationCriterionId) {
    setCriteria((current) => ({ ...current, [id]: !current[id] }));
  }

  function reset() {
    setOrganisation('');
    setCause('');
    setContactName('');
    setContactEmail('');
    setAmount(200);
    setCustom('');
    setEventDate('');
    setCriteria({ ...EMPTY_DONATION_CRITERIA });
    setNotes('');
    setIssued(null);
    setError(null);
  }

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Issued>('/api/gift-cards/donations', {
        method: 'POST',
        body: JSON.stringify({
          organisation: organisation.trim(),
          cause: cause.trim() || null,
          contactName: contactName.trim() || null,
          contactEmail: contactEmail.trim() || null,
          venue,
          amountCents,
          eventDate: eventDate || null,
          notes: notes.trim() || null,
          ...criteria
        })
      });
      setIssued(result);
      onIssued();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue that voucher.');
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <Card title="Voucher issued" subtitle={`${issued.donation.year}/${issued.donation.sequence} · ${issued.donation.organisation}`}>
        <p className="donation-code">{issued.card.code}</p>
        <p className="donation-issued-value">
          {money(issued.card.initialValueCents)} ·{' '}
          {issued.card.expiresAt
            ? `valid until ${new Date(issued.card.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`
            : 'no expiry set'}
        </p>
        <p className="donation-conditions">{donationConditions()}</p>
        {issued.warnings.length > 0 ? (
          <ul className="donation-warnings">
            {issued.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <p className="subtle">
          Not emailed to anyone. A raffle prize goes to whoever wins it, not to whoever asked — write the number on the
          voucher or send it on yourself.
        </p>
        <div className="giftcards-inline-actions">
          <Button type="button" onClick={reset}>
            Record another
          </Button>
        </div>
      </Card>
    );
  }

  const spent = allocation.remaining <= 0;

  return (
    <Card
      title="Give a voucher"
      subtitle={
        spent
          ? `All ${allocation.cap} for ${allocation.year} are gone. The answer is no until the calendar turns.`
          : `${allocation.remaining} of ${allocation.cap} left for ${allocation.year}.`
      }
      action={
        <span className={`donation-allocation ${spent ? 'is-spent' : allocation.remaining <= 2 ? 'is-low' : ''}`}>
          <strong>{allocation.remaining}</strong>
          <small>left</small>
        </span>
      }
    >
      <div className="donation-pips" aria-label={`${allocation.used} of ${allocation.cap} used`}>
        {Array.from({ length: allocation.cap }, (_, index) => (
          <span key={index} className={index < allocation.used ? 'is-used' : ''} />
        ))}
      </div>

      <div className="form-grid two">
        <Input
          label="Who is asking"
          required
          value={organisation}
          onChange={(event) => setOrganisation(event.currentTarget.value)}
          placeholder="Freshwater Surf Life Saving Club"
        />
        <Input label="What for" value={cause} onChange={(event) => setCause(event.currentTarget.value)} placeholder="Junior nippers raffle" />
        <Input label="Contact name" value={contactName} onChange={(event) => setContactName(event.currentTarget.value)} />
        <Input label="Contact email" value={contactEmail} onChange={(event) => setContactEmail(event.currentTarget.value)} />
        <Select
          label="Whose voucher"
          value={venue}
          onChange={(event) => setVenue(event.currentTarget.value)}
          options={DONATION_VENUES.map((item) => ({ label: item, value: item }))}
        />
        <Input label="Event date" type="date" value={eventDate} onChange={(event) => setEventDate(event.currentTarget.value)} />
      </div>

      <p className="donation-kicker">Face value</p>
      <div className="donation-amounts">
        {QUICK_AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            className={!custom.trim() && amount === value ? 'is-on' : ''}
            onClick={() => {
              setAmount(value);
              setCustom('');
            }}
          >
            ${value}
          </button>
        ))}
        <input
          className="donation-custom"
          inputMode="decimal"
          placeholder="Other"
          value={custom}
          onChange={(event) => setCustom(event.currentTarget.value)}
        />
      </div>

      <p className="donation-kicker">
        Score it — {verdict.score} of {DONATION_CRITERIA.length}
        {verdict.score >= 3 ? <Badge tone="positive">Candidate</Badge> : <Badge tone="warning">Below the bar</Badge>}
      </p>
      <ul className="donation-criteria">
        {DONATION_CRITERIA.map((criterion) => (
          <li key={criterion.id}>
            <label>
              <input type="checkbox" checked={criteria[criterion.id]} onChange={() => toggle(criterion.id)} />
              <span>
                <strong>{criterion.label}</strong>
                <small>{criterion.hint}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="subtle">
        DGR endorsement is worth checking on{' '}
        <a href="https://abr.business.gov.au/Tools/DgrListing" target="_blank" rel="noreferrer">
          ABN Lookup
        </a>
        .
      </p>

      <Textarea
        label="Notes"
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
        placeholder="Anything the next person reading this register needs to know"
      />

      {verdict.reasons.length > 0 ? (
        <ul className="donation-blockers">
          {verdict.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {verdict.warnings.length > 0 ? (
        <ul className="donation-warnings">
          {verdict.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="giftcards-inline-actions">
        <Button type="button" disabled={!verdict.ok || busy} onClick={() => void issue()}>
          {busy ? 'Issuing…' : `Give ${money(amountCents || 0)}`}
        </Button>
        <span className="subtle">
          Issued as a comped card. It never lands in takings, and it expires in {DONATION_EXPIRY_MONTHS} months.
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Register and cost                                                   */
/* ------------------------------------------------------------------ */

function DonationReportBody({ report, onChanged }: { report: DonationReport; onChanged: () => void }) {
  const { summary } = report;
  const measured = summary.redemptionRate;

  return (
    <>
      <div className="donation-stats">
        <Stat label="Given away" value={money(summary.faceValueCents)} note={`${report.allocation.used} of ${report.allocation.cap} vouchers`} />
        <Stat label="Actually redeemed" value={money(summary.redeemedCents)} note={`${summary.unusedCount} untouched so far`} />
        <Stat
          label="What it really cost"
          value={money(summary.actualCostCents)}
          note={`Redeemed value at ${Math.round(DONATION_FOOD_COST_RATE * 100)}% food cost`}
          strong
        />
        <Stat
          label="Redemption rate"
          value={measured === null ? '—' : `${Math.round(measured * 100)}%`}
          note={`Measured. The policy assumes ${Math.round(DONATION_ASSUMED_REDEMPTION_RATE * 100)}%.`}
        />
      </div>
      <p className="donation-verdict">
        {summary.faceValueCents === 0 ? (
          <>Nothing given away in {report.year} yet.</>
        ) : (
          <>
            {money(summary.faceValueCents)} of apparent generosity has cost <strong>{money(summary.actualCostCents)}</strong> so
            far. The policy's own estimate for this many vouchers was {money(summary.expectedCostCents)}.
            {summary.expiredUnusedCents > 0 ? (
              <> {money(summary.expiredUnusedCents)} expired without being used — free, and worth knowing.</>
            ) : null}
          </>
        )}
      </p>

      {report.byVenue.length > 1 ? (
        <ul className="donation-venues">
          {report.byVenue.map((row) => (
            <li key={row.venue}>
              <strong>{row.venue}</strong>
              <span>
                {row.count} · {money(row.faceValueCents)} given, {money(row.redeemedCents)} used
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {report.donations.length === 0 ? (
        <p className="subtle">No donations recorded for {report.year}.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Organisation</th>
                <th>Venue</th>
                <th>Code</th>
                <th className="numeric">Face</th>
                <th className="numeric">Used</th>
                <th>Status</th>
                <th>Score</th>
                <th>Listing</th>
              </tr>
            </thead>
            <tbody>
              {report.donations.map((row) => (
                <DonationRow key={row.id} row={row} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, note, strong }: { label: string; value: string; note: string; strong?: boolean }) {
  return (
    <div className={`donation-stat ${strong ? 'is-strong' : ''}`}>
      <span className="donation-stat-label">{label}</span>
      <strong className="donation-stat-value">{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function DonationRow({ row, onChanged }: { row: DonationRecord; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [evidence, setEvidence] = useState(row.listingEvidence ?? '');
  const [saving, setSaving] = useState(false);

  const expired = row.card.expiresAt ? new Date(row.card.expiresAt) < new Date() : false;
  const used = row.card.redeemedCents > 0;

  async function save() {
    setSaving(true);
    try {
      await api(`/api/gift-cards/donations/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ listingEvidence: evidence.trim(), named: Boolean(evidence.trim()) || row.criteria.named })
      });
      setEditing(false);
      onChanged();
    } catch {
      // Leave the field open with what was typed; the manager can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr>
        <td>{row.sequence}</td>
        <td>
          <strong>{row.organisation}</strong>
          {row.cause ? <small className="donation-cell-note">{row.cause}</small> : null}
        </td>
        <td>{row.venue}</td>
        <td className="mono">{row.card.code}</td>
        <td className="numeric">{money(row.card.initialValueCents)}</td>
        <td className="numeric">{used ? money(row.card.redeemedCents) : '—'}</td>
        <td>
          {row.card.status === 'CANCELLED' ? (
            <Badge tone="danger">Cancelled</Badge>
          ) : expired && !used ? (
            <Badge tone="neutral">Expired unused</Badge>
          ) : used && row.card.balanceCents === 0 ? (
            <Badge tone="positive">Fully used</Badge>
          ) : used ? (
            <Badge tone="info">Part used</Badge>
          ) : (
            <Badge tone="warning">Out there</Badge>
          )}
        </td>
        <td>
          {row.score}/{DONATION_CRITERIA.length}
        </td>
        <td>
          {row.listingEvidence && !editing ? (
            <button type="button" className="donation-linkish" onClick={() => setEditing(true)}>
              {row.listingEvidence}
            </button>
          ) : editing ? null : (
            <button type="button" className="donation-linkish is-missing" onClick={() => setEditing(true)}>
              Record the listing
            </button>
          )}
        </td>
      </tr>
      {editing ? (
        <tr className="donation-edit-row">
          <td colSpan={9}>
            <Input
              label="Where you were named"
              value={evidence}
              onChange={(event) => setEvidence(event.currentTarget.value)}
              placeholder="Programme p.4 — email from Sarah 12 Sep, filed with the invoice"
            />
            <div className="giftcards-inline-actions">
              <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Replies                                                             */
/* ------------------------------------------------------------------ */

function TemplatesPanel() {
  const [name, setName] = useState('');
  const [cause, setCause] = useState('');
  const [venue, setVenue] = useState('St Alma');
  const [copied, setCopied] = useState<string | null>(null);

  const who = name.trim() || '[Name]';
  const what = cause.trim() || '[cause]';
  const year = new Date().getFullYear();

  const templates = [
    {
      id: 'yes',
      label: 'The yes',
      body: `Hi ${who},

Appreciate you thinking of us, and ${what} sounds like a good one.

We'd be glad to put in a $200 ${venue} voucher for the raffle. It's valid for 12 months, dine-in, just not Friday or Saturday nights as those services are already full.

If you can list us in the programme that'd be great. Let me know where to send it and I'll get it out to you this week.

Thanks,

${SIGNATURE}`
    },
    {
      id: 'no',
      label: 'The no',
      body: `Hi ${who},

Appreciate you thinking of us, and I'm sorry to be coming back with a no on this one.

We set aside a fixed number of donations each year and we've used them up for ${year}. I'd rather tell you straight than leave you waiting on a maybe.

Do get in touch early next year and I'll see what we can do.

Thanks,

${SIGNATURE}`
    },
    {
      id: 'door',
      label: 'The no, door left open',
      body: `Hi ${who},

Appreciate you thinking of us.

We're fully committed on donations for this year, so I can't help with the raffle. What I can do is note you down for next year's round, and if something frees up before then I'll come back to you.

Thanks,

${SIGNATURE}`
    }
  ];

  async function copy(id: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Card title="The reply" subtitle="Fill the two blanks, copy, send. Saying no early is kinder than a maybe.">
      <div className="form-grid two">
        <Input label="Their name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Sarah" />
        <Input label="The cause" value={cause} onChange={(event) => setCause(event.currentTarget.value)} placeholder="the nippers fundraiser" />
        <Select
          label="Venue named in the yes"
          value={venue}
          onChange={(event) => setVenue(event.currentTarget.value)}
          options={['St Alma', 'Alma Avalon'].map((item) => ({ label: item, value: item }))}
        />
      </div>
      <div className="donation-templates">
        {templates.map((template) => (
          <article key={template.id}>
            <header>
              <h4>{template.label}</h4>
              <Button type="button" size="sm" variant="secondary" onClick={() => void copy(template.id, template.body)}>
                {copied === template.id ? 'Copied' : 'Copy'}
              </Button>
            </header>
            <pre>{template.body}</pre>
          </article>
        ))}
      </div>
    </Card>
  );
}

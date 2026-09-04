#!/usr/bin/env bash
set -euo pipefail

# Why is a night's tips missing, and why won't the ABA file go through.
#
# Read only. It writes nothing, and it never prints a bank account number —
# accounts are shown as "set (N digits)" so this output is safe to paste back.
#
#   ./scripts/tips-diagnose.sh
#       ...the last 14 days of tip entries for both venues, the Lightspeed
#          inbound-email warnings that explain any gap, and the ABA config.
#
#   DAYS=28 ./scripts/tips-diagnose.sh
#   VENUE="Alma Avalon" ./scripts/tips-diagnose.sh

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"

SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) | grep -E '^(suite-api|stock-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find an API service in $DEPLOY_DIR." >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  exit 1
fi

echo "-> API service: ${SERVICE}"
echo "-> Mode:        READ ONLY - nothing is written, no account numbers printed"
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.tips-diagnose.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const DAYS = Number(process.env.DAYS || '14');
const ONLY_VENUE = (process.env.VENUE || '').trim();

const pad = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
const padL = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : ' '.repeat(w - t.length) + t; };
const money = (c) => `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayName = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
const key = (d) => d.toISOString().slice(0, 10);

const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const from = new Date(today);
from.setUTCDate(from.getUTCDate() - DAYS);

// ---- what tip data exists -------------------------------------------------
const entries = await prisma.staffTipCardEntry.findMany({
  where: { serviceDate: { gte: from, lte: today } },
  orderBy: [{ serviceDate: 'asc' }, { venue: 'asc' }],
  select: { venue: true, serviceDate: true, amountCents: true, source: true, notes: true }
});

const venues = ONLY_VENUE
  ? [ONLY_VENUE]
  : [...new Set(entries.map((e) => e.venue))].sort();
if (!venues.length) venues.push('Alma Avalon', 'St Alma');

const byKey = new Map();
for (const e of entries) byKey.set(`${e.venue}|${key(e.serviceDate)}`, e);

console.log(`TIP CARD ENTRIES - last ${DAYS} days`);
console.log('  A day with no row is a day nothing was recorded. That is not the same');
console.log('  as a day that took no tips: a genuinely $0 day is also skipped by the');
console.log('  importer, so both look identical here. The warnings below tell them apart.\n');

for (const venue of venues) {
  console.log(`  ${venue}`);
  let missing = 0;
  for (let i = 0; i <= DAYS; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    if (d >= today) continue;
    const row = byKey.get(`${venue}|${key(d)}`);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    if (row) {
      console.log(
        `    ${dayName(d)} ${key(d)}  ${padL(money(row.amountCents), 12)}  ${pad(row.source, 18)}` +
          `${row.notes ? ' ' + row.notes : ''}`
      );
    } else {
      missing += 1;
      console.log(`    ${dayName(d)} ${key(d)}  ${padL('- nothing -', 12)}${weekend ? '   <-- weekend' : ''}`);
    }
  }
  console.log(`    ${missing} day(s) with no entry\n`);
}

// ---- why: the inbound email import keeps its own reasons -------------------
const events = await prisma.integrationWebhookEvent.findMany({
  where: { provider: 'LIGHTSPEED', accountKey: 'inbound-email', receivedAt: { gte: from } },
  orderBy: { receivedAt: 'asc' },
  select: { receivedAt: true, processedAt: true, errorSummary: true, payload: true }
});

console.log(`LIGHTSPEED INBOUND EMAILS (${events.length}) - what each one did`);
if (!events.length) {
  console.log('  No inbound tip emails at all in this window. If tips normally arrive by');
  console.log('  emailed report, the report is not being sent or not reaching the inbox -');
  console.log('  check the Lightspeed scheduled report and the forwarding rule.\n');
}
for (const ev of events) {
  const p = (ev.payload && typeof ev.payload === 'object') ? ev.payload : {};
  const when = ev.receivedAt.toISOString().slice(0, 16).replace('T', ' ');
  console.log(`  ${when}  ${p.subject ?? '(no subject)'}`);
  console.log(
    `      tips: ${p.tipDaysUpserted ?? 0} day(s) written, ${p.tipDaysRefused ?? 0} refused, ` +
      `${money(Number(p.tipCents ?? 0))}   sales: ${p.dayTotalsUpserted ?? 0} written, ${p.dayTotalsSkipped ?? 0} skipped`
  );
  if (!ev.processedAt) console.log('      NOT PROCESSED - this email was received but never ran.');
  if (ev.errorSummary) console.log(`      ERROR: ${ev.errorSummary}`);
  const warnings = Array.isArray(p.warnings) ? p.warnings : [];
  for (const w of warnings) console.log(`      ! ${w}`);
  if (!warnings.length && ev.processedAt) console.log('      (no warnings)');
}
console.log();

// ---- the ABA config, masked -----------------------------------------------
const settingsRow = await prisma.appSettings.findUnique({
  where: { id: 'singleton' },
  select: { tipsAbaSettings: true }
});
const aba = settingsRow?.tipsAbaSettings && typeof settingsRow.tipsAbaSettings === 'object'
  ? settingsRow.tipsAbaSettings
  : {};

// Never print the digits. Length alone is enough to tell "wrong account" from
// "no account", and this output gets pasted around.
const acct = (v) => {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits ? `set (${digits.length} digits)` : 'NOT SET';
};
const plain = (v) => (String(v ?? '').trim() ? String(v).trim() : 'NOT SET');

console.log('TIP PAYMENT (ABA) CONFIG - Settings -> Tip payments');
console.log(`  financialInstitution : ${plain(aba.financialInstitution)}   (CommBank files must say CBA)`);
console.log(`  userName             : ${plain(aba.userName)}`);
console.log(`  userId               : ${plain(aba.userId)}   (the bank's 6-digit Direct Entry / APCA user id)`);
console.log(`  remitterName         : ${plain(aba.remitterName)}`);
console.log(`  traceBsb             : ${plain(aba.traceBsb)}`);
console.log(`  traceAccount         : ${acct(aba.traceAccount)}`);
console.log(`  selfBalancing        : ${aba.selfBalancing === '1' || aba.selfBalancing === true ? 'ON' : 'off'}`);
console.log(`  env override         : TIPS_ABA_SELF_BALANCING=${process.env.TIPS_ABA_SELF_BALANCING ?? '(unset)'}`);

const accounts = Array.isArray(aba.accounts) ? aba.accounts : [];
console.log(`\n  FUNDING ACCOUNTS (${accounts.length}) - the "pay from" choice at export`);
if (!accounts.length) console.log('    (none - every export uses the base details above)');
for (const a of accounts) {
  console.log(`    ${a.label ?? '(no label)'}`);
  console.log(`      traceBsb             : ${plain(a.traceBsb)}`);
  console.log(`      traceAccount         : ${acct(a.traceAccount)}`);
  // A blank field here is NOT neutral: it silently inherits the base value,
  // which on a new account at a new bank is the OLD bank's.
  for (const field of ['financialInstitution', 'userId', 'userName', 'remitterName']) {
    const own = String(a[field] ?? '').trim();
    console.log(
      `      ${pad(field, 21)}: ${own ? own : `blank -> inherits "${plain(aba[field])}"`}`
    );
  }
}

const venueOverrides = aba.venues && typeof aba.venues === 'object' ? aba.venues : {};
const venueKeys = Object.keys(venueOverrides);
console.log(`\n  PER-VENUE OVERRIDES (${venueKeys.length})`);
if (!venueKeys.length) console.log('    (none)');
for (const v of venueKeys) {
  const o = venueOverrides[v] ?? {};
  const set = Object.keys(o).filter((k) => String(o[k] ?? '').trim());
  console.log(`    ${v}: ${set.length ? set.join(', ') : '(empty)'}`);
}

console.log('\nRead only - nothing was written.');
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/api \
  -e "DAYS=${DAYS:-14}" \
  -e "VENUE=${VENUE:-}" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")

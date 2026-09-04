#!/usr/bin/env bash
set -euo pipefail

# Point the tip ABA file at the right bank.
#
# The export resolves three layers (staff.service.ts, tipsAbaConfig):
#
#     { ...flat defaults, ...whole per-venue override, ...account's non-empty fields }
#
# so a blank field on a funding account lands on the VENUE override, not on the
# flat defaults. That makes the venue layer the one that decides which bank the
# header record names - and it is also the only layer the admin form cannot
# reach, so it is where this script writes.
#
# It deliberately does not write to the funding accounts: the form rebuilds
# every account from its own five fields on save (AdminPage.tsx sends only
# label/BSB/account/remitter; settings.service.ts fills the rest with ''), so
# anything set there is blanked the next time somebody presses Save. The venue
# override is never touched by that form and survives.
#
# Read only unless CONFIRM=YES. It never prints a bank account number.
#
#   ./scripts/tips-aba-set-bank.sh
#       ...show what each venue would become. Writes nothing.
#
#   USER_ID=123456 CONFIRM=YES ./scripts/tips-aba-set-bank.sh
#       ...set financialInstitution=CBA and that Direct Entry user id on both
#          venues.
#
#   USER_ID=123456 INSTITUTION=CBA VENUE="Alma Avalon" CONFIRM=YES ./scripts/tips-aba-set-bank.sh
#
# USER_ID is the 6-digit Direct Entry (APCA) user id the bank issues when it
# enables direct entry on the account. It is not the BSB, the account number or
# a customer number, and it is not something to guess - the file is rejected on
# a wrong one exactly as it is on a missing one.

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

if [ "${CONFIRM:-}" = "YES" ]; then
  echo "-> API service: ${SERVICE}"
  echo "-> Mode:        WRITE - the venue override(s) will be updated"
else
  echo "-> API service: ${SERVICE}"
  echo "-> Mode:        DRY RUN - nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.tips-aba-set-bank.mjs"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { prisma } from '@alma/db';

const WRITE = process.env.CONFIRM === 'YES';
const ONLY_VENUE = (process.env.VENUE || '').trim();
const INSTITUTION = (process.env.INSTITUTION || 'CBA').trim().toUpperCase();
const USER_ID = String(process.env.USER_ID || '').replace(/\D/g, '');

const pad = (v, w) => { const t = String(v ?? ''); return t.length >= w ? t : t + ' '.repeat(w - t.length); };
// Never print the digits - length alone separates "wrong account" from "none".
const acct = (v) => {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits ? `set (${digits.length} digits)` : 'NOT SET';
};
const plain = (v) => (String(v ?? '').trim() ? String(v).trim() : 'NOT SET');

// The first two digits of a BSB name the institution. Only the banks this
// business has actually used are listed; an unrecognised prefix says so rather
// than guessing at a bank.
const BSB_BANK = {
  '06': { abbr: 'CBA', name: 'Commonwealth Bank' },
  '08': { abbr: 'NAB', name: 'National Australia Bank' },
  '18': { abbr: 'MBL', name: 'Macquarie Bank' }
};

const row = await prisma.appSettings.findUnique({
  where: { id: 'singleton' },
  select: { tipsAbaSettings: true }
});
const aba = row?.tipsAbaSettings && typeof row.tipsAbaSettings === 'object' && !Array.isArray(row.tipsAbaSettings)
  ? { ...row.tipsAbaSettings }
  : {};
const venues = aba.venues && typeof aba.venues === 'object' && !Array.isArray(aba.venues) ? { ...aba.venues } : {};
const accounts = Array.isArray(aba.accounts) ? aba.accounts : [];

const names = Object.keys(venues).filter((v) => !ONLY_VENUE || v === ONLY_VENUE);
if (!names.length) {
  console.log(ONLY_VENUE
    ? `No per-venue override named "${ONLY_VENUE}". Existing: ${Object.keys(venues).join(', ') || '(none)'}`
    : 'There are no per-venue overrides to change.');
  await prisma.$disconnect();
  process.exit(1);
}

console.log('CHANGE');
console.log(`  financialInstitution -> ${INSTITUTION}`);
console.log(`  userId               -> ${USER_ID ? USER_ID : 'NOT GIVEN'}`);
console.log('  Everything else on each venue is left exactly as it is, including');
console.log('  the BSB and account number - the funding account picked at export');
console.log('  supplies those.\n');

for (const name of names) {
  const v = venues[name] ?? {};
  console.log(`  ${name}`);
  console.log(`    ${pad('financialInstitution', 21)}: ${plain(v.financialInstitution)}  ->  ${INSTITUTION}`);
  console.log(`    ${pad('userId', 21)}: ${plain(v.userId)}  ->  ${USER_ID || '(unchanged - none given)'}`);
  console.log(`    ${pad('userName', 21)}: ${plain(v.userName)}   (unchanged)`);
  console.log(`    ${pad('traceBsb', 21)}: ${plain(v.traceBsb)}   (unchanged)`);
  console.log(`    ${pad('traceAccount', 21)}: ${acct(v.traceAccount)}   (unchanged)`);
  console.log();
}

// What the file will actually carry afterwards, per venue x funding account.
console.log('AFTERWARDS, WHAT AN EXPORT SENDS');
let stillWrong = 0;
for (const name of names) {
  const venueAfter = { ...(venues[name] ?? {}), financialInstitution: INSTITUTION, ...(USER_ID ? { userId: USER_ID } : {}) };
  for (const a of (accounts.length ? accounts : [null])) {
    const own = Object.fromEntries(
      Object.entries(a ?? {}).filter(([f, val]) => f !== 'key' && f !== 'label' && String(val ?? '').trim())
    );
    const c = { ...aba, ...venueAfter, ...own };
    const bsb = String(c.traceBsb ?? '').replace(/\D/g, '');
    const bank = BSB_BANK[bsb.slice(0, 2)];
    const inst = String(c.financialInstitution ?? '').trim().toUpperCase();
    const uid = String(c.userId ?? '').replace(/\D/g, '');
    const notes = [];
    if (bank && inst !== bank.abbr) {
      notes.push(`financialInstitution "${inst}" still does not match BSB ${bsb.slice(0, 3)}-${bsb.slice(3)} (${bank.name} = "${bank.abbr}")`);
    }
    if (!bank && bsb.length === 6) notes.push(`BSB ${bsb.slice(0, 3)}-${bsb.slice(3)} is a bank this script does not recognise - check the abbreviation by hand`);
    if (uid.length !== 6) notes.push(`userId is ${uid.length} digits, not 6`);
    else if (/^(\d)\1*$/.test(uid)) notes.push(`userId "${uid}" is still a placeholder`);
    if (notes.length) stillWrong += 1;
    console.log(`  ${name}  paying from  ${a?.label ?? '(base details)'}`);
    console.log(`      ${inst}  /  user id ${uid || '(none)'}  /  BSB ${plain(c.traceBsb)}  /  ${acct(c.traceAccount)}`);
    for (const n of notes) console.log(`      !! ${n}`);
    if (!notes.length) console.log('      ok');
  }
}
console.log();

if (!USER_ID) {
  console.log('NOT WRITING: USER_ID was not given.');
  console.log('The institution is only half of it - a file with the right bank code and');
  console.log('a placeholder user id is rejected just the same. Ask the bank for the');
  console.log('6-digit Direct Entry user id on the account, then re-run:');
  console.log('  USER_ID=123456 CONFIRM=YES ./scripts/tips-aba-set-bank.sh');
  await prisma.$disconnect();
  process.exit(1);
}
if (USER_ID.length !== 6) {
  console.log(`NOT WRITING: USER_ID is ${USER_ID.length} digits. The Direct Entry user id is 6.`);
  await prisma.$disconnect();
  process.exit(1);
}
if (!/^[A-Z]{3}$/.test(INSTITUTION)) {
  console.log(`NOT WRITING: INSTITUTION "${INSTITUTION}" is not a 3-letter abbreviation.`);
  await prisma.$disconnect();
  process.exit(1);
}

if (!WRITE) {
  console.log('DRY RUN - nothing was written. Re-run with CONFIRM=YES to apply.');
  await prisma.$disconnect();
  process.exit(0);
}

for (const name of names) {
  venues[name] = { ...(venues[name] ?? {}), financialInstitution: INSTITUTION, userId: USER_ID };
}
aba.venues = venues;
await prisma.appSettings.update({
  where: { id: 'singleton' },
  data: { tipsAbaSettings: aba }
});

console.log(`Updated ${names.length} venue override(s): ${names.join(', ')}.`);
if (stillWrong) {
  console.log(`\n${stillWrong} venue/account pairing(s) above still carry a mismatch - those are`);
  console.log('the ones paying from a different bank than the abbreviation now says.');
  console.log('Pick a funding account whose BSB matches, or run this again with the');
  console.log('matching INSTITUTION for that venue.');
}
console.log('\nRe-run scripts/tips-diagnose.sh to see the resolved config, then export a');
console.log('tip run and check the bank accepts the file before paying anyone.');
await prisma.$disconnect();
JSEOF

(cd "$DEPLOY_DIR" && docker compose exec -T -w /workspace/apps/api \
  -e "CONFIRM=${CONFIRM:-}" \
  -e "VENUE=${VENUE:-}" \
  -e "INSTITUTION=${INSTITUTION:-CBA}" \
  -e "USER_ID=${USER_ID:-}" \
  "$SERVICE" node "$SCRIPT_IN_CONTAINER")

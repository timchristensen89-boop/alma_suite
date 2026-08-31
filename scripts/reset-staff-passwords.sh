#!/usr/bin/env bash
set -euo pipefail

# Bulk-set every active human staff password to <FirstName>@lma2026, so staff
# can sign in with their own login today. Skips the excluded accounts.
#
# Run it on the VPS:
#
#   cd /opt/alma/alma-suite && ./scripts/reset-staff-passwords.sh
#   cd /opt/alma/alma-suite && RESET_STAFF_PASSWORDS_CONFIRM=YES ./scripts/reset-staff-passwords.sh
#
# DRY RUN unless RESET_STAFF_PASSWORDS_CONFIRM=YES. The dry run shows exactly
# who would change and what their first-name token normalises to, without
# touching the database and without printing a full password.
#
# WHO IT TOUCHES
#   accountType = HUMAN        (venue iPad device accounts are left alone)
#   employmentStatus = ACTIVE  (former staff keep whatever they have; a
#                               guessable password on a departed account is
#                               strictly worse than none)
#   email IS NOT NULL          (no email, no login to reset)
#   not merged into another profile
#   email not in EXCLUDE_EMAILS
#
# NORMALISING THE NAME
#   Accents are folded and anything that isn't a letter is dropped, because a
#   password with a space or an accent in it is a support call waiting to
#   happen. "José" -> Jose, "Anne-Marie" -> AnneMarie. The dry run flags every
#   name this changes so you can see them before committing.
#
# WHAT IT DOES NOT DO
#   - It does not sign anyone out. Existing session cookies stay valid until
#     they expire; a password change alone doesn't revoke them.
#   - It does not write the app's own audit events, because it writes the
#     hash directly rather than going through the reset flow.
#   - It does not force a change at next login. There is no such flag on
#     StaffProfile today.
#
# ON THE APPLIED RUN it writes name,email,password to a 0600 file on the VPS
# so you can hand them out. Delete that file once you have.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM="${RESET_STAFF_PASSWORDS_CONFIRM:-NO}"
EXCLUDE_EMAILS="${EXCLUDE_EMAILS:-tim@almagroup.com.au}"
PASSWORD_SUFFIX="${PASSWORD_SUFFIX:-@lma2026}"
OUT_FILE="${OUT_FILE:-/opt/alma/staff-passwords-$(date +%Y-%m-%d).csv}"

# The API service has both bcryptjs and the Prisma client. Auto-detect its
# name rather than assuming: this compose file calls it suite-api, and an
# earlier script in this repo guessed "api" and quietly did nothing.
SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) \
    | grep -E '^(suite-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find the API service in $DEPLOY_DIR." >&2
  echo "Services present:" >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  echo "Re-run with SERVICE=<name>." >&2
  exit 1
fi

echo "→ API service: $SERVICE"
echo "→ Excluding:   $EXCLUDE_EMAILS"
if [ "$CONFIRM" = "YES" ]; then
  echo "→ Mode:        APPLY (passwords will be changed)"
else
  echo "→ Mode:        DRY RUN — nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.reset-staff-passwords.mjs"

# Written inside apps/api so bare imports (bcryptjs, @alma/db) resolve.
(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import bcrypt from 'bcryptjs';
import { prisma } from '@alma/db';

const APPLY = process.env.APPLY === 'YES';
const SUFFIX = process.env.PASSWORD_SUFFIX ?? '@lma2026';
const EXCLUDED = new Set(
  (process.env.EXCLUDE_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * The name someone types into the password box.
 *
 * Only the FIRST given name. Plenty of profiles carry two in the firstName
 * field — "Rodrigo Golcalves" folded to Rodrigogolcalves, which nobody is
 * typing at the start of a shift. Accents are folded and anything that is not
 * a letter is dropped for the same reason.
 *
 *   "Rodrigo Golcalves" -> Rodrigo      "Jose"       -> Jose
 *   "MARIA JOSE"        -> Maria        "anne-marie" -> Annemarie
 */
function passwordName(firstName) {
  const first = firstName.trim().split(/\s+/)[0] ?? '';
  const folded = first
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '');
  if (!folded) return null;
  return folded[0].toUpperCase() + folded.slice(1).toLowerCase();
}

const profiles = await prisma.staffProfile.findMany({
  where: {
    accountType: 'HUMAN',
    employmentStatus: 'ACTIVE',
    email: { not: null },
    mergedIntoStaffProfileId: null
  },
  select: { id: true, firstName: true, lastName: true, email: true, passwordHash: true },
  orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
});

const planned = [];
const skipped = [];

for (const profile of profiles) {
  const email = (profile.email ?? '').toLowerCase();
  if (EXCLUDED.has(email)) {
    skipped.push([`${profile.firstName} ${profile.lastName}`, profile.email, 'excluded']);
    continue;
  }
  const name = passwordName(profile.firstName);
  if (!name) {
    skipped.push([`${profile.firstName} ${profile.lastName}`, profile.email, 'no usable letters in first name']);
    continue;
  }
  planned.push({
    id: profile.id,
    firstName: profile.firstName,
    fullName: `${profile.firstName} ${profile.lastName}`,
    email: profile.email,
    name,
    changed: name !== profile.firstName,
    hadPassword: Boolean(profile.passwordHash)
  });
}

// Two people whose first names normalise the same way end up sharing a
// password. Worth seeing before you commit, not after.
const byName = new Map();
for (const row of planned) byName.set(row.name, (byName.get(row.name) ?? 0) + 1);
const collisions = [...byName.entries()].filter(([, count]) => count > 1);

const pad = (value, width) => String(value).padEnd(width);
console.log(pad('NAME', 26) + pad('EMAIL', 34) + pad('PASSWORD NAME', 16) + 'NOTE');
console.log('-'.repeat(92));
for (const row of planned) {
  const notes = [];
  if (row.changed) notes.push(`normalised from "${row.firstName}"`);
  if (!row.hadPassword) notes.push('had no password');
  if ((byName.get(row.name) ?? 0) > 1) notes.push('SHARED with another staff member');
  console.log(pad(row.fullName, 26) + pad(row.email, 34) + pad(row.name, 16) + notes.join('; '));
}

console.log();
console.log(`${planned.length} account(s) to change, ${skipped.length} skipped.`);
for (const [name, email, why] of skipped) console.log(`  skipped: ${name} <${email}> — ${why}`);
if (collisions.length > 0) {
  console.log();
  console.log('WARNING — these first names collide, so those staff would share a password:');
  for (const [name, count] of collisions) console.log(`  ${name}${SUFFIX} — ${count} people`);
}

if (!APPLY) {
  console.log();
  console.log('Dry run. Re-run with RESET_STAFF_PASSWORDS_CONFIRM=YES to apply.');
  await prisma.$disconnect();
  process.exit(0);
}

let changed = 0;
for (const row of planned) {
  const password = `${row.name}${SUFFIX}`;
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.staffProfile.update({ where: { id: row.id }, data: { passwordHash } });
  changed += 1;
  // Picked back up by the shell and written to a 0600 file on the host, so
  // the passwords land in one protected file instead of the scrollback.
  console.log(`CSVROW\t${row.fullName}\t${row.email}\t${password}`);
}

console.log();
console.log(`Changed ${changed} password(s).`);
await prisma.$disconnect();
JSEOF

RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT

set +e
(cd "$DEPLOY_DIR" && docker compose exec -T \
  -e APPLY="$([ "$CONFIRM" = "YES" ] && echo YES || echo NO)" \
  -e PASSWORD_SUFFIX="$PASSWORD_SUFFIX" \
  -e EXCLUDE_EMAILS="$EXCLUDE_EMAILS" \
  "$SERVICE" sh -c "cd /workspace/apps/api && node $SCRIPT_IN_CONTAINER") > "$RAW" 2>&1
STATUS=$?
set -e

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" rm -f "$SCRIPT_IN_CONTAINER") || true

# Everything except the credential rows goes to the screen.
grep -v $'^CSVROW\t' "$RAW" || true

if [ "$CONFIRM" = "YES" ] && grep -q $'^CSVROW\t' "$RAW"; then
  umask 077
  {
    echo "name,email,password"
    grep $'^CSVROW\t' "$RAW" | awk -F'\t' '{printf "\"%s\",\"%s\",\"%s\"\n", $2, $3, $4}'
  } > "$OUT_FILE"
  chmod 600 "$OUT_FILE"
  echo
  echo "→ Passwords written to $OUT_FILE (owner-only)."
  echo "  Hand them out, then delete it:  rm $OUT_FILE"
fi

exit "$STATUS"

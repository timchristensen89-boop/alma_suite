#!/usr/bin/env bash
set -euo pipefail

# Build and deploy suite frontends to Firebase Hosting.
#
# The frontends do not auto-deploy. A PR merged on GitHub reaches the venues
# only when somebody builds and runs `firebase deploy` from a Mac — and doing
# that by hand is six commands that all have to run from the repository root,
# which is where it keeps going wrong. Run from a home directory instead, the
# git commands fail, `pnpm install` walks the whole home folder until Node runs
# out of heap, and `firebase deploy` cannot find firebase.json. Every one of
# those is the same mistake wearing a different error message.
#
# This script finds the repository from its OWN location, so it does not matter
# where you run it from:
#
#   ~/alma_suite/scripts/deploy-frontends.sh
#       ...builds and deploys stock-web + the iPad dashboard.
#
#   ~/alma_suite/scripts/deploy-frontends.sh stock-web pos-web
#       ...just those. App names are the directory names under apps/.
#
#   BUILD_ONLY=YES ~/alma_suite/scripts/deploy-frontends.sh
#       ...build and stamp, deploy nothing.
#
# It pulls main first. Anything uncommitted in the working tree stops it,
# rather than shipping a build of code that is not on main.

# NOTE ON THE BRACES BELOW. Every variable expansion followed by a non-ASCII
# character in this file is written ${like_this}, and must stay that way. macOS
# still ships bash 3.2 as /bin/bash, and it folds the bytes of a multibyte
# character into the variable name: `echo "$app…"` looks up `app…`, which under
# `set -u` aborts the script with "app?: unbound variable". Braces end the name
# explicitly. `bash -n` does not catch it, because the parse is legal — it is
# the lookup that fails, and only at run time, on that bash.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Defaults are applied to the positional parameters BEFORE the array is built.
# On bash 3.2 (still what macOS ships) `${#APPS[@]}` against an array that was
# assigned from an empty "$@" is unreliable under `set -u`; `$#` is not.
if [ "$#" -eq 0 ]; then
  set -- stock-web venue-ipad-dashboard
fi
APPS=("$@")

echo "→ Repository: $ROOT"
echo "→ Apps:       ${APPS[*]}"
echo

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first — deploying a build of" >&2
  echo "uncommitted code makes the live version.json a lie about what is running." >&2
  git status --short >&2
  exit 1
fi

echo "→ Pulling main…"
git checkout main
git pull origin main
HEAD_SHORT="$(git rev-parse --short HEAD)"
echo "→ At $HEAD_SHORT"
echo

# Vite refuses to build without its production env, and those files are
# gitignored, so a fresh clone has none. They hold only public VITE_ URLs, so
# seeding them from the checked-in example is the right default — a venue URL
# is not a secret.
for app in "${APPS[@]}"; do
  if [ ! -f "apps/$app/.env.production" ] && [ -f "apps/$app/.env.production.example" ]; then
    cp "apps/$app/.env.production.example" "apps/$app/.env.production"
    echo "→ Seeded apps/$app/.env.production from the example"
  fi
done

echo "→ Installing…"
pnpm install

# @alma/shared first, always: every frontend imports it, and a stale dist is
# how a type or constant added in the same PR goes missing at runtime with no
# build error.
echo "→ Building @alma/shared…"
pnpm --filter @alma/shared build

for app in "${APPS[@]}"; do
  echo "→ Building ${app}…"
  pnpm --filter "@alma/$app" build
done

echo "→ Stamping dists with ${HEAD_SHORT}…"
node scripts/frontends-deploy-check.cjs stamp

if [ "${BUILD_ONLY:-NO}" = "YES" ]; then
  echo "✓ Built and stamped. BUILD_ONLY=YES, so nothing was deployed."
  exit 0
fi

# Firebase site names are not the app names; read the mapping out of
# firebase.json rather than keeping a second copy of it here.
TARGETS="$(node -e '
const fb = require("./firebase.json");
const apps = process.argv.slice(1);
const sites = [];
for (const app of apps) {
  const entry = fb.hosting.find((h) => h.public === `apps/${app}/dist`);
  if (!entry) {
    console.error(`No firebase.json hosting target for apps/${app}/dist`);
    process.exit(1);
  }
  sites.push(`hosting:${entry.site}`);
}
process.stdout.write(sites.join(","));
' "${APPS[@]}")"

echo "→ Deploying ${TARGETS}…"
firebase deploy --only "$TARGETS" --project alma-compliance

echo
echo "✓ Deployed $HEAD_SHORT. Check what is live with:"
echo "    node scripts/frontends-deploy-check.cjs"

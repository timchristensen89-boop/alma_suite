#!/usr/bin/env bash
set -euo pipefail

# Redeem, in the suite, every GiftUp redemption the suite has not recorded,
# treating GiftUp's RedemptionsExport CSV as the truth.
#
# Shell wrapper for apps/api/scripts/reconcile-giftup-redemptions.ts so it can
# run on the VPS, where node only exists inside the API container. The JS
# below is that script transpiled; see the .ts for how a card is judged.
#
# Copy the export to the VPS first (from your own machine):
#
#     scp ~/Downloads/RedemptionsExport-26-10-08-22-53-52.csv root@<vps>:/root/
#
# Then on the VPS — DRY RUN first, read it, then apply:
#
#     cd /opt/alma/alma-suite && ./scripts/reconcile-giftup-redemptions.sh /root/RedemptionsExport-26-10-08-22-53-52.csv
#     cd /opt/alma/alma-suite && GIFTUP_RECONCILE_CONFIRM=YES ./scripts/reconcile-giftup-redemptions.sh /root/RedemptionsExport-26-10-08-22-53-52.csv
#
# Optional: GIFTUP_RECONCILE_VENUE="Alma Avalon" to book GiftUp's "Alma Group"
# rows somewhere other than St Alma. Safe to run twice.

CSV="${1:-}"
if [ -z "$CSV" ] || [ ! -f "$CSV" ]; then
  echo "Usage: $0 <RedemptionsExport.csv>   (file not found: '${CSV}')" >&2
  exit 1
fi

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
CONFIRM="${GIFTUP_RECONCILE_CONFIRM:-NO}"
VENUE="${GIFTUP_RECONCILE_VENUE:-St Alma}"

SERVICE="${SERVICE:-}"
if [ -z "$SERVICE" ]; then
  SERVICE="$( (cd "$DEPLOY_DIR" && docker compose ps --services) | grep -E '^(suite-api|api)$' | head -1 || true )"
fi
if [ -z "$SERVICE" ]; then
  echo "Could not find the API service in $DEPLOY_DIR." >&2
  (cd "$DEPLOY_DIR" && docker compose ps --services) >&2
  echo "Re-run with SERVICE=<name>." >&2
  exit 1
fi

echo "→ API service: $SERVICE"
if [ "$CONFIRM" = "YES" ]; then
  echo "→ Mode:        APPLY — this writes redemptions to live gift cards"
else
  echo "→ Mode:        DRY RUN — nothing will be written"
fi
echo

SCRIPT_IN_CONTAINER="/workspace/apps/api/.giftup-reconcile.mjs"
CSV_IN_CONTAINER="/tmp/giftup-redemptions.csv"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $CSV_IN_CONTAINER") < "$CSV"

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" sh -c "cat > $SCRIPT_IN_CONTAINER") <<'JSEOF'
import { readFileSync } from "node:fs";
import { prisma } from "@alma/db";
const CONFIRM = process.env.GIFTUP_RECONCILE_CONFIRM === "YES";
const DEFAULT_VENUE = process.env.GIFTUP_RECONCILE_VENUE?.trim() || "St Alma";
const VENUES = ["St Alma", "Alma Avalon", "Functions / Pop-up"];
if (!VENUES.includes(DEFAULT_VENUE)) {
  console.error(`GIFTUP_RECONCILE_VENUE must be one of: ${VENUES.join(", ")}`);
  process.exit(1);
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map(
    (cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""]))
  );
}
function cents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}
function utcDate(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const date = /* @__PURE__ */ new Date(`${trimmed.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
const dollars = (value) => `$${(value / 100).toFixed(2)}`;
async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: node --import tsx scripts/reconcile-giftup-redemptions.ts <RedemptionsExport.csv>");
    process.exit(1);
  }
  const byCode = /* @__PURE__ */ new Map();
  let rowCount = 0;
  for (const path of paths) {
    for (const row of parseCsv(readFileSync(path, "utf8"))) {
      if ((row.EventTypeAsString ?? row.EventType) !== "Redeemed") continue;
      const code = (row.GiftCardCode ?? "").trim().toUpperCase();
      const amountCents = -cents(row.Value);
      const at = utcDate(row.EventOccuredOn || row.CreatedOn);
      if (!code || amountCents <= 0 || !at) continue;
      rowCount += 1;
      const venue = (row.LocationName ?? "").toLowerCase().includes("avalon") ? "Alma Avalon" : DEFAULT_VENUE;
      const list = byCode.get(code) ?? [];
      list.push({ amountCents, at, venue, raw: row.EventOccuredOn });
      byCode.set(code, list);
    }
  }
  const cards = await prisma.giftCard.findMany({
    where: { code: { in: [...byCode.keys()] } },
    include: { redemptions: { where: { status: "COMPLETED" } } }
  });
  const cardByCode = new Map(cards.map((card) => [card.code, card]));
  console.log(`Export: ${rowCount} redemptions across ${byCode.size} cards. ${cards.length} of those cards are in the suite.`);
  console.log(`Venue for "Alma Group" rows: ${DEFAULT_VENUE}`);
  console.log("");
  let inSync = 0;
  let notInSuite = 0;
  const review = [];
  const plan = [];
  for (const [code, rows] of byCode) {
    const card = cardByCode.get(code);
    if (!card) {
      notInSuite += 1;
      continue;
    }
    const giftUpCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    const suiteCents = card.initialValueCents - card.balanceCents;
    const shortfall = giftUpCents - suiteCents;
    const native = card.redemptions.filter((r) => !(r.notes ?? "").startsWith("GiftUp reconciliation"));
    if (card.promoCodeSnapshot !== "GIFTUP_IMPORT") {
      review.push(`${code}: in the suite but not a GiftUp import (${card.promoCodeSnapshot ?? "no marker"}) \u2014 not touched.`);
      continue;
    }
    if (shortfall <= 0) {
      inSync += 1;
      if (native.length > 0 && shortfall < 0) {
        review.push(
          `${code}: suite has redeemed ${dollars(-shortfall)} more than GiftUp (${native.length} suite redemption(s)) \u2014 not touched.`
        );
      }
      continue;
    }
    if (card.status !== "ACTIVE") {
      review.push(`${code}: GiftUp shows ${dollars(shortfall)} more redeemed, but the suite card is ${card.status} \u2014 not touched.`);
      continue;
    }
    const sorted = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());
    const chosen = [];
    let remaining = Math.min(shortfall, card.balanceCents);
    for (const row of sorted) {
      if (remaining <= 0) break;
      const amount = Math.min(row.amountCents, remaining);
      chosen.push({ ...row, amountCents: amount });
      remaining -= amount;
    }
    const total = chosen.reduce((sum, row) => sum + row.amountCents, 0);
    if (shortfall > card.balanceCents) {
      review.push(
        `${code}: GiftUp shows ${dollars(shortfall)} unrecorded but the suite balance is only ${dollars(card.balanceCents)} \u2014 redeeming the balance to zero.`
      );
    }
    if (native.length > 0) {
      review.push(
        `${code}: also has ${native.length} suite-native redemption(s) \u2014 check the till: one may be the same spend recorded twice, or a second spend.`
      );
    }
    plan.push({ cardId: card.id, code, rows: chosen, totalCents: total });
  }
  console.log(`In sync: ${inSync} cards.  Not in suite: ${notInSuite} (fully spent before import or never imported).`);
  console.log(`To redeem: ${plan.length} cards, ${dollars(plan.reduce((s, p) => s + p.totalCents, 0))}.`);
  console.log("");
  for (const item of plan) {
    for (const row of item.rows) {
      console.log(`  ${item.code.padEnd(8)} ${dollars(row.amountCents).padStart(10)}  ${row.raw} UTC  \u2192 ${row.venue}`);
    }
  }
  if (review.length > 0) {
    console.log("");
    console.log("Review by hand:");
    for (const line of review) console.log(`  ${line}`);
  }
  const recentCutoff = Date.now() - 60 * 24 * 60 * 60 * 1e3;
  const recentMissing = [...byCode.entries()].filter(([code, rows]) => !cardByCode.has(code) && rows.some((r) => r.at.getTime() >= recentCutoff)).map(([code]) => code);
  if (recentMissing.length > 0) {
    console.log("");
    console.log(`Redeemed in GiftUp in the last 60 days but NOT in the suite: ${recentMissing.join(", ")}`);
  }
  if (!CONFIRM) {
    console.log("");
    console.log("DRY RUN \u2014 nothing written. Set GIFTUP_RECONCILE_CONFIRM=YES to redeem.");
    return;
  }
  let written = 0;
  let failed = 0;
  for (const item of plan) {
    try {
      await prisma.$transaction(async (tx) => {
        const decrement = await tx.giftCard.updateMany({
          where: {
            id: item.cardId,
            status: "ACTIVE",
            balanceCents: { gte: item.totalCents },
            OR: [{ allocationStatus: null }, { allocationStatus: "ALLOCATED" }]
          },
          data: { balanceCents: { decrement: item.totalCents } }
        });
        if (decrement.count === 0) throw new Error("balance changed since the dry run");
        for (const row of item.rows) {
          await tx.giftCardRedemption.create({
            data: {
              giftCardId: item.cardId,
              amountCents: row.amountCents,
              venue: row.venue,
              notes: `GiftUp reconciliation: redeemed in GiftUp ${row.raw} UTC`,
              redeemedById: null,
              redeemedAt: row.at
            }
          });
        }
        const after = await tx.giftCard.findUniqueOrThrow({ where: { id: item.cardId }, select: { balanceCents: true } });
        if (after.balanceCents === 0) {
          await tx.giftCard.update({ where: { id: item.cardId }, data: { status: "REDEEMED" } });
        }
      });
      written += 1;
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${item.code}:`, error instanceof Error ? error.message : error);
    }
  }
  console.log("");
  console.log(`Redeemed ${written} cards, ${failed} failed.`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
JSEOF

set +e
(cd "$DEPLOY_DIR" && docker compose exec -T \
  -e GIFTUP_RECONCILE_CONFIRM="$([ "$CONFIRM" = "YES" ] && echo YES || echo NO)" \
  -e GIFTUP_RECONCILE_VENUE="$VENUE" \
  "$SERVICE" sh -c "cd /workspace/apps/api && node $SCRIPT_IN_CONTAINER $CSV_IN_CONTAINER")
STATUS=$?
set -e

(cd "$DEPLOY_DIR" && docker compose exec -T "$SERVICE" rm -f "$SCRIPT_IN_CONTAINER" "$CSV_IN_CONTAINER") || true
exit "$STATUS"

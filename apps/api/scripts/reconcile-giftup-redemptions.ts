import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';

// Bring the suite's imported GiftUp cards into line with GiftUp's redemption
// history, treating GiftUp as the truth.
//
// The GiftUp import (import-giftup-cards.ts) created each card with its
// balance AS AT the export, and no redemption rows. Staff then kept redeeming
// some cards in GiftUp, so those cards still carry money in the suite that the
// guest has already spent.
//
// Input is GiftUp's "RedemptionsExport-*.csv" (one row per redemption: Value is
// negative, GiftCardCode, EventOccuredOn in UTC, LocationName).
//
//   node --import tsx scripts/reconcile-giftup-redemptions.ts ~/Downloads/RedemptionsExport-26-10-08-22-53-52.csv
//
// HOW A CARD IS JUDGED (no date cutoff — the export's timezone is ambiguous):
//   GiftUp redeemed  = Σ |Value| over every row for the card in the export.
//   Suite redeemed   = initialValueCents − balanceCents.
//   Shortfall        = GiftUp redeemed − suite redeemed.
// Redemptions GiftUp made before the import are already inside the imported
// balance, so they cancel out; only money GiftUp took that the suite has not
// is left. A shortfall > 0 is redeemed in the suite; anything else is left
// alone. Re-running after a write finds a zero shortfall, so it is idempotent.
//
// The shortfall is written as one redemption per missing GiftUp row, newest
// rows first (oldest rows are the ones most likely already in the imported
// balance), each back-dated to its GiftUp timestamp so the venue-month ledger
// books it in the month the guest actually spent it.
//
// SAFETY:
//  - DRY RUN by default — set GIFTUP_RECONCILE_CONFIRM=YES to write.
//  - Only GIFTUP_IMPORT cards are touched. Codes not in the suite are reported.
//  - Same atomic, conditional decrement as giftCardService.redeem: a card
//    whose balance moved mid-run is skipped, never driven negative.
//  - A card that ALSO has suite-native redemptions is reported for review:
//    a suite redemption the guest made at the till can mask a missing GiftUp
//    one, and the shortfall alone cannot tell the two apart.
//
// Venue: GiftUp's "Alma Group" location is not a venue. Set
// GIFTUP_RECONCILE_VENUE to choose where those redemptions are booked
// (default "St Alma"); "Alma Avalon" rows always go to Alma Avalon.

const CONFIRM = process.env.GIFTUP_RECONCILE_CONFIRM === 'YES';
const DEFAULT_VENUE = process.env.GIFTUP_RECONCILE_VENUE?.trim() || 'St Alma';
const VENUES = ['St Alma', 'Alma Avalon', 'Functions / Pop-up'];
if (!VENUES.includes(DEFAULT_VENUE)) {
  console.error(`GIFTUP_RECONCILE_VENUE must be one of: ${VENUES.join(', ')}`);
  process.exit(1);
}

// Same quote-aware parser as import-giftup-cards.ts, plus a BOM strip.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = text.replace(/^﻿/, '');
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
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);

  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']))
  );
}

function cents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

// GiftUp exports timestamps as "YYYY-MM-DD HH:MM:SS" in UTC.
function utcDate(value: string): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dollars = (value: number) => `$${(value / 100).toFixed(2)}`;

type GiftUpRedemption = { amountCents: number; at: Date; venue: string; raw: string };

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: node --import tsx scripts/reconcile-giftup-redemptions.ts <RedemptionsExport.csv>');
    process.exit(1);
  }

  const byCode = new Map<string, GiftUpRedemption[]>();
  let rowCount = 0;
  for (const path of paths) {
    for (const row of parseCsv(readFileSync(path, 'utf8'))) {
      if ((row.EventTypeAsString ?? row.EventType) !== 'Redeemed') continue;
      const code = (row.GiftCardCode ?? '').trim().toUpperCase();
      const amountCents = -cents(row.Value);
      const at = utcDate(row.EventOccuredOn || row.CreatedOn);
      if (!code || amountCents <= 0 || !at) continue;
      rowCount += 1;
      const venue = (row.LocationName ?? '').toLowerCase().includes('avalon') ? 'Alma Avalon' : DEFAULT_VENUE;
      const list = byCode.get(code) ?? [];
      list.push({ amountCents, at, venue, raw: row.EventOccuredOn });
      byCode.set(code, list);
    }
  }

  const cards = await prisma.giftCard.findMany({
    where: { code: { in: [...byCode.keys()] } },
    include: { redemptions: { where: { status: 'COMPLETED' } } }
  });
  const cardByCode = new Map(cards.map((card) => [card.code, card]));

  console.log(`Export: ${rowCount} redemptions across ${byCode.size} cards. ${cards.length} of those cards are in the suite.`);
  console.log(`Venue for "Alma Group" rows: ${DEFAULT_VENUE}`);
  console.log('');

  let inSync = 0;
  let notInSuite = 0;
  const review: string[] = [];
  const plan: Array<{ cardId: string; code: string; rows: GiftUpRedemption[]; totalCents: number }> = [];

  for (const [code, rows] of byCode) {
    const card = cardByCode.get(code);
    if (!card) {
      // Fully spent before the import (only Active cards were imported), or
      // a card that never came across. Only the second matters.
      notInSuite += 1;
      continue;
    }
    const giftUpCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    const suiteCents = card.initialValueCents - card.balanceCents;
    const shortfall = giftUpCents - suiteCents;
    const native = card.redemptions.filter((r) => !(r.notes ?? '').startsWith('GiftUp reconciliation'));

    if (card.promoCodeSnapshot !== 'GIFTUP_IMPORT') {
      review.push(`${code}: in the suite but not a GiftUp import (${card.promoCodeSnapshot ?? 'no marker'}) — not touched.`);
      continue;
    }
    if (shortfall <= 0) {
      inSync += 1;
      if (native.length > 0 && shortfall < 0) {
        review.push(
          `${code}: suite has redeemed ${dollars(-shortfall)} more than GiftUp (${native.length} suite redemption(s)) — not touched.`
        );
      }
      continue;
    }
    if (card.status !== 'ACTIVE') {
      review.push(`${code}: GiftUp shows ${dollars(shortfall)} more redeemed, but the suite card is ${card.status} — not touched.`);
      continue;
    }

    // Take GiftUp rows newest first until the shortfall is covered. A row
    // that only partly fits is trimmed to what is left.
    const sorted = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());
    const chosen: GiftUpRedemption[] = [];
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
        `${code}: GiftUp shows ${dollars(shortfall)} unrecorded but the suite balance is only ${dollars(card.balanceCents)} — redeeming the balance to zero.`
      );
    }
    if (native.length > 0) {
      review.push(
        `${code}: also has ${native.length} suite-native redemption(s) — check the till: one may be the same spend recorded twice, or a second spend.`
      );
    }
    plan.push({ cardId: card.id, code, rows: chosen, totalCents: total });
  }

  console.log(`In sync: ${inSync} cards.  Not in suite: ${notInSuite} (fully spent before import or never imported).`);
  console.log(`To redeem: ${plan.length} cards, ${dollars(plan.reduce((s, p) => s + p.totalCents, 0))}.`);
  console.log('');
  for (const item of plan) {
    for (const row of item.rows) {
      console.log(`  ${item.code.padEnd(8)} ${dollars(row.amountCents).padStart(10)}  ${row.raw} UTC  → ${row.venue}`);
    }
  }
  if (review.length > 0) {
    console.log('');
    console.log('Review by hand:');
    for (const line of review) console.log(`  ${line}`);
  }

  // Codes redeemed in GiftUp in the last 60 days that the suite doesn't have —
  // a card sold in GiftUp after the import would land here.
  const recentCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const recentMissing = [...byCode.entries()]
    .filter(([code, rows]) => !cardByCode.has(code) && rows.some((r) => r.at.getTime() >= recentCutoff))
    .map(([code]) => code);
  if (recentMissing.length > 0) {
    console.log('');
    console.log(`Redeemed in GiftUp in the last 60 days but NOT in the suite: ${recentMissing.join(', ')}`);
  }

  if (!CONFIRM) {
    console.log('');
    console.log('DRY RUN — nothing written. Set GIFTUP_RECONCILE_CONFIRM=YES to redeem.');
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
            status: 'ACTIVE',
            balanceCents: { gte: item.totalCents },
            OR: [{ allocationStatus: null }, { allocationStatus: 'ALLOCATED' }]
          },
          data: { balanceCents: { decrement: item.totalCents } }
        });
        if (decrement.count === 0) throw new Error('balance changed since the dry run');
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
          await tx.giftCard.update({ where: { id: item.cardId }, data: { status: 'REDEEMED' } });
        }
      });
      written += 1;
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${item.code}:`, error instanceof Error ? error.message : error);
    }
  }
  console.log('');
  console.log(`Redeemed ${written} cards, ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

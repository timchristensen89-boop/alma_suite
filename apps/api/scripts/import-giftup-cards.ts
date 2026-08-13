import { readFileSync } from 'node:fs';
import { prisma } from '@alma/db';

// Import GiftUp's outstanding gift cards into the suite ledger, preserving each
// card's ORIGINAL code, balance and gift message so guests notice nothing when
// the storefront flips off GiftUp.
//
// Input is GiftUp's card-level "GiftCardsExport-*.csv" (Manage cards → Export):
// one row per card with Status, RemainingBalance, InitialBalance, Placed,
// FulfilledOn and Message. Only Status=Active rows with a positive balance are
// imported. (Verified 2026-08-14 against the full TransactionsExport event
// ledger: 524 active cards, $64,913.64, zero balance mismatches between the
// two exports.)
//
//   node --import tsx scripts/import-giftup-cards.ts ~/Downloads/GiftCardsExport-26-08-14-08-05-11.csv
//
// SAFETY:
//  - DRY RUN by default — set GIFTUP_IMPORT_CONFIRM=YES to write.
//  - Idempotent: a code already in the suite is skipped and reported, never
//    updated — re-running after a partial failure only fills the gaps.
//  - Imported cards get expiresAt: null. GiftUp never set an expiry on these
//    cards (ExpiresOn is blank on every row), and shortening an already-sold
//    card's life is not ours to do.
//  - paidAt is back-filled from the card's Placed timestamp. The suite gates
//    print/wallet/redeem on paidAt + ACTIVE + balance > 0, so a null paidAt
//    would strand every imported card.

const CONFIRM = process.env.GIFTUP_IMPORT_CONFIRM === 'YES';

// Minimal quote-aware CSV parser — GiftUp quotes fields that contain commas
// (names, messages, "$1,000 Gift Card") and doubles embedded quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
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
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
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

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('Usage: node --import tsx scripts/import-giftup-cards.ts <GiftCardsExport.csv> [...]');
    process.exit(1);
  }

  const byCode = new Map<string, Record<string, string>>();
  for (const path of paths) {
    for (const row of parseCsv(readFileSync(path, 'utf8'))) {
      const code = (row.Code ?? '').trim().toUpperCase();
      if (code) byCode.set(code, row); // later files win on duplicates
    }
  }

  const importable = [...byCode.values()]
    .filter((row) => row.Status === 'Active' && cents(row.RemainingBalance) > 0)
    .sort((a, b) => (a.Placed ?? '').localeCompare(b.Placed ?? ''));

  const totalBalance = importable.reduce((sum, row) => sum + cents(row.RemainingBalance), 0);
  console.log(`Export: ${byCode.size} cards.`);
  console.log(
    `Importable (Active, balance > 0): ${importable.length} cards, ` +
      `$${(totalBalance / 100).toFixed(2)} outstanding.`
  );

  let created = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (const row of importable) {
    const code = row.Code.trim().toUpperCase();
    const balanceCents = cents(row.RemainingBalance);
    const placedAt = utcDate(row.Placed);
    if (!placedAt) {
      failed += 1;
      console.error(`  FAIL ${code}: no usable Placed timestamp ("${row.Placed}")`);
      continue;
    }

    const existing = await prisma.giftCard.findUnique({
      where: { code },
      select: { id: true, balanceCents: true }
    });
    if (existing) {
      skippedExisting += 1;
      if (existing.balanceCents !== balanceCents) {
        console.warn(
          `  SKIP ${code}: already in suite with balance ` +
            `$${(existing.balanceCents / 100).toFixed(2)} vs GiftUp $${(balanceCents / 100).toFixed(2)} — reconcile by hand.`
        );
      }
      continue;
    }

    if (!CONFIRM) continue;

    try {
      await prisma.giftCard.create({
        data: {
          code,
          status: 'ACTIVE',
          initialValueCents: cents(row.InitialBalance),
          balanceCents,
          discountCents: 0,
          amountPaidCents: cents(row.InitialBalance),
          currency: 'aud',
          purchaserName: row.PurchaserName?.trim() || 'GiftUp import',
          purchaserEmail: row.PurchaserEmail?.trim().toLowerCase() || 'giftup-import@almagroup.com.au',
          recipientName: row.RecipientName?.trim() || null,
          recipientEmail: row.RecipientEmail?.trim().toLowerCase() || null,
          message: row.Message?.trim() || null,
          design: null,
          // Same marker pattern as PHYSICAL_COUNTER — makes the import cohort
          // trivially identifiable in reports and reversible if it came to it.
          promoCodeSnapshot: 'GIFTUP_IMPORT',
          testMode: false,
          // Unique per card and stable across re-runs, so a partial import
          // can never double-create.
          stripeCheckoutSessionId: `giftup:${code}`,
          paidAt: placedAt,
          // GiftUp already delivered these cards — nothing should email them.
          emailedAt: utcDate(row.FulfilledOn) ?? placedAt,
          saleChannel: 'ONLINE',
          tender: 'STRIPE',
          tenderReference: 'GiftUp',
          expiresAt: null
        }
      });
      created += 1;
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${code}:`, error instanceof Error ? error.message : error);
    }
  }

  if (!CONFIRM) {
    console.log(
      `DRY RUN — nothing written. ${skippedExisting} already in the suite. ` +
        'Set GIFTUP_IMPORT_CONFIRM=YES to import.'
    );
  } else {
    console.log(`Created ${created}, skipped ${skippedExisting} existing, ${failed} failed.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

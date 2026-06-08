import { prisma } from '@alma/db';
import { normaliseSupplierName } from '@alma/shared';

// Merge duplicate Supplier rows that share a canonical name (punctuation/space
// insensitive). Survivor = the most-complete row. Field rules (per owner):
//   • email differs        → keep survivor's; the other is appended to notes
//                            as "Alt email: …" (kept, not lost)
//   • account number differs → DO NOT merge the group; mark for review and
//                            report each row's pending (unpaid) invoices
//   • payment terms differ → merge but NEVER change the survivor's terms; flag
//   • other blank fields   → backfilled from a duplicate (most-complete merge)
// All SupplierInvoice + StockDeliveryCheck rows are reassigned to the survivor.
//
// DRY RUN by default — set SUPPLIER_MERGE_CONFIRM=YES to write.
//   ./scripts/merge-duplicate-suppliers.sh
//   SUPPLIER_MERGE_CONFIRM=YES ./scripts/merge-duplicate-suppliers.sh

const CONFIRM = process.env.SUPPLIER_MERGE_CONFIRM === 'YES';
const PENDING_STATUSES = ['AUTHORISED', 'SUBMITTED'];
const FILL_FIELDS = ['contactName', 'phone', 'website', 'address'] as const;

const txt = (v: unknown) => String(v ?? '').trim();
const email = (v: unknown) => txt(v).toLowerCase();
function completeness(s: Record<string, unknown>): number {
  return ['contactName', 'email', 'phone', 'website', 'address', 'accountNumber', 'paymentTerms', 'notes'].filter(
    (f) => txt(s[f])
  ).length;
}

async function main() {
  const suppliers = await prisma.supplier.findMany({
    select: {
      id: true, name: true, contactName: true, email: true, phone: true, website: true,
      address: true, accountNumber: true, paymentTerms: true, notes: true, createdAt: true,
      _count: { select: { invoices: true, deliveryChecks: true } }
    }
  });

  const groups = new Map<string, typeof suppliers>();
  for (const s of suppliers) {
    const key = normaliseSupplierName(s.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  type Merge = { survivor: typeof suppliers[number]; dups: typeof suppliers[number][]; patch: Record<string, string>; altEmails: string[]; flags: string[] };
  const merges: Merge[] = [];
  const review: { key: string; list: typeof suppliers }[] = [];

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const accounts = new Set(list.map((s) => txt(s.accountNumber)).filter(Boolean));
    if (accounts.size > 1) { review.push({ key, list }); continue; } // account conflict → review, don't merge

    const sorted = [...list].sort(
      (a, b) =>
        completeness(b) - completeness(a) ||
        b._count.invoices + b._count.deliveryChecks - (a._count.invoices + a._count.deliveryChecks) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    );
    const survivor = sorted[0]!;
    const dups = sorted.slice(1);
    const patch: Record<string, string> = {};
    const altEmails: string[] = [];
    const flags: string[] = [];

    for (const dup of dups) {
      for (const f of FILL_FIELDS) {
        if (!txt(survivor[f]) && txt(dup[f]) && !patch[f]) patch[f] = txt(dup[f]);
      }
      if (!txt(survivor.accountNumber) && txt(dup.accountNumber) && !patch.accountNumber) patch.accountNumber = txt(dup.accountNumber);
      // email
      if (txt(dup.email)) {
        if (!txt(survivor.email) && !patch.email) patch.email = txt(dup.email);
        else if (email(dup.email) !== email(patch.email ?? survivor.email)) altEmails.push(txt(dup.email));
      }
      // payment terms — never change survivor's; backfill only if blank
      if (txt(dup.paymentTerms)) {
        if (!txt(survivor.paymentTerms) && !patch.paymentTerms) patch.paymentTerms = txt(dup.paymentTerms);
        else if (txt(dup.paymentTerms) !== txt(survivor.paymentTerms ?? patch.paymentTerms))
          flags.push(`terms differ: kept "${txt(survivor.paymentTerms ?? patch.paymentTerms)}", ignored "${txt(dup.paymentTerms)}"`);
      }
    }
    if (altEmails.length) flags.push(`alt email(s) → notes: ${altEmails.join(', ')}`);
    merges.push({ survivor, dups, patch, altEmails, flags });
  }

  console.log(`\nSuppliers: ${suppliers.length} · duplicate groups to merge: ${merges.length} · flagged for review (account conflict): ${review.length}`);

  console.log('\n=== MERGES (survivor ← duplicates) ===');
  for (const m of merges) {
    console.log(`  «${m.survivor.name}»  ← ${m.dups.map((d) => `${d.name} (${d._count.invoices}inv/${d._count.deliveryChecks}del)`).join(' | ')}`);
    for (const f of m.flags) console.log(`      ⚑ ${f}`);
  }

  if (review.length) {
    console.log('\n=== FLAGGED — account number differs, NOT merged (review manually) ===');
    for (const r of review) {
      const pending = await prisma.supplierInvoice.count({ where: { supplierId: { in: r.list.map((s) => s.id) }, status: { in: PENDING_STATUSES as never } } });
      console.log(`  ${r.list.map((s) => `${s.name} [acct ${txt(s.accountNumber) || '—'}]`).join('  vs  ')}  · ${pending} pending invoice(s)`);
    }
  }

  if (!CONFIRM) {
    console.log(`\nDRY RUN — nothing changed. To apply: SUPPLIER_MERGE_CONFIRM=YES ./scripts/merge-duplicate-suppliers.sh`);
    await prisma.$disconnect();
    return;
  }

  let merged = 0;
  for (const m of merges) {
    await prisma.$transaction(async (tx) => {
      for (const dup of m.dups) {
        await tx.supplierInvoice.updateMany({ where: { supplierId: dup.id }, data: { supplierId: m.survivor.id } });
        await tx.stockDeliveryCheck.updateMany({ where: { supplierId: dup.id }, data: { supplierId: m.survivor.id } });
      }
      const notes = [txt(m.survivor.notes), ...m.altEmails.map((e) => `Alt email: ${e}`)].filter(Boolean).join(' · ') || null;
      await tx.supplier.update({ where: { id: m.survivor.id }, data: { ...m.patch, notes } });
      await tx.supplier.deleteMany({ where: { id: { in: m.dups.map((d) => d.id) } } });
      merged += m.dups.length;
    });
  }
  console.log(`\n✅ Merged ${merged} duplicate suppliers into ${merges.length} survivors. ${review.length} group(s) left for manual review.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

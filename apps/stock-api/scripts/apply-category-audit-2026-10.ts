/**
 * Category corrections from the October 2026 stock audit.
 *
 * Only the moves a venue manager would agree with on sight: tequilas filed
 * under "Spirits — Other", syrups under "Liqueurs", dried chillies under
 * "Produce". Nothing is merged, renamed or deleted here — duplicates and
 * naming are listed for review in docs/stock-count-audit-2026-10.md.
 *
 * Dry run by default; `--apply` writes. Every move checks the item is still
 * where the audit found it (same name, same category) before touching it,
 * so a catalogue that has moved on since is left alone and reported.
 *
 *   DATABASE_URL=… ./apps/stock-api/node_modules/.bin/tsx apps/stock-api/scripts/apply-category-audit-2026-10.ts
 *   DATABASE_URL=… ./apps/stock-api/node_modules/.bin/tsx apps/stock-api/scripts/apply-category-audit-2026-10.ts --apply
 */
import { prisma } from '@alma/db';

type Move = { id: string; name: string; from: string | null; to: string; why: string };

const TEQUILA = 'Spirits — Tequila & Mezcal';
const MOVES: Move[] = [
  // Agave spirits filed under Spirits — Other by the 3 Aug 2026 import.
  ...[
    'cmsdf10pr008fmiio3kzyqh72', 'cmsdf10qh008rmiioa42wvk7i', 'cmsdf10qp008xmiiossa0j9qq', 'cmsdf10qy0093miiou0t2xgs8',
    'cmsdf10re009fmiio6jfpteha', 'cmsdf10rw009rmiioi52w7q63', 'cmsdf10s3009xmiio9qzu4kni', 'cmsdf10sc00a3miio2f92xj98',
    'cmsdf10sk00a9miiot0xezhg3', 'cmsdf10st00afmiio81ozy5zv', 'cmsdf10t200almiio3hhg2qb1', 'cmsdf10ua00bfmiio8z9o0rzf',
    'cmsdf10uh00blmiio7jcruybj', 'cmsdf10ux00bxmiiosyc7g5ac', 'cmsdf10wb00cxmiiozjcangrn', 'cmsdf10wz00dfmiiofgmeq8wa',
    'cmsdf10x900dlmiioc9on3c6z', 'cmsdf10xj00drmiio7if3hegd', 'cmsdf10xt00dxmiiojavtjmsw'
  ].map((id) => ({ id, name: '', from: 'Spirits — Other', to: TEQUILA, why: 'tequila / mezcal filed under Spirits — Other' })),
  { id: 'cmsdf10eo000xmiio3su1xxt1', name: 'Rhubarb Grapefruit Paloma', from: 'Beer & Cider', to: TEQUILA, why: 'tequila batch cocktail, sits with the margarita keg' },
  { id: 'cmsdf10ac0009miiooz0labvx', name: 'ADG 20L Cube', from: 'Beer & Cider', to: 'Spirits — Other', why: '40% ABV gin cube is a spirit, not a beer' },
  { id: 'cmsdf10ee000rmiiovvs8b9iq', name: 'empty bottles', from: 'Beer & Cider', to: 'Other', why: 'packaging, not a drink' },
  { id: 'cmoqfbq7w00eu9ky2gcs0n6ja', name: "Lyre's White Cane", from: 'Spirits — Other', to: 'Non-Alcoholic & Mixers', why: 'non-alcoholic spirit' },
  { id: 'cmoqfbq7100es9ky295pz087i', name: "Lyre's Triple Sec", from: 'Liqueurs & Aperitifs', to: 'Non-Alcoholic & Mixers', why: 'non-alcoholic spirit' },
  { id: 'cmsdf10g1001rmiiowqgdccbj', name: 'Giffard strawberry syrup', from: 'Liqueurs & Aperitifs', to: 'Non-Alcoholic & Mixers', why: 'syrup, not a liqueur' },
  { id: 'cmoqfbp8b00ck9ky299ayujyi', name: 'Giffard strawberry syrup', from: 'Produce', to: 'Non-Alcoholic & Mixers', why: 'syrup, not a liqueur' },
  { id: 'cmoqfbpi700d69ky2f8gje5og', name: 'Herradura agave nectar', from: 'Oils & Condiments', to: 'Non-Alcoholic & Mixers', why: 'sweetener, not a spirit' },
  { id: 'cmoqfbtf400m49ky2a0orrz04', name: 'Triple SEC 20L', from: 'Spirits', to: 'Liqueurs & Aperitifs', why: 'the only item in the legacy "Spirits" category; it is a liqueur' },
  { id: 'cmoqfbm58005i9ky2i8jc8sy9', name: 'Billecart-Salmon Rosé', from: 'Wine — Rosé', to: 'Wine — Sparkling', why: 'champagne' },
  { id: 'cmoqfbmrs006y9ky2jknan3jn', name: 'Celery', from: 'Other', to: 'Produce', why: 'fresh vegetable' },
  { id: 'cmoqfbrmm00i29ky2e6zhjbll', name: 'Pepitas', from: 'Other', to: 'Dry / Pantry', why: 'dry goods' },
  { id: 'cmoqfbu2s00nm9ky2obvg1wm5', name: 'Cascabel', from: 'Other', to: 'Dry / Pantry', why: 'dried chilli' },
  { id: 'cmoqfbn2h007m9ky23kc27jqf', name: 'Morita', from: 'Produce', to: 'Dry / Pantry', why: 'dried chilli' },
  { id: 'cmoqfbt6e00lk9ky2s49xhsub', name: 'Tomatillo', from: 'Produce', to: 'Dry / Pantry', why: 'tinned' },
  { id: 'cmptowb6i00tas601fb42rtbn', name: 'Tomatillo', from: 'Produce', to: 'Dry / Pantry', why: 'tinned' },
  { id: 'cmoqfbtbn00lw9ky2oy3ilcko', name: 'Mutti pelati', from: 'Produce', to: 'Dry / Pantry', why: 'tinned tomatoes' },
  { id: 'cmoqfbqc900f49ky2w05b2hki', name: 'Maseca', from: 'Bakery', to: 'Dry / Pantry', why: 'masa flour' },
  { id: 'cmoqfbn51007s9ky24h5tiwej', name: 'Chipotle in adobo', from: 'Produce', to: 'Oils & Condiments', why: 'condiment' },
  { id: 'cmsdf12t70016mij91xsikjsq', name: 'Pomace oil', from: 'Dry / Pantry', to: 'Oils & Condiments', why: 'oil' },
  { id: 'cmsdf12vb002imij9keor7liy', name: 'White wine vinegar', from: 'Dry / Pantry', to: 'Oils & Condiments', why: 'vinegar' },
  { id: 'cmptowatg00qvs601oasi3tiy', name: 'Coriander Ground', from: 'Produce', to: 'Herbs & Spices', why: 'spice' },
  { id: 'cmptowbm700w1s601v69vps2z', name: 'Thyme Dried', from: 'Dry / Pantry', to: 'Herbs & Spices', why: 'herb' },
  { id: 'cmsdf12sy0010mij9lyo56458', name: 'Garlic Powder', from: 'Dry / Pantry', to: 'Herbs & Spices', why: 'spice' },
  { id: 'cmsdf12th001cmij97z2i2rgw', name: 'Onion Powder', from: 'Dry / Pantry', to: 'Herbs & Spices', why: 'spice' },
  { id: 'cmsdf12tr001imij9wegfg9q4', name: 'Paprika Smoked', from: 'Dry / Pantry', to: 'Herbs & Spices', why: 'spice' }
];

async function main() {
  const apply = process.argv.includes('--apply');
  const categories = await prisma.stockCategory.findMany({ select: { id: true, name: true } });
  const byName = new Map(categories.map((category) => [category.name, category.id]));
  const items = await prisma.stockItem.findMany({
    where: { id: { in: MOVES.map((move) => move.id) } },
    select: { id: true, name: true, status: true, category: { select: { name: true } } }
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  let moved = 0;
  let skipped = 0;
  for (const move of MOVES) {
    const item = byId.get(move.id);
    const target = byName.get(move.to);
    if (!item) {
      console.log(`SKIP ${move.id} — not found`);
      skipped += 1;
      continue;
    }
    if (!target) {
      console.log(`SKIP ${item.name} — category "${move.to}" does not exist`);
      skipped += 1;
      continue;
    }
    const current = item.category?.name ?? null;
    if (current === move.to) {
      console.log(`OK   ${item.name} — already in ${move.to}`);
      continue;
    }
    // The audit named the category it found each item in; a different one
    // now means somebody has already acted, and this script must not undo it.
    if (current !== move.from) {
      console.log(`SKIP ${item.name} — expected in "${move.from}", found in "${current ?? 'none'}"`);
      skipped += 1;
      continue;
    }
    console.log(`${apply ? 'MOVE' : 'plan'} ${item.name}: ${current ?? '(uncategorised)'} → ${move.to}  (${move.why})`);
    if (apply) {
      await prisma.stockItem.update({ where: { id: item.id }, data: { categoryId: target } });
    }
    moved += 1;
  }
  console.log(`\n${apply ? 'Moved' : 'Would move'} ${moved} item${moved === 1 ? '' : 's'}; skipped ${skipped}.${apply ? '' : ' Re-run with --apply to write.'}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

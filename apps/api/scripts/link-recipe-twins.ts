import { prisma } from '@alma/db';

// Link venue-twin recipes to a canonical member of their group.
//
// The catalogue is duplicated per venue — 165 title groups exist once per
// venue under different ids (57% of the active catalogue, measured
// 2026-08-15). Nothing merges here: each twin keeps its own ingredients,
// price and history. The OLDER recipe of a pair becomes canonical (it keeps
// canonicalId null); the newer twin points at it. The POS and mapping
// resolution then follow the link instead of matching titles at runtime.
//
//   node --import tsx scripts/link-recipe-twins.ts          # dry run
//   node --import tsx scripts/link-recipe-twins.ts --apply
//
// SAFETY:
//  - Only ACTIVE recipes are considered.
//  - Only clean pairs are linked: exactly two members, one per venue.
//    Groups of 3+, same-venue duplicates, or groups already partly linked
//    elsewhere are PRINTED for review and left alone.
//  - Idempotent: existing correct links are skipped; a link that disagrees
//    with the computed pairing is reported, never overwritten.

const CONFIRM = process.argv.includes('--apply');

function normalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[''`’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  const recipes = await prisma.recipe.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, title: true, venue: true, canonicalId: true, createdAt: true }
  });

  const groups = new Map<string, typeof recipes>();
  for (const recipe of recipes) {
    const key = normalTitle(recipe.title);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), recipe]);
  }

  let linked = 0;
  let alreadyLinked = 0;
  let flagged = 0;
  const updates: Array<{ id: string; canonicalId: string; title: string }> = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;

    const venues = new Set(members.map((member) => member.venue ?? 'shared'));
    const cleanPair =
      members.length === 2 && venues.size === 2 && !venues.has('shared');

    if (!cleanPair) {
      flagged += 1;
      console.log(
        `  REVIEW "${key}": ${members
          .map((member) => `${member.title} [${member.venue ?? 'shared'}]`)
          .join('  ·  ')}`
      );
      continue;
    }

    const [a, b] = members;
    const canonical = a.createdAt <= b.createdAt ? a : b;
    const twin = canonical === a ? b : a;

    if (twin.canonicalId === canonical.id && !canonical.canonicalId) {
      alreadyLinked += 1;
      continue;
    }
    if (twin.canonicalId || canonical.canonicalId) {
      flagged += 1;
      console.log(
        `  REVIEW "${key}": existing link disagrees (${twin.title} → ${twin.canonicalId}, ${canonical.title} → ${canonical.canonicalId})`
      );
      continue;
    }
    updates.push({ id: twin.id, canonicalId: canonical.id, title: twin.title });
    linked += 1;
  }

  console.log(
    `clean pairs to link: ${linked} · already linked: ${alreadyLinked} · flagged for review: ${flagged}`
  );

  if (CONFIRM && updates.length) {
    for (const update of updates) {
      await prisma.recipe.update({
        where: { id: update.id },
        data: { canonicalId: update.canonicalId }
      });
    }
    console.log(`applied: ${updates.length} links`);
  } else if (!CONFIRM) {
    console.log('DRY RUN — re-run with --apply to write the links.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Seed the two printed menus — St Alma Freshwater and Alma Avalon — with the
 * current content, through the real publish path.
 *
 *   pnpm --filter @alma/api seed:menus              # seed, validate, publish v1
 *   pnpm --filter @alma/api seed:menus -- --dry-run  # validate and report only
 *
 * Idempotent and non-destructive: a menu that already has a version is left
 * alone and reported. Venues are matched by slug (st-alma, alma-avalon — the
 * ones `pnpm db:seed:prod` creates) and created if missing.
 *
 * The validator's full report is printed. Nothing in the seed data is changed
 * to make it pass; if it flags something, that is the finding.
 *
 * Needs headless Chrome (see MENU_CHROME_PATH) because v1 is PUBLISHED and a
 * published version always carries its PDF. Without Chrome the script stops
 * before writing anything.
 */
import { prisma } from '@alma/db';
import { validateMenuDocument } from '@alma/shared';
import { MENU_SEEDS } from '../src/data/menu-seed-content.js';
import { menuAssetsStatus } from '../src/lib/menu-assets.js';
import { chromeStatus, closeMenuBrowser } from '../src/lib/menu-pdf.js';
import { menuService } from '../src/services/menu.service.js';

const dryRun = process.argv.includes('--dry-run');
const seedActor = { id: 'seed', firstName: 'Menu', lastName: 'seed', email: null, roleTitle: 'Seed', venue: null, accountType: 'HUMAN', isAdmin: true, trainingOnly: false, role: 'ADMIN', appAccess: [] } as const;

function report(label: string, issues: Array<{ level: string; message: string }>) {
  if (issues.length === 0) {
    console.log(`   ${label}: none`);
    return;
  }
  console.log(`   ${label}:`);
  for (const issue of issues) console.log(`     - [${issue.level}] ${issue.message}`);
}

async function main() {
  console.log(dryRun ? 'Menu seed — DRY RUN (validate only)\n' : 'Menu seed\n');

  let anyError = false;
  for (const seed of MENU_SEEDS) {
    const validation = validateMenuDocument(seed.document);
    console.log(`== ${seed.venueName} · ${seed.menuName} (${seed.templateKey})`);
    const items = seed.document.sections.reduce((sum, section) => sum + section.items.length, 0);
    console.log(`   ${seed.document.sections.length} sections, ${items} items`);
    report('errors', validation.errors);
    report('warnings', validation.warnings);
    if (!validation.ok) anyError = true;
  }

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }
  if (anyError) {
    console.error('\nSeed data has validation errors. Not publishing. Fix the data (or the kitchen fixes the menu) and run again.');
    process.exitCode = 1;
    return;
  }

  const chrome = chromeStatus();
  const assets = menuAssetsStatus();
  if (!chrome.ok || !assets.ok) {
    console.error(`\nCannot publish without the PDF renderer.\n   chrome: ${chrome.message}\n   assets: ${assets.ok ? 'ok' : `missing ${assets.missing.join(', ')}`}`);
    process.exitCode = 1;
    return;
  }

  for (const seed of MENU_SEEDS) {
    const venue =
      (await prisma.venue.findUnique({ where: { slug: seed.venueSlug } })) ??
      (await prisma.venue.create({ data: { name: seed.venueName, slug: seed.venueSlug } }));
    let menu = await prisma.menu.findUnique({ where: { venueId_name: { venueId: venue.id, name: seed.menuName } } });
    if (!menu) {
      menu = await prisma.menu.create({ data: { venueId: venue.id, name: seed.menuName, templateKey: seed.templateKey } });
      console.log(`\n+ Created menu "${seed.menuName}" for ${venue.name} (${menu.id})`);
    }
    const existing = await prisma.menuVersion.count({ where: { menuId: menu.id } });
    if (existing > 0) {
      console.log(`\n= ${venue.name} · ${seed.menuName} already has ${existing} version${existing === 1 ? '' : 's'} — left as is.`);
      continue;
    }
    await menuService.createDraft(menu.id, seedActor as never);
    await menuService.saveDraft(menu.id, seed.document, seedActor as never);
    const started = Date.now();
    const published = await menuService.publish(menu.id, { acknowledgeWarnings: true }, seedActor as never);
    console.log(`\n✔ ${venue.name} · ${seed.menuName}: published v${published.version.versionNumber} with PDF (${published.version.pdfByteSize} bytes) in ${Date.now() - started} ms.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMenuBrowser();
    await prisma.$disconnect();
  });

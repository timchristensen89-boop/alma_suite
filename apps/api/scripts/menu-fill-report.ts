/**
 * Page-fill report for every draft in the database, through the same publish
 * preview the editor and the publish gate use (headless Chrome, the real
 * template). Says which menus would be refused for overflow and where.
 *
 *   DATABASE_URL=postgresql://… node --import tsx scripts/menu-fill-report.ts [venue/slug …]
 */
import { prisma } from '@alma/db';
import { closeMenuBrowser } from '../src/lib/menu-pdf.js';
import { menuService } from '../src/services/menu.service.js';

const only = new Set(process.argv.slice(2));

async function main() {
  const menus = await prisma.menu.findMany({ where: { status: 'ACTIVE', versions: { some: { state: 'DRAFT' } } }, select: { id: true, name: true, slug: true, templateKey: true, venue: { select: { slug: true } } }, orderBy: [{ venue: { name: 'asc' } }, { name: 'asc' }] });
  let refused = 0;
  for (const menu of menus) {
    const key = `${menu.venue.slug}/${menu.slug}`;
    if (only.size && !only.has(key)) continue;
    const preview = await menuService.publishPreview(menu.id);
    const pages = preview.fill?.pages?.length ? preview.fill.pages : preview.fill ? [{ page: 1, fillRatio: preview.fill.fillRatio, overflow: preview.fill.overflow }] : [];
    const over = pages.filter((page) => page.overflow);
    const errors = preview.validation.errors.map((issue) => issue.code);
    if (over.length || errors.length) refused += 1;
    console.log(
      `${key.padEnd(30)} ${menu.templateKey.padEnd(26)} ${preview.canPublish ? 'publishable' : 'REFUSED    '} ` +
        `pages ${pages.map((page) => `${page.page}:${Math.round(page.fillRatio * 100)}%${page.overflow ? '!' : ''}`).join(' ')}` +
        (errors.length ? `  errors ${errors.join(',')}` : '') +
        (preview.validation.warnings.length ? `  ${preview.validation.warnings.length} warning(s)` : '')
    );
  }
  console.log(refused ? `${refused} menu(s) would be refused` : 'every draft would publish');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMenuBrowser();
    await prisma.$disconnect();
  });

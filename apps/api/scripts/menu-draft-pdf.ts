/**
 * Render a menu's current draft to PDF (and PNG pages) for a look, through
 * the same renderer publish uses. Local review only; writes to --out.
 *
 *   DATABASE_URL=… node --import tsx scripts/menu-draft-pdf.ts <venue>/<slug> --out /tmp/x [--pages 20-22]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@alma/db';
import { renderMenuHtml } from '@alma/shared';
import { loadMenuRenderAssets } from '../src/lib/menu-assets.js';
import { closeMenuBrowser, renderMenuPdf } from '../src/lib/menu-pdf.js';
import { menuPublishing } from '../src/services/menu.service.js';

const [key] = process.argv.slice(2);
const out = process.argv[process.argv.indexOf('--out') + 1] ?? '/tmp/menu-draft';
const pages = process.argv.includes('--pages') ? process.argv[process.argv.indexOf('--pages') + 1] : null;

async function main() {
  const [venueSlug, slug] = (key ?? '').split('/');
  const menu = await prisma.menu.findFirst({ where: { slug, venue: { slug: venueSlug } }, select: menuPublishing.MENU_SELECT });
  if (!menu) throw new Error(`no menu ${key}`);
  const draft = await menuPublishing.loadDraft(menu.id);
  if (!draft) throw new Error(`${key} has no draft`);
  const doc = menuPublishing.withPromotion(menu, menuPublishing.documentFromRows(draft));
  const { getMenuTemplate } = await import('@alma/shared');
  const template = getMenuTemplate(menu.templateKey as never);
  const html = renderMenuHtml(doc, menu.templateKey as never, { assets: loadMenuRenderAssets() });
  const rendered = await renderMenuPdf(html, template.page);
  mkdirSync(out, { recursive: true });
  const pdf = join(out, `${venueSlug}-${slug}.pdf`);
  writeFileSync(pdf, rendered.pdf);
  writeFileSync(join(out, `${venueSlug}-${slug}.html`), html);
  const args = ['-r', '96', '-png'];
  if (pages) {
    const [from, to] = pages.split('-').map(Number);
    args.push('-f', String(from), '-l', String(to ?? from));
  }
  execFileSync('pdftoppm', [...args, pdf, join(out, `${venueSlug}-${slug}`)]);
  console.log(`${rendered.pageCount} pages → ${out}; fill ${rendered.fill.pages?.map((p) => `${p.page}:${Math.round(p.fillRatio * 100)}%${p.overflow ? `!(${Math.round(p.contentHeightPx - p.sheetHeightPx)}px over)` : `(${Math.round(p.sheetHeightPx - p.contentHeightPx)}px free)`}`).join(" ")}`);
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

/**
 * Proof for acceptance criterion 1: render both seeded menus through the real
 * renderer and headless Chrome, then put each page beside the current PDF.
 *
 *   pnpm --filter @alma/api menus:compare -- --reference ../alma-web-platform/apps/web/public/menus --out ../../docs/menu-editor/compare
 *
 * Writes, per menu:
 *   <out>/<key>.pdf            our render
 *   <out>/<key>-ours.png       rasterised at 110 dpi
 *   <out>/<key>-reference.png  the current PDF, same dpi
 *   <out>/<key>-side-by-side.png
 *   <out>/<key>-diff.png       pixel difference (ImageMagick), when available
 * and prints the page boxes, fill ratio and a mean pixel-difference figure.
 *
 * Needs `pdftoppm` (poppler) for the PNGs and `convert` (ImageMagick) for the
 * composites; without them it still writes the PDFs and reports the page box.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { renderMenuHtml, validateMenuDocument, getMenuTemplate } from '@alma/shared';
import { MENU_SEEDS } from '../src/data/menu-seed-content.js';
import { loadMenuRenderAssets } from '../src/lib/menu-assets.js';
import { closeMenuBrowser, renderMenuPdf } from '../src/lib/menu-pdf.js';

const REFERENCE_FILES: Record<string, string> = {
  freshwater_alacarte: 'st-alma-menu.pdf',
  avalon_alacarte: 'alma-avalon-menu.pdf'
};

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function has(binary: string) {
  try {
    execFileSync('which', [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function rasterise(pdf: string, pngBase: string, dpi: number) {
  // -singlefile writes <pngBase>.png
  execFileSync('pdftoppm', ['-r', String(dpi), '-png', '-singlefile', pdf, pngBase], { stdio: 'inherit' });
  return `${pngBase}.png`;
}

async function pageBox(path: string) {
  const document = await PDFDocument.load(await import('node:fs').then((fs) => fs.readFileSync(path)), { updateMetadata: false });
  const page = document.getPage(0);
  const { width, height } = page.getSize();
  return { pages: document.getPageCount(), widthMm: (width / 72) * 25.4, heightMm: (height / 72) * 25.4 };
}

async function main() {
  const referenceDir = resolve(arg('--reference', '../../../alma-web-platform/apps/web/public/menus'));
  const outDir = resolve(arg('--out', '../../docs/menu-editor/compare'));
  const dpi = Number(arg('--dpi', '110'));
  mkdirSync(outDir, { recursive: true });
  const assets = loadMenuRenderAssets();
  const tools = { pdftoppm: has('pdftoppm'), convert: has('convert') };
  console.log(`reference: ${referenceDir}\nout:       ${outDir}\ntools:     pdftoppm=${tools.pdftoppm} convert=${tools.convert}\n`);

  for (const seed of MENU_SEEDS) {
    const template = getMenuTemplate(seed.templateKey);
    const validation = validateMenuDocument(seed.document);
    const html = renderMenuHtml(seed.document, seed.templateKey, { assets, title: `${seed.venueName} food menu | Alma Group` });
    const result = await renderMenuPdf(html, template.page);
    const ourPdf = join(outDir, `${seed.templateKey}.pdf`);
    writeFileSync(ourPdf, result.pdf);
    writeFileSync(join(outDir, `${seed.templateKey}.html`), html);
    const ours = await pageBox(ourPdf);
    console.log(`== ${seed.venueName} (${seed.templateKey})`);
    console.log(`   validation: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
    console.log(`   fill: ${(result.fill.fillRatio * 100).toFixed(1)}% of the page, pages=${result.pageCount}, render ${result.renderMs} ms`);
    console.log(`   ours:      ${ours.pages}pp ${ours.widthMm.toFixed(1)} x ${ours.heightMm.toFixed(1)} mm`);

    const referencePdf = join(referenceDir, REFERENCE_FILES[seed.templateKey] ?? '');
    if (!existsSync(referencePdf)) {
      console.log(`   reference: not found at ${referencePdf}`);
      continue;
    }
    const reference = await pageBox(referencePdf);
    console.log(`   reference: ${reference.pages}pp ${reference.widthMm.toFixed(1)} x ${reference.heightMm.toFixed(1)} mm`);
    if (!tools.pdftoppm) continue;
    const oursPng = rasterise(ourPdf, join(outDir, `${seed.templateKey}-ours`), dpi);
    const referencePng = rasterise(referencePdf, join(outDir, `${seed.templateKey}-reference`), dpi);
    if (!tools.convert) continue;
    const sideBySide = join(outDir, `${seed.templateKey}-side-by-side.png`);
    execFileSync('convert', [referencePng, oursPng, '+append', '-bordercolor', '#cdc6b8', '-border', '12', sideBySide], { stdio: 'inherit' });
    const diffPng = join(outDir, `${seed.templateKey}-diff.png`);
    let metric = 'n/a';
    try {
      execFileSync('compare', ['-metric', 'MAE', referencePng, oursPng, diffPng], { stdio: ['ignore', 'pipe', 'pipe'] });
      metric = '0 (identical)';
    } catch (error) {
      // ImageMagick's compare exits 1 whenever the images differ at all and prints the metric on stderr.
      const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
      metric = stderr || 'differs';
    }
    console.log(`   side by side: ${sideBySide}`);
    console.log(`   pixel difference (MAE, 0 = identical, 1 = inverted): ${metric}`);
  }
  await closeMenuBrowser();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  await closeMenuBrowser();
  process.exit(1);
});

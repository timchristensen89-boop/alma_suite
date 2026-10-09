import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { renderMenuHtml, type MenuDocument } from '@alma/shared';
import { MENU_SEEDS, ST_ALMA_FRESHWATER_SEED } from '../data/menu-seed-content.js';
import { loadMenuRenderAssets, menuAssetsStatus } from './menu-assets.js';
import { chromeStatus, closeMenuBrowser, measureMenuFill, renderMenuPdf } from './menu-pdf.js';

/**
 * The real renderer: headless Chrome, the real fonts, the seeded menus.
 *
 * Skips itself when no Chrome is installed, so the ordinary test run stays
 * browser-free; CI's image and any developer with Chromium (or a Playwright
 * browser dir) runs it. Proves the two things the rules file cannot: the
 * seeded menus fit one A4 page, and an overfull menu is caught as overflow.
 */

const chrome = chromeStatus();
const assets = menuAssetsStatus();
const canRun = chrome.ok && assets.ok;

describe('menu PDF renderer', { skip: canRun ? false : `skipped: ${chrome.ok ? `assets missing ${assets.missing.join(', ')}` : chrome.message}` }, () => {
  after(async () => {
    await closeMenuBrowser();
  });

  it('renders each seeded menu to exactly one A4 page, under the fifteen-second publish budget', async (t) => {
    const renderAssets = loadMenuRenderAssets();
    // The budget is for a render, which renderMs measures from before the
    // shared browser is fetched: the first call therefore also pays Chrome's
    // launch, and on a cold CI runner that alone has taken over fifteen
    // seconds. Launch it once here, untimed, and report how long it took.
    const coldStart = Date.now();
    await measureMenuFill(renderMenuHtml(ST_ALMA_FRESHWATER_SEED.document, ST_ALMA_FRESHWATER_SEED.templateKey, { assets: renderAssets }));
    t.diagnostic(`Chrome launch and first layout: ${Date.now() - coldStart} ms`);
    for (const seed of MENU_SEEDS) {
      const html = renderMenuHtml(seed.document, seed.templateKey, { assets: renderAssets });
      const result = await renderMenuPdf(html, { widthMm: 210, heightMm: 297 });
      assert.equal(result.pageCount, 1, `${seed.templateKey} page count`);
      assert.equal(result.fill.overflow, false, `${seed.templateKey} overflow`);
      assert.ok(result.fill.fillRatio > 0.5 && result.fill.fillRatio <= 1.005, `${seed.templateKey} fill ${result.fill.fillRatio}`);
      assert.ok(result.renderMs < 15_000, `${seed.templateKey} took ${result.renderMs} ms`);
      assert.equal(result.pdf.subarray(0, 5).toString(), '%PDF-');
    }
  });

  it('measures an overfull menu as overflow', async () => {
    const renderAssets = loadMenuRenderAssets();
    const base = ST_ALMA_FRESHWATER_SEED.document;
    const stuffed: MenuDocument = {
      ...base,
      sections: base.sections.map((section) =>
        section.sectionType === 'STANDARD' && section.placement === 'LEFT'
          ? { ...section, items: [...section.items, ...section.items, ...section.items].map((item, index) => ({ ...item, dishKey: `${item.dishKey}-${index}` })) }
          : section
      )
    };
    const fill = await measureMenuFill(renderMenuHtml(stuffed, 'freshwater_alacarte', { assets: renderAssets }));
    assert.equal(fill.overflow, true);
    assert.ok(fill.fillRatio > 1.05, `fill ${fill.fillRatio}`);
  });
});

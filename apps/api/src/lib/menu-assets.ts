import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENU_FONT_FILES, MENU_LOGO_FILES, menuFontFaceCss, type MenuLogoAssetKey, type MenuRenderAssets } from '@alma/shared';

/**
 * Fonts and logos for the printed menus, inlined as data URIs.
 *
 * Inlined on purpose: headless Chrome fetches a linked font as a second
 * request and drops it when printing, so the PDF silently comes out in Arial.
 * The website's print routes learnt this the hard way (see its
 * scripts/inline-print-fonts.py); here the whole page is one self-contained
 * string by construction.
 *
 * Avenir LT Std is licensed — the four faces are the ones the brand already
 * owns, copied from the website repo. If a file is missing we refuse to render
 * rather than fall back to another face: a menu in the wrong font is a worse
 * outcome than a clear error at publish time.
 */

const here = dirname(fileURLToPath(import.meta.url));

// apps/api/src/lib (tsx dev) and dist/apps/api/src/lib (compiled) both land on
// the repo's apps/api/assets/menus; cwd-based candidates cover `pnpm --filter`
// runs from apps/api and from the repo root.
const ASSET_DIR_CANDIDATES = [
  process.env.MENU_ASSETS_DIR ?? '',
  resolve(here, '../../assets/menus'),
  resolve(here, '../../../../../apps/api/assets/menus'),
  join(process.cwd(), 'apps/api/assets/menus'),
  join(process.cwd(), 'assets/menus')
].filter(Boolean);

export class MenuAssetError extends Error {}

export function menuAssetsDir(): string {
  const found = ASSET_DIR_CANDIDATES.find((candidate) => existsSync(join(candidate, 'fonts', MENU_FONT_FILES.avenirRoman)));
  if (!found) {
    throw new MenuAssetError(
      `Menu print assets not found. Expected apps/api/assets/menus/fonts/${MENU_FONT_FILES.avenirRoman} (set MENU_ASSETS_DIR to override). Looked in: ${ASSET_DIR_CANDIDATES.join(', ')}`
    );
  }
  return found;
}

function dataUri(path: string, mime: string): string {
  if (!existsSync(path)) {
    throw new MenuAssetError(`Menu print asset missing: ${path}. The menu cannot be rendered in a fallback font or without its logo.`);
  }
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

let cached: MenuRenderAssets | null = null;

/** Everything the renderer needs, read once and kept for the life of the process. */
export function loadMenuRenderAssets(): MenuRenderAssets {
  if (cached) return cached;
  const dir = menuAssetsDir();
  const font = (file: string, mime: string) => dataUri(join(dir, 'fonts', file), mime);
  const fontFaceCss = menuFontFaceCss({
    manrope: font(MENU_FONT_FILES.manrope, 'font/woff2'),
    avenirBook: font(MENU_FONT_FILES.avenirBook, 'font/otf'),
    avenirRoman: font(MENU_FONT_FILES.avenirRoman, 'font/otf'),
    avenirHeavy: font(MENU_FONT_FILES.avenirHeavy, 'font/otf'),
    avenirBlack: font(MENU_FONT_FILES.avenirBlack, 'font/otf'),
    cormorantItalic: font(MENU_FONT_FILES.cormorantItalic, 'font/woff2'),
    cormorantItalicLatinExt: font(MENU_FONT_FILES.cormorantItalicLatinExt, 'font/woff2')
  });
  const logos = new Map<MenuLogoAssetKey, string>();
  for (const [key, file] of Object.entries(MENU_LOGO_FILES) as Array<[MenuLogoAssetKey, string]>) {
    logos.set(key, dataUri(join(dir, 'images', file), 'image/png'));
  }
  cached = {
    fontFaceCss,
    logoSrc: (asset) => {
      const src = logos.get(asset);
      if (!src) throw new MenuAssetError(`No logo asset registered for "${asset}".`);
      return src;
    }
  };
  return cached;
}

/** Report, without throwing, which assets are present — for the health check and the seed. */
export function menuAssetsStatus(): { ok: boolean; dir: string | null; missing: string[] } {
  let dir: string;
  try {
    dir = menuAssetsDir();
  } catch {
    return { ok: false, dir: null, missing: ['fonts/' + MENU_FONT_FILES.avenirRoman] };
  }
  const missing: string[] = [];
  for (const file of Object.values(MENU_FONT_FILES)) if (!existsSync(join(dir, 'fonts', file))) missing.push(`fonts/${file}`);
  for (const file of Object.values(MENU_LOGO_FILES)) if (!existsSync(join(dir, 'images', file))) missing.push(`images/${file}`);
  return { ok: missing.length === 0, dir, missing };
}

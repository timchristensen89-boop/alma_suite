import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MENU_FILL_PROBE_SCRIPT,
  MENU_FONT_FILES,
  MENU_LOGO_FILES,
  getMenuTemplate,
  menuFontFaceCss,
  renderMenuHtml,
  type MenuDocument,
  type MenuFillReport,
  type MenuRenderAssets
} from '@alma/shared';

/**
 * The live preview: the same renderer and stylesheet the API prints with, in
 * a same-origin iframe (srcdoc), scaled to fit whatever width it is given. A
 * one-page A4 sheet, or every page of a drinks book stacked with the 12 mm gap
 * the print frame puts between sheets.
 *
 * Fonts and logos come from this app's own /fonts and /images, as absolute
 * URLs — a srcdoc document resolves relative URLs against about:srcdoc, which
 * loads nothing. Being same-origin, the parent can run the fill probe inside
 * the frame after fonts are ready and report how full each page is.
 */

function previewAssets(): MenuRenderAssets {
  const origin = window.location.origin;
  const font = (file: string) => `${origin}/fonts/${file}`;
  return {
    fontFaceCss: menuFontFaceCss({
      manrope: font(MENU_FONT_FILES.manrope),
      avenirBook: font(MENU_FONT_FILES.avenirBook),
      avenirRoman: font(MENU_FONT_FILES.avenirRoman),
      avenirHeavy: font(MENU_FONT_FILES.avenirHeavy),
      avenirBlack: font(MENU_FONT_FILES.avenirBlack),
      cormorantItalic: font(MENU_FONT_FILES.cormorantItalic),
      cormorantItalicLatinExt: font(MENU_FONT_FILES.cormorantItalicLatinExt)
    }),
    logoSrc: (asset) => `${origin}/images/${MENU_LOGO_FILES[asset]}`
  };
}

const PX_PER_MM = 96 / 25.4;
/** The frame's `.sheet + .sheet { margin-top: 12mm }`. */
const SHEET_GAP_MM = 12;

/**
 * No grey backdrop or frame padding inside the iframe: the host scales and
 * frames the sheets itself. The sheets keep their own shadow when there are
 * several, so the gap between them reads as paper, not as one tall page.
 */
const PREVIEW_CSS =
  '<style>' +
  '.food-print-page,.menu-print-page{background:none !important;padding:0 !important}' +
  '.food-print-page .sheet{box-shadow:none !important;margin:0 !important}' +
  '.menu-print-page .sheet{margin-left:0 !important;margin-right:0 !important}' +
  '.menu-print-page .sheet:first-child{margin-top:0 !important}' +
  `.menu-print-page .sheet + .sheet{margin-top:${SHEET_GAP_MM}mm !important}` +
  'html,body{overflow:hidden;background:transparent !important}' +
  '</style></head>';

type Props = {
  document: MenuDocument;
  templateKey: string;
  /** Called after every render with the measured fill of every page. */
  onFill?: (fill: MenuFillReport) => void;
  /** Scroll the preview to a dish when the validation panel asks. */
  focusDishKey?: string | null;
  /** Scroll the preview to a page when a page chip is clicked; `at` makes a repeat click on the same page scroll again. */
  focusPage?: { page: number; at: number } | null;
  className?: string;
};

export function MenuPreview({ document: doc, templateKey, onFill, focusDishKey, focusPage, className }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const template = getMenuTemplate(templateKey);
  const pages = template.multiPage ? Math.max(1, doc.pageCount ?? 1) : 1;
  const pageWidthPx = template.page.widthMm * PX_PER_MM;
  const pageHeightPx = template.page.heightMm * PX_PER_MM;
  const frameHeightPx = pages * pageHeightPx + (pages - 1) * SHEET_GAP_MM * PX_PER_MM;
  const stacked = pages > 1;

  const html = useMemo(() => {
    const assets = previewAssets();
    return renderMenuHtml(doc, templateKey, { assets, title: 'Preview' }).replace('</head>', PREVIEW_CSS);
  }, [doc, templateKey]);

  // Fit the sheet to the host's width.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => setScale(Math.min(1, host.clientWidth / pageWidthPx));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [pageWidthPx]);

  // Measure the fill once the frame has laid out with its fonts, and again
  // whenever the host changes size — on a phone the preview tab starts hidden
  // (display:none lays out nothing), so the first measurement is empty and
  // the real one happens when the tab is shown.
  useEffect(() => {
    const frame = frameRef.current;
    const host = hostRef.current;
    if (!frame || !host || !onFill) return;
    let cancelled = false;
    let loaded = false;
    const measure = async () => {
      const win = frame.contentWindow;
      const fonts = (win?.document as unknown as { fonts?: { ready: Promise<unknown> } } | undefined)?.fonts;
      try {
        await fonts?.ready;
      } catch {
        // fall through and measure anyway
      }
      if (cancelled || !win) return;
      try {
        const report = (win as unknown as { eval: (code: string) => unknown }).eval(MENU_FILL_PROBE_SCRIPT) as MenuFillReport;
        // A hidden frame reports a zero-height sheet; that is not a measurement.
        if (report && typeof report.fillRatio === 'number' && report.sheetHeightPx > 0) onFill(report);
      } catch {
        // measurement is advisory; the server measures again at publish
      }
    };
    const onLoad = () => {
      loaded = true;
      void measure();
    };
    frame.addEventListener('load', onLoad);
    const observer = new ResizeObserver(() => {
      if (loaded && host.clientWidth > 0) void measure();
    });
    observer.observe(host);
    return () => {
      cancelled = true;
      frame.removeEventListener('load', onLoad);
      observer.disconnect();
    };
  }, [html, onFill]);

  useEffect(() => {
    if (!focusDishKey) return;
    const win = frameRef.current?.contentWindow;
    // The element lives in the iframe's realm, so instanceof HTMLElement from
    // this window would be false; duck-type on `style` instead.
    const target = win?.document.querySelector(`[data-dish-key="${CSS.escape(focusDishKey)}"]`) as (Element & { style?: CSSStyleDeclaration }) | null | undefined;
    if (target && target.style) {
      const style = target.style;
      target.scrollIntoView({ block: 'center' });
      style.outline = '2px solid #684A4A';
      style.outlineOffset = '3px';
      window.setTimeout(() => {
        style.outline = '';
        style.outlineOffset = '';
      }, 2000);
    }
  }, [focusDishKey]);

  // Bring a page into view: scroll the preview box when it scrolls on its own
  // (a stacked book on a desk), else the window (a phone, where the preview
  // tab is the page).
  useEffect(() => {
    if (!focusPage) return;
    const win = frameRef.current?.contentWindow;
    const host = hostRef.current;
    const box = sheetRef.current;
    if (!win || !host || !box) return;
    const sheet = win.document.querySelector(`.sheet[data-page="${focusPage.page}"]`);
    if (!sheet) return;
    // The iframe document never scrolls, so the sheet's position in it is its offset from the top.
    const topInFrame = sheet.getBoundingClientRect().top;
    const y = box.offsetTop + topInFrame * scaleRef.current;
    if (host.scrollHeight > host.clientHeight + 1) {
      host.scrollTo({ top: Math.max(0, y - 8), behavior: 'smooth' });
    } else {
      const rect = host.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, rect.top + window.scrollY + y - 90), behavior: 'smooth' });
    }
  }, [focusPage]);

  return (
    <div ref={hostRef} className={`menu-preview${stacked ? ' is-stacked' : ''} ${className ?? ''}`.trim()} data-pages={pages}>
      <div ref={sheetRef} className="menu-preview-sheet" style={{ width: pageWidthPx * scale, height: frameHeightPx * scale }}>
        <iframe
          ref={frameRef}
          title="Menu preview"
          className="menu-preview-frame"
          srcDoc={html}
          style={{ width: pageWidthPx, height: frameHeightPx, transform: `scale(${scale})` }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}

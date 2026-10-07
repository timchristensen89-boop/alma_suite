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
 * The live A4 preview: the same renderer and stylesheet the API prints with,
 * in a same-origin iframe (srcdoc), scaled to fit whatever width it is given.
 *
 * Fonts and logos come from this app's own /fonts and /images, as absolute
 * URLs — a srcdoc document resolves relative URLs against about:srcdoc, which
 * loads nothing. Being same-origin, the parent can run the fill probe inside
 * the frame after fonts are ready and report how full the page is.
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

type Props = {
  document: MenuDocument;
  templateKey: string;
  /** Called after every render with the measured page fill. */
  onFill?: (fill: MenuFillReport) => void;
  /** Scroll the preview to a dish when the validation panel asks. */
  focusDishKey?: string | null;
  className?: string;
};

export function MenuPreview({ document: doc, templateKey, onFill, focusDishKey, className }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const template = getMenuTemplate(templateKey);
  const pageWidthPx = template.page.widthMm * PX_PER_MM;
  const pageHeightPx = template.page.heightMm * PX_PER_MM;

  const html = useMemo(() => {
    const assets = previewAssets();
    // No grey backdrop or padding inside the frame: the host scales the sheet itself.
    return renderMenuHtml(doc, templateKey, { assets, title: 'Preview' }).replace(
      '</head>',
      '<style>.food-print-page{background:none !important;padding:0 !important}.food-print-page .sheet{box-shadow:none !important;margin:0 !important}html,body{overflow:hidden}</style></head>'
    );
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

  return (
    <div ref={hostRef} className={`menu-preview ${className ?? ''}`.trim()}>
      <div className="menu-preview-sheet" style={{ width: pageWidthPx * scale, height: pageHeightPx * scale }}>
        <iframe
          ref={frameRef}
          title="Menu preview"
          className="menu-preview-frame"
          srcDoc={html}
          style={{ width: pageWidthPx, height: pageHeightPx, transform: `scale(${scale})` }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}

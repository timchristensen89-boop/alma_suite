import {
  ALMA_A_PATH,
  ALMA_APPS,
  AlmaAppIcon,
  Button,
  Card,
  PageHeader
} from '@alma/ui';
import type { AlmaAppDefinition, AlmaAppIconKey } from '@alma/ui';

/**
 * In-app exporter that turns each ALMA module icon into a true square
 * 1024x1024 PNG. The canvas drawing mirrors the React `AlmaAppIcon`
 * component: gradient tile, micro icon at the top, white rounded "a"
 * mark in the centre, and an "ALMA <NAME>" wordmark at the bottom.
 */

const EXPORT_SIZE = 1024;
const CORNER_RADIUS = Math.round(EXPORT_SIZE * 0.18); // ~184
const BRAND_MARK_SIZE = Math.round(EXPORT_SIZE * 0.18); // ~184
const FEATURE_ICON_SIZE = Math.round(EXPORT_SIZE * 0.42); // ~430
const BRAND_MARK_TOP = Math.round(EXPORT_SIZE * 0.1); // ~102
const BRAND_MARK_LEFT = Math.round(EXPORT_SIZE * 0.1); // ~102
const WORDMARK_BOTTOM = Math.round(EXPORT_SIZE * 0.12); // ~123
const ALMA_FONT = Math.round(EXPORT_SIZE * 0.12); // ~123
const MODULE_FONT = Math.round(EXPORT_SIZE * 0.07); // ~72

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawMicroIcon(
  ctx: CanvasRenderingContext2D,
  iconKey: AlmaAppIconKey,
  cx: number,
  cy: number,
  boxSize: number
) {
  const scale = boxSize / 24; // line icons live in a 24x24 viewBox
  ctx.save();
  ctx.translate(cx - boxSize / 2, cy - boxSize / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stroke = (d: string) => ctx.stroke(new Path2D(d));

  switch (iconKey) {
    case 'book':
      stroke('M4 5.5c2.4-1.1 4.7-1.1 7 0v13c-2.3-1.1-4.6-1.1-7 0v-13Z');
      stroke('M13 5.5c2.3-1.1 4.6-1.1 7 0v13c-2.4-1.1-4.7-1.1-7 0v-13Z');
      stroke('M12 6v13');
      break;
    case 'chart':
      stroke('M5 19V11');
      stroke('M12 19V5');
      stroke('M19 19V8');
      stroke('M4 19h16');
      break;
    case 'document':
      stroke('M6 3h8l4 4v14H6V3Z');
      stroke('M14 3v5h4');
      stroke('M9 12h6');
      stroke('M9 16h5');
      break;
    case 'shield':
      stroke('M12 3.5c2.2 1.6 4.5 2.4 7 2.6v5.4c0 4.1-2.4 7.1-7 9-4.6-1.9-7-4.9-7-9V6.1c2.5-.2 4.8-1 7-2.6Z');
      stroke('m8.7 12 2.2 2.2 4.7-5');
      break;
    case 'warning':
      stroke('M12 4 21 20H3L12 4Z');
      stroke('M12 9v5');
      ctx.beginPath();
      ctx.arc(12, 17, 0.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'search':
      ctx.beginPath();
      ctx.arc(10.5, 10.5, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      stroke('M16 16l5 5');
      break;
    case 'cap':
      stroke('M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z');
      stroke('M7 11v5c3.2 2 6.8 2 10 0v-5');
      stroke('M21 9v6');
      break;
    case 'produce':
      stroke('M12.2 8.2c-4.2-.4-7.1 2.4-7.1 6.2 0 3.5 2.7 6.1 6.4 6.1 4 0 6.8-3 6.4-7.2-.2-2.8-2.3-4.8-5.7-5.1Z');
      stroke('M12.2 8.2c-.2-2.4.9-4.3 3.1-5.5 1.1 2.4.3 4.5-2.1 6');
      stroke('M10.7 8.6c-1.3-2-3.2-2.8-5.6-2.2 1.1 2.3 3 3.4 5.6 3.3');
      break;
    case 'people':
      ctx.beginPath();
      ctx.arc(9, 8, 3.4, 0, Math.PI * 2);
      ctx.stroke();
      stroke('M3.5 20c.4-4 2.5-6.4 5.5-6.4s5.1 2.4 5.5 6.4');
      ctx.beginPath();
      ctx.arc(16.5, 9, 2.6, 0, Math.PI * 2);
      ctx.stroke();
      stroke('M14.7 14.4c2.8.3 4.7 2.3 5 5.6');
      break;
    case 'gear':
      ctx.beginPath();
      ctx.arc(12, 12, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      stroke(
        'M19 12a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.1-1.2L14 3h-4l-.4 2.7a8 8 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5A7.5 7.5 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.4-2.7c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z'
      );
      break;
  }
  ctx.restore();
}

function drawAlmaMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, drawSize: number) {
  // ALMA_A_PATH is authored against a 48x48 viewBox; translate + scale to the canvas.
  const scale = drawSize / 48;
  const offsetX = cx - drawSize / 2;
  const offsetY = cy - drawSize / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Drop shadow for the mark
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;

  ctx.fillStyle = '#ffffff';
  const path = new Path2D(ALMA_A_PATH);
  // The path has an inner counter — use evenodd so the hole renders correctly.
  ctx.fill(path, 'evenodd');
  ctx.restore();
}

function drawWordmark(ctx: CanvasRenderingContext2D, label: string) {
  const cx = EXPORT_SIZE / 2;
  const almaBaseline = EXPORT_SIZE - WORDMARK_BOTTOM - MODULE_FONT * 0.9;
  const moduleBaseline = EXPORT_SIZE - WORDMARK_BOTTOM;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  // Canvas has no real letterSpacing, so track each line character-by-character.
  const family = '"Helvetica Neue", Arial, sans-serif';
  const almaFont = `800 ${ALMA_FONT}px ${family}`;
  const labelFont = `700 ${MODULE_FONT}px ${family}`;

  const almaText = 'ALMA';
  const labelText = label.toUpperCase();
  const almaTracking = ALMA_FONT * 0.16;
  const labelTracking = MODULE_FONT * 0.22;

  ctx.font = almaFont;
  const almaWidth = measureTracked(ctx, almaText, almaTracking);
  ctx.font = labelFont;
  const labelWidth = measureTracked(ctx, labelText, labelTracking);

  ctx.font = almaFont;
  drawTracked(ctx, almaText, cx - almaWidth / 2, almaBaseline, almaTracking);
  ctx.font = labelFont;
  drawTracked(ctx, labelText, cx - labelWidth / 2, moduleBaseline, labelTracking);

  ctx.restore();
}

function measureTracked(ctx: CanvasRenderingContext2D, text: string, tracking: number) {
  let width = 0;
  for (const ch of text) {
    width += ctx.measureText(ch).width + tracking;
  }
  return width - tracking; // no trailing tracking
}

function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  startX: number,
  baselineY: number,
  tracking: number
) {
  let x = startX;
  for (const ch of text) {
    ctx.fillText(ch, x, baselineY);
    x += ctx.measureText(ch).width + tracking;
  }
  return x;
}

function drawIcon(app: AlmaAppDefinition) {
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_SIZE;
  canvas.height = EXPORT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, EXPORT_SIZE, EXPORT_SIZE);
  gradient.addColorStop(0, app.from);
  gradient.addColorStop(1, app.to);
  roundedRectPath(ctx, 0, 0, EXPORT_SIZE, EXPORT_SIZE, CORNER_RADIUS);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Top sheen
  ctx.save();
  roundedRectPath(ctx, 0, 0, EXPORT_SIZE, EXPORT_SIZE, CORNER_RADIUS);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 0, 0, EXPORT_SIZE * 0.7);
  sheen.addColorStop(0, 'rgba(255,255,255,0.20)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.04)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE);
  ctx.restore();

  // Soft inner border
  ctx.save();
  const borderInset = Math.max(2, Math.round(EXPORT_SIZE * 0.012));
  roundedRectPath(
    ctx,
    borderInset,
    borderInset,
    EXPORT_SIZE - borderInset * 2,
    EXPORT_SIZE - borderInset * 2,
    Math.max(1, CORNER_RADIUS - borderInset)
  );
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Top-left ALMA brand stamp
  drawAlmaMark(
    ctx,
    BRAND_MARK_LEFT + BRAND_MARK_SIZE / 2,
    BRAND_MARK_TOP + BRAND_MARK_SIZE / 2,
    BRAND_MARK_SIZE
  );

  // Centre feature icon
  drawMicroIcon(ctx, app.iconKey, EXPORT_SIZE / 2, EXPORT_SIZE * 0.47, FEATURE_ICON_SIZE);

  // Bottom wordmark
  drawWordmark(ctx, app.label);

  return canvas;
}

function fileNameFor(app: AlmaAppDefinition) {
  return `alma-${app.label.toLowerCase()}-icon.png`;
}

function downloadCanvas(canvas: HTMLCanvasElement, fileName: string) {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = fileName;
  link.click();
}

function downloadIcon(app: AlmaAppDefinition) {
  downloadCanvas(drawIcon(app), fileNameFor(app));
}

function downloadAll() {
  ALMA_APPS.forEach((app: AlmaAppDefinition, index: number) => {
    window.setTimeout(() => downloadIcon(app), index * 140);
  });
}

export function IconExportPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Brand assets"
        title="ALMA app icon export"
        description="Download square 1024 PNG app icons generated from the shared ALMA icon system."
        actions={
          <Button type="button" onClick={downloadAll}>
            Download all PNGs
          </Button>
        }
      />
      <div className="grid three">
        {ALMA_APPS.map((app: AlmaAppDefinition) => (
          <Card
            key={app.id}
            title={app.label}
            action={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => downloadIcon(app)}
              >
                Download PNG
              </Button>
            }
          >
            <div style={{ display: 'grid', placeItems: 'center', padding: 12 }}>
              <AlmaAppIcon
                label={app.label}
                colorFrom={app.from}
                colorTo={app.to}
                icon={app.icon}
                size={160}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

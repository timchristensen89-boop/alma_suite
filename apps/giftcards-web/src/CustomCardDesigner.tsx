import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// ── "Create your own" gift-card designer ─────────────────────────────────────
// A real <canvas> the customer paints: background colour or their own photo,
// the Alma salmon (colourway / size / position / off), and two lines of text.
// Rendering happens ONCE, here — at checkout the canvas is exported to a
// PNG/JPEG data URL and stored server-side, so the email, printable page, and
// confirmation all reuse this exact image and nothing re-renders the design.

export const CARD_W = 1200;
export const CARD_H = 756;

const BACKGROUNDS = [
  { key: 'forest', label: 'Forest', value: '#14241A' },
  { key: 'cream', label: 'Cream', value: '#F4EDE1' },
  { key: 'mauve', label: 'Mauve', value: '#6E4A4F' },
  { key: 'gold', label: 'Gold', value: '#B98216' },
  { key: 'navy', label: 'Night', value: '#23303C' },
  { key: 'terracotta', label: 'Terracotta', value: '#9A3A2E' }
] as const;

const INKS = [
  { key: 'cream', label: 'Cream', value: '#F5DCCE' },
  { key: 'forest', label: 'Forest', value: '#14241A' },
  { key: 'gold', label: 'Gold', value: '#C9A227' }
] as const;

// The three pre-recoloured salmon PNGs that power the stock card art.
const FISH = [
  { key: 'gold', label: 'Gold', src: '/card-art/salmon-foilgold.png' },
  { key: 'green', label: 'Green', src: '/card-art/salmon-green.png' },
  { key: 'mauve', label: 'Mauve', src: '/card-art/salmon-mauve.png' }
] as const;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// ~4MB of image as base64 — beyond this we re-encode as JPEG.
const MAX_DATA_URL_CHARS = 4_200_000;

export type CustomCardDesignerHandle = {
  /** Export the current design as a PNG/JPEG data URL (null if canvas unready). */
  exportArtwork: () => string | null;
};

type Props = {
  recipientName?: string;
};

export const CustomCardDesigner = forwardRef<CustomCardDesignerHandle, Props>(function CustomCardDesigner(
  { recipientName },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fishImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [background, setBackground] = useState<string>(BACKGROUNDS[0].value);
  const [ink, setInk] = useState<string>(INKS[0].value);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fishOn, setFishOn] = useState(true);
  const [fishVariant, setFishVariant] = useState<string>(FISH[0].key);
  const [fishSize, setFishSize] = useState(46); // % of card width
  const [fishX, setFishX] = useState(70); // % across
  const [fishY, setFishY] = useState(34); // % down
  const [eyebrow, setEyebrow] = useState('A GIFT FOR YOU');
  const [mainText, setMainText] = useState(recipientName?.trim() || 'Dinner on us');
  const [redraw, setRedraw] = useState(0);

  // Preload the fish PNGs once; poke a redraw as each lands.
  useEffect(() => {
    for (const fish of FISH) {
      if (fishImagesRef.current.has(fish.key)) continue;
      const img = new Image();
      img.onload = () => setRedraw((n) => n + 1);
      img.src = fish.src;
      fishImagesRef.current.set(fish.key, img);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      // Background — photo (cover-fit) or flat colour.
      ctx.clearRect(0, 0, CARD_W, CARD_H);
      if (photo) {
        const scale = Math.max(CARD_W / photo.width, CARD_H / photo.height);
        const w = photo.width * scale;
        const h = photo.height * scale;
        ctx.drawImage(photo, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
        // Legibility scrim behind the text block.
        const scrim = ctx.createLinearGradient(0, CARD_H * 0.45, 0, CARD_H);
        scrim.addColorStop(0, 'rgba(0,0,0,0)');
        scrim.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, CARD_W, CARD_H);
      } else {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, CARD_W, CARD_H);
      }

      // The salmon.
      if (fishOn) {
        const fishImg = fishImagesRef.current.get(fishVariant);
        if (fishImg?.complete && fishImg.naturalWidth > 0) {
          const w = (fishSize / 100) * CARD_W;
          const h = w * (fishImg.naturalHeight / fishImg.naturalWidth);
          const x = (fishX / 100) * CARD_W - w / 2;
          const y = (fishY / 100) * CARD_H - h / 2;
          ctx.drawImage(fishImg, x, y, w, h);
        }
      }

      // Text — brand eyebrow top-left, then the customer's two lines
      // anchored bottom-left.
      const textInk = photo ? '#FFFFFF' : ink;
      ctx.fillStyle = textInk;
      ctx.globalAlpha = 0.72;
      ctx.font = '600 24px "Cormorant Garamond", Georgia, serif';
      ctx.save();
      // Letterspaced small caps by hand — canvas has no letter-spacing.
      let x = 64;
      for (const char of 'ALMA GROUP') {
        ctx.fillText(char, x, 84);
        x += ctx.measureText(char).width + 8;
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      if (eyebrow.trim()) {
        ctx.globalAlpha = 0.8;
        ctx.font = '600 26px "Cormorant Garamond", Georgia, serif';
        let ex = 64;
        for (const char of eyebrow.trim().toUpperCase().slice(0, 32)) {
          ctx.fillText(char, ex, CARD_H - 168);
          ex += ctx.measureText(char).width + 6;
        }
        ctx.globalAlpha = 1;
      }
      if (mainText.trim()) {
        ctx.font = '500 84px "Cormorant Garamond", Georgia, serif';
        ctx.fillText(mainText.trim().slice(0, 26), 60, CARD_H - 72, CARD_W - 120);
      }
    };

    // Draw now, and again once the webfont is ready so the serif lands.
    draw();
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(() => draw());
    }
  }, [background, ink, photo, fishOn, fishVariant, fishSize, fishX, fishY, eyebrow, mainText, redraw]);

  useImperativeHandle(ref, () => ({
    exportArtwork: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      // Photos compress far better as JPEG; flat art stays crisp as PNG.
      if (photo) return canvas.toDataURL('image/jpeg', 0.87);
      const png = canvas.toDataURL('image/png');
      return png.length > MAX_DATA_URL_CHARS ? canvas.toDataURL('image/jpeg', 0.87) : png;
    }
  }), [photo]);

  function onPhotoChange(file: File | null | undefined) {
    setPhotoError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setPhotoError('Use a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhotoError('Keep the photo under 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setPhoto(img);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="alma-custom-designer">
      <div className="alma-custom-designer__canvas-wrap">
        <canvas ref={canvasRef} width={CARD_W} height={CARD_H} className="alma-custom-designer__canvas" />
      </div>

      <div className="alma-custom-designer__controls">
        <div className="alma-custom-designer__row">
          <span className="alma-custom-designer__label">Background</span>
          <span className="alma-custom-designer__swatches">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.key}
                type="button"
                title={bg.label}
                aria-label={`${bg.label} background`}
                className={`alma-custom-designer__swatch ${!photo && background === bg.value ? 'is-on' : ''}`}
                style={{ background: bg.value }}
                onClick={() => {
                  setPhoto(null);
                  setBackground(bg.value);
                }}
              />
            ))}
            <label className="alma-custom-designer__upload">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => onPhotoChange(event.currentTarget.files?.[0])}
              />
              {photo ? 'Change photo' : 'Use a photo'}
            </label>
            {photo ? (
              <button type="button" className="alma-custom-designer__clear" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            ) : null}
          </span>
        </div>
        {photoError ? <p className="alma-custom-designer__error">{photoError}</p> : null}

        <div className="alma-custom-designer__row">
          <span className="alma-custom-designer__label">The fish</span>
          <span className="alma-custom-designer__swatches">
            {FISH.map((fish) => (
              <button
                key={fish.key}
                type="button"
                className={`alma-custom-designer__chip ${fishOn && fishVariant === fish.key ? 'is-on' : ''}`}
                onClick={() => {
                  setFishOn(true);
                  setFishVariant(fish.key);
                }}
              >
                {fish.label}
              </button>
            ))}
            <button
              type="button"
              className={`alma-custom-designer__chip ${!fishOn ? 'is-on' : ''}`}
              onClick={() => setFishOn(false)}
            >
              No fish
            </button>
          </span>
        </div>
        {fishOn ? (
          <div className="alma-custom-designer__sliders">
            <label>Size<input type="range" min={16} max={82} value={fishSize} onChange={(e) => setFishSize(Number(e.currentTarget.value))} /></label>
            <label>Across<input type="range" min={8} max={92} value={fishX} onChange={(e) => setFishX(Number(e.currentTarget.value))} /></label>
            <label>Down<input type="range" min={10} max={88} value={fishY} onChange={(e) => setFishY(Number(e.currentTarget.value))} /></label>
          </div>
        ) : null}

        {!photo ? (
          <div className="alma-custom-designer__row">
            <span className="alma-custom-designer__label">Text colour</span>
            <span className="alma-custom-designer__swatches">
              {INKS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  title={option.label}
                  aria-label={`${option.label} text`}
                  className={`alma-custom-designer__swatch ${ink === option.value ? 'is-on' : ''}`}
                  style={{ background: option.value }}
                  onClick={() => setInk(option.value)}
                />
              ))}
            </span>
          </div>
        ) : null}

        <div className="alma-custom-designer__texts">
          <label>
            Small line
            <input type="text" maxLength={32} value={eyebrow} onChange={(e) => setEyebrow(e.currentTarget.value)} placeholder="A GIFT FOR YOU" />
          </label>
          <label>
            Big line
            <input type="text" maxLength={26} value={mainText} onChange={(e) => setMainText(e.currentTarget.value)} placeholder="Dinner on us" />
          </label>
        </div>
      </div>
    </div>
  );
});

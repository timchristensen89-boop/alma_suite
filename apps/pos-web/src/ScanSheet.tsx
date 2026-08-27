import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * The camera sheet staff point at a gift card's QR.
 *
 * Wallet passes (Apple + Google) encode the bare card code; the printed and
 * emailed cards encode the /redeem?code=… URL. Both land here, so both are
 * accepted — any other QR keeps the camera running with a gentle nudge.
 *
 * Decoding prefers the platform BarcodeDetector where it exists (Android
 * Chrome — fast, hardware-assisted) and falls back to jsQR frame-grabs
 * everywhere else, because the venue iPads and iPhones run Safari, which has none.
 */

export function codeFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const fromUrl = new URL(text).searchParams.get('code');
    if (fromUrl?.trim()) return fromUrl.trim().toUpperCase();
  } catch {
    // Not a URL — read the text itself.
  }
  const match = text.toUpperCase().match(/ALMA-[A-Z0-9][A-Z0-9-]{2,}/);
  return match ? match[0].replace(/-+$/, '') : null;
}

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export function ScanSheet({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied'>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [notACard, setNotACard] = useState(false);
  // The parent's onCode is usually an inline closure; going through a ref
  // keeps the camera effect from tearing down and restarting every render.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const doneRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let busy = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch {
        if (!cancelled) setStatus('denied');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // The tap that opened the sheet is the user gesture iOS wants.
      }
      if (cancelled) return;
      setStatus('scanning');

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      let detector: BarcodeDetectorLike | null = null;
      if (Detector) {
        try {
          detector = new Detector({ formats: ['qr_code'] });
        } catch {
          detector = null;
        }
      }

      timer = window.setInterval(() => {
        if (busy || doneRef.current || !context) return;
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return;
        busy = true;
        void (async () => {
          try {
            // Downscale before decoding — full camera frames make jsQR chew
            // an iPad's main thread for no extra reads.
            const scale = Math.min(1, 640 / Math.max(width, height));
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            let raw: string | null = null;
            if (detector) {
              try {
                raw = (await detector.detect(canvas))[0]?.rawValue ?? null;
              } catch {
                detector = null;
              }
            }
            if (!raw) {
              const image = context.getImageData(0, 0, canvas.width, canvas.height);
              raw = jsQR(image.data, image.width, image.height)?.data ?? null;
            }
            if (!raw || doneRef.current) return;
            const code = codeFromScan(raw);
            if (code) {
              doneRef.current = true;
              onCodeRef.current(code);
            } else {
              setNotACard(true);
            }
          } finally {
            busy = false;
          }
        })();
      }, 180);
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [facing]);

  return (
    <div className="gcscan" role="dialog" aria-label="Scan a gift card">
      <video ref={videoRef} className="gcscan-video" playsInline muted autoPlay />
      <div className="gcscan-frame" aria-hidden="true" />
      <div className="gcscan-top">
        <p className="gcscan-kicker">Point at the card&apos;s QR</p>
        <p className="gcscan-note">
          {status === 'denied'
            ? 'Camera is blocked — allow it in the browser settings, or type the code instead.'
            : notACard
              ? 'That QR isn&#39;t an ALMA gift card — use the one on the wallet pass or the printed card.'
              : 'Works with the wallet pass and the printed card.'}
        </p>
      </div>
      <div className="gcscan-actions">
        <button type="button" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>
          ⟲ Flip camera
        </button>
        <button type="button" onClick={onClose}>
          Type it instead
        </button>
      </div>
    </div>
  );
}

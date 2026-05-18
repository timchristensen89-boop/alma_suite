import { useRef, useState } from 'react';
import { Button } from '@alma/ui';
import { IconCamera, IconTrash } from '../../lib/icons';
import {
  STAFF_DOCUMENT_ACCEPT,
  isPreviewableImageUrl,
  openDocumentUrl,
  validateStaffDocumentFile
} from '../../lib/documentPreview';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

async function fileToCompressedDataUrl(file: File): Promise<string> {
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    // For non-image uploads, fall back to raw data URL (rare here; PDFs etc.)
    return await readAsDataUrl(file);
  }

  const originalUrl = await readAsDataUrl(file);
  try {
    const image = await loadImage(originalUrl);
    let { width, height } = image;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return originalUrl;
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return originalUrl;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image'));
    image.src = src;
  });
}

type Props = {
  label?: string;
  value: string;
  onChange: (next: string, meta: { name: string; size: number }) => void;
  hint?: string;
};

export function PhotoField({
  label = 'Document upload',
  value,
  onChange,
  hint
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    try {
      setWorking(true);
      setError(null);
      validateStaffDocumentFile(file);
      const dataUrl = await fileToCompressedDataUrl(file);
      onChange(dataUrl, { name: file.name, size: file.size });
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : 'Could not read the selected file.'
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: 12,
          border: '1px dashed var(--color-border)',
          borderRadius: 10,
          background: 'var(--color-surface-muted)'
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            flex: 'none',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--color-surface-hover)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--color-text-subtle)',
            border: '1px solid var(--color-border)'
          }}
        >
          {value && isPreviewableImageUrl(value) ? (
            <img
              src={value}
              alt="Preview"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : value ? (
            <span style={{ fontSize: 11, fontWeight: 700 }}>PDF</span>
          ) : (
            <IconCamera size={26} />
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<IconCamera size={14} />}
              onClick={() => inputRef.current?.click()}
              disabled={working}
            >
              {working ? 'Processing…' : value ? 'Replace document' : 'Upload document'}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openDocumentUrl(value)}
              >
                Preview
              </Button>
            ) : null}
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={<IconTrash size={14} />}
                onClick={() => onChange('', { name: '', size: 0 })}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <span className="subtle">
            {hint ?? 'PDF, PNG, JPEG, WebP or GIF. Maximum file size is 4MB.'}
          </span>
          {error ? <span className="error-text">{error}</span> : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={STAFF_DOCUMENT_ACCEPT}
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            // reset so the same file can be re-selected
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

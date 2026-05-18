export const STAFF_DOCUMENT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.png,.jpg,.jpeg,.webp,.gif';

const STAFF_DOCUMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const STAFF_DOCUMENT_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif']);
const STAFF_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

function extensionFor(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function validateStaffDocumentFile(file: File) {
  if (file.size > STAFF_DOCUMENT_MAX_BYTES) {
    throw new Error('Please upload a file smaller than 4MB.');
  }
  const type = file.type.toLowerCase();
  if (!STAFF_DOCUMENT_TYPES.has(type) && !STAFF_DOCUMENT_EXTENSIONS.has(extensionFor(file.name))) {
    throw new Error('Upload a PDF, PNG, JPEG, WebP, or GIF file.');
  }
}

function dataUrlToBlobUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const base64Flag = match[2] || '';
  const payload = match[3] || '';
  const decoded = base64Flag ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function isPreviewableImageUrl(url: string | null | undefined) {
  if (!url) return false;
  return url.startsWith('data:image/') || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url);
}

export function openDocumentUrl(documentUrl: string) {
  if (!documentUrl) return;
  let url = documentUrl;
  let revoke = false;
  if (documentUrl.startsWith('data:')) {
    const blobUrl = dataUrlToBlobUrl(documentUrl);
    if (!blobUrl) return;
    url = blobUrl;
    revoke = true;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  if (revoke) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

import { apiBlob } from './api';

export type PdfOpenOutcome = 'opened' | 'downloaded';

/**
 * Open a receipt, tax invoice or credit note as a PDF in a new tab.
 *
 * The PDF endpoint needs the bearer token, so the bytes are fetched with the
 * header (apiBlob) — never window.open on the API URL, which would arrive
 * without it. CORS exposes no response headers, so the server's filename is
 * out of reach; the download name is built here from the document number.
 */
export async function openDocumentPdf(doc: { id: string; number: string }): Promise<PdfOpenOutcome> {
  const blob = await apiBlob(`/api/invoices/${encodeURIComponent(doc.id)}/pdf`);
  return openPdfBlob(blob, `${doc.number}.pdf`);
}

/**
 * Show a PDF blob in a new tab, or download it when the tab is refused.
 *
 * window.open after an await can be refused by a popup blocker (Safari always
 * refuses); a download is never blocked, so that is the fallback. No
 * 'noopener' feature: with it window.open returns null even when the tab did
 * open, and the fallback would download a second copy — the opener is cut by
 * hand instead. The URL is revoked on a timer rather than straight away, or
 * the tab that was just opened loses its document.
 */
export function openPdfBlob(blob: Blob, filename: string): PdfOpenOutcome {
  // Typed explicitly so the tab renders it instead of offering a download.
  const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdf);
  const opened = window.open(url, '_blank');
  let outcome: PdfOpenOutcome = 'opened';
  if (opened) {
    opened.opener = null;
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.replace(/[^A-Za-z0-9._-]/g, '') || 'document.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    outcome = 'downloaded';
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return outcome;
}

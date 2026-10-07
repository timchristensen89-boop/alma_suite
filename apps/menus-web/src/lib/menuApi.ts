import type {
  MenuAuditEntry,
  MenuDiff,
  MenuDocument,
  MenuDraftPayload,
  MenuPublishPreview,
  MenuSummary,
  MenuVersionPayload,
  MenuVersionSummary
} from '@alma/shared';
import { api, apiBlob } from './api';

/** Typed wrappers over /api/menus. One place to look for every call the editor makes. */
export const menuApi = {
  list: () => api<{ menus: MenuSummary[]; renderer: { ok: boolean; message: string } }>('/api/menus'),
  get: (menuId: string) => api<MenuSummary>(`/api/menus/${menuId}`),
  getDraft: (menuId: string) => api<MenuDraftPayload>(`/api/menus/${menuId}/draft`),
  createDraft: (menuId: string) => api<MenuDraftPayload>(`/api/menus/${menuId}/draft`, { method: 'POST' }),
  saveDraft: (menuId: string, document: MenuDocument, expectedUpdatedAt?: string) =>
    api<MenuDraftPayload>(`/api/menus/${menuId}/draft`, { method: 'PUT', body: JSON.stringify({ ...document, expectedUpdatedAt }) }),
  discardDraft: (menuId: string) => api<{ ok: true }>(`/api/menus/${menuId}/draft`, { method: 'DELETE' }),
  publishPreview: (menuId: string) => api<MenuPublishPreview>(`/api/menus/${menuId}/draft/preview`, { method: 'POST' }),
  publish: (menuId: string, input: { expectedUpdatedAt?: string; acknowledgeWarnings: boolean }) =>
    api<MenuVersionPayload>(`/api/menus/${menuId}/draft/publish`, { method: 'POST', body: JSON.stringify(input) }),
  copyItemTo: (menuId: string, input: { dishKey: string; targetMenuId: string; targetSectionId?: string }) =>
    api<{ target: MenuDraftPayload; dishKey: string }>(`/api/menus/${menuId}/draft/items/copy-to`, { method: 'POST', body: JSON.stringify(input) }),
  listVersions: (menuId: string) => api<MenuVersionSummary[]>(`/api/menus/${menuId}/versions`),
  getVersion: (versionId: string) => api<MenuVersionPayload>(`/api/menus/versions/${versionId}`),
  diffVersion: (versionId: string, against: 'draft' | 'published' | string) =>
    api<{ from: MenuVersionSummary; to: MenuVersionSummary | null; diff: MenuDiff; summary: string }>(
      `/api/menus/versions/${versionId}/diff?against=${encodeURIComponent(against)}`
    ),
  restore: (versionId: string, replaceDraft: boolean) =>
    api<MenuDraftPayload>(`/api/menus/versions/${versionId}/restore`, { method: 'POST', body: JSON.stringify({ replaceDraft }) }),
  pdfBlob: (versionId: string) => apiBlob(`/api/menus/versions/${versionId}/pdf`),
  listAudit: (menuId: string) => api<MenuAuditEntry[]>(`/api/menus/${menuId}/audit`)
};

/**
 * Open a published version's PDF. The session is a bearer token, so a plain
 * link would 401: fetch the bytes with the header and hand the browser an
 * object URL. `print` opens it and asks the browser to print once loaded.
 */
export async function openVersionPdf(versionId: string, mode: 'view' | 'download' | 'print', filename: string) {
  const blob = await menuApi.pdfBlob(versionId);
  const url = URL.createObjectURL(blob);
  if (mode === 'download') {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  if (mode === 'print') {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank', 'noopener');
      }
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 120_000);
    };
    document.body.appendChild(frame);
    return;
  }
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) window.location.assign(url);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

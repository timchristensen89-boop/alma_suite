import type { MenuAuditEntry, PromotionCreateInput, PromotionDetail, PromotionFields, PromotionListPayload, PromotionPublishPreview } from '@alma/shared';
import { api } from './api';

/** What POST /api/menus/promotions accepts: the schema's input shape (every field but venueId and name has a default). */
export type PromotionCreateRequest = Partial<PromotionFields> & Pick<PromotionCreateInput, 'venueId' | 'name'> & { menuId?: string | null; createCard?: boolean };

/** What PATCH /api/menus/promotions/:id accepts: any subset of the fields, the card link, and the optimistic lock. */
export type PromotionUpdateRequest = Partial<PromotionFields> & { menuId?: string | null; expectedUpdatedAt?: string };

/** Typed wrappers over /api/menus/promotions. One place to look for every call the promotion screens make. */
export const promotionApi = {
  list: () => api<PromotionListPayload>('/api/menus/promotions'),
  get: (promotionId: string) => api<PromotionDetail>(`/api/menus/promotions/${promotionId}`),
  /** Publishers only. */
  create: (input: PromotionCreateRequest) => api<PromotionDetail>('/api/menus/promotions', { method: 'POST', body: JSON.stringify(input) }),
  update: (promotionId: string, input: PromotionUpdateRequest) => api<PromotionDetail>(`/api/menus/promotions/${promotionId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  setImage: (promotionId: string, input: { dataUrl: string; fileName: string; alt: string }) =>
    api<PromotionDetail>(`/api/menus/promotions/${promotionId}/image`, { method: 'PUT', body: JSON.stringify(input) }),
  removeImage: (promotionId: string) => api<PromotionDetail>(`/api/menus/promotions/${promotionId}/image`, { method: 'DELETE' }),
  publishPreview: (promotionId: string) => api<PromotionPublishPreview>(`/api/menus/promotions/${promotionId}/preview`),
  /** Publishers only. Publishes the listing and, when needed, the card, together. */
  publish: (promotionId: string, input: { acknowledgeWarnings: boolean; expectedUpdatedAt?: string }) =>
    api<PromotionDetail>(`/api/menus/promotions/${promotionId}/publish`, { method: 'POST', body: JSON.stringify(input) }),
  hide: (promotionId: string) => api<PromotionDetail>(`/api/menus/promotions/${promotionId}/hide`, { method: 'POST' }),
  show: (promotionId: string) => api<PromotionDetail>(`/api/menus/promotions/${promotionId}/show`, { method: 'POST' }),
  end: (promotionId: string) => api<PromotionDetail>(`/api/menus/promotions/${promotionId}/end`, { method: 'POST' }),
  listAudit: (promotionId: string) => api<MenuAuditEntry[]>(`/api/menus/promotions/${promotionId}/audit`)
};

/** Read a chosen file as the data URL the API wants. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

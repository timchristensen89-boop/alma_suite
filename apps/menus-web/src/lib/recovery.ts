import type { MenuDocument } from '@alma/shared';

/**
 * Unsaved editor content kept when a save is refused because the menu was
 * archived while it was open. Kept in this browser only (the server already
 * holds the draft as of its last successful save; this is what came after),
 * so it can be applied to the draft once the menu is unarchived, or
 * downloaded. Storage can be unavailable (private window, full quota): every
 * call is guarded, and the caller is told whether the copy was kept.
 *
 * The copy outlives "Apply": it is removed only once the server confirms a
 * save that carries the applied document (see saveConfirmsApply), and only if
 * the stored copy is still the one that was applied — a newer copy kept in
 * the meantime (another archive, another tab) is never removed by an older
 * save.
 */
export type UnsavedMenuChanges = {
  /** Identifies this copy, so clearing it can never remove a newer one. */
  id: string;
  menuId: string;
  /** "St Alma · Tuesday" — for the download and the banner. */
  menuLabel: string;
  draftVersionNumber: number;
  keptAt: string;
  document: MenuDocument;
};

const key = (menuId: string) => `alma.menus.unsaved.${menuId}`;

export function newRecoveryId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function keepUnsavedChanges(changes: UnsavedMenuChanges): boolean {
  try {
    window.localStorage.setItem(key(changes.menuId), JSON.stringify(changes));
    return true;
  } catch {
    return false;
  }
}

export function readUnsavedChanges(menuId: string): UnsavedMenuChanges | null {
  try {
    const raw = window.localStorage.getItem(key(menuId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnsavedMenuChanges>;
    if (parsed.menuId !== menuId || !parsed.document || !Array.isArray(parsed.document.sections)) return null;
    // A copy kept before copies carried ids is identified by when it was kept.
    return { ...parsed, id: parsed.id ?? parsed.keptAt ?? 'kept' } as UnsavedMenuChanges;
  } catch {
    return null;
  }
}

/**
 * Remove the kept copy. With `onlyId`, only if the stored copy is that one:
 * a save confirming an older apply must not remove a newer copy.
 */
export function forgetUnsavedChanges(menuId: string, onlyId?: string): void {
  try {
    if (onlyId !== undefined && readUnsavedChanges(menuId)?.id !== onlyId) return;
    window.localStorage.removeItem(key(menuId));
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/**
 * "Apply" put a kept copy into the editor as edit number `editSeq`. A save
 * confirms it only if the document that save sent was taken at or after that
 * edit — a save already on the wire before the apply does not.
 */
export type PendingRecoveryApply = { recoveryId: string; editSeq: number };

export function saveConfirmsApply(pending: PendingRecoveryApply | null, sentEditSeq: number): pending is PendingRecoveryApply {
  return pending !== null && sentEditSeq >= pending.editSeq;
}

/** A JSON copy the user can keep anywhere; the same shape the editor reads back. */
export function downloadUnsavedChanges(changes: UnsavedMenuChanges): void {
  const blob = new Blob([JSON.stringify(changes, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${changes.menuLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-unsaved-changes.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

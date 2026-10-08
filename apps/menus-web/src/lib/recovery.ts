import type { MenuDocument } from '@alma/shared';

/**
 * Unsaved editor content kept when a save is refused because the menu was
 * archived while it was open. Kept in this browser only (the server already
 * holds the draft as of its last successful save; this is what came after),
 * so it can be applied to the draft once the menu is unarchived, or
 * downloaded. Storage can be unavailable (private window, full quota): every
 * call is guarded, and the caller is told whether the copy was kept.
 */
export type UnsavedMenuChanges = {
  menuId: string;
  /** "St Alma · Tuesday" — for the download and the banner. */
  menuLabel: string;
  draftVersionNumber: number;
  keptAt: string;
  document: MenuDocument;
};

const key = (menuId: string) => `alma.menus.unsaved.${menuId}`;

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
    return parsed as UnsavedMenuChanges;
  } catch {
    return null;
  }
}

export function forgetUnsavedChanges(menuId: string): void {
  try {
    window.localStorage.removeItem(key(menuId));
  } catch {
    // Nothing kept, nothing to forget.
  }
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

import { RefObject, useEffect } from 'react';

const DISMISS_EVENT = 'alma:dismissible-layer-open';

type DismissEvent = CustomEvent<{ source: string }>;

export function notifyDismissibleLayerOpen(source: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DISMISS_EVENT, { detail: { source } }));
}

export function useDismissibleLayer(
  ref: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
  source: string
) {
  useEffect(() => {
    if (!open) return undefined;

    notifyDismissibleLayerOpen(source);

    function handlePointerDown(event: PointerEvent) {
      const node = ref.current;
      if (!node || node.contains(event.target as Node)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    function handleOtherLayer(event: Event) {
      const detail = (event as DismissEvent).detail;
      if (detail?.source !== source) onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener(DISMISS_EVENT, handleOtherLayer);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(DISMISS_EVENT, handleOtherLayer);
    };
  }, [onClose, open, ref, source]);
}

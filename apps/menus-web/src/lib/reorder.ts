/** Move the element at `from` to `to`, returning a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Pointer-based drag reorder for a vertical list. Handles mouse, touch and
 * pen through pointer events, so it works on the pass as well as a desk.
 * Returns the handlers to spread on each row's drag handle plus the index
 * currently being dragged and the index it would drop at.
 */
import { useCallback, useRef, useState } from 'react';

export type DragState = { from: number; over: number } | null;

export function useDragReorder(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<DragState>(null);
  const rowsRef = useRef<Array<HTMLElement | null>>([]);
  const dragRef = useRef<DragState>(null);

  const register = useCallback((index: number) => (element: HTMLElement | null) => {
    rowsRef.current[index] = element;
  }, []);

  const indexAtY = useCallback(
    (y: number) => {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < count; index += 1) {
        const row = rowsRef.current[index];
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        const distance = Math.abs(middle - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      return best;
    },
    [count]
  );

  const handleProps = useCallback(
    (index: number) => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragRef.current = { from: index, over: index };
        setDrag(dragRef.current);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (!dragRef.current) return;
        const over = indexAtY(event.clientY);
        if (over !== dragRef.current.over) {
          dragRef.current = { from: dragRef.current.from, over };
          setDrag(dragRef.current);
        }
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
        const current = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        try {
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          // already released
        }
        if (current && current.from !== current.over) onMove(current.from, current.over);
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setDrag(null);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        // Keyboard fallback: alt+arrow moves the row.
        if (!event.altKey) return;
        if (event.key === 'ArrowUp' && index > 0) {
          event.preventDefault();
          onMove(index, index - 1);
        }
        if (event.key === 'ArrowDown' && index < count - 1) {
          event.preventDefault();
          onMove(index, index + 1);
        }
      }
    }),
    [count, indexAtY, onMove]
  );

  return { drag, register, handleProps };
}

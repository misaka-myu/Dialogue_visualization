// src/renderer/hooks/useResizable.ts
// Generic horizontal splitter for sidebar / directory strip. The width lives
// in zustand (hydrated from localStorage at store init); this hook owns the
// mouse drag and emits new widths to the caller.

import { useCallback, useEffect, useRef } from 'react';

interface Options {
  side: 'left' | 'right';
  minWidth: number;
  maxWidth: number;
  storageKey: string;
  /** Read current width from caller state. */
  getWidth: () => number;
  onWidthChange: (w: number) => void;
}

/** Returns a `startResize` handler to wire to a divider's onMouseDown. */
export function useResizable({
  side,
  minWidth,
  maxWidth,
  storageKey,
  getWidth,
  onWidthChange,
}: Options): (e: React.MouseEvent) => void {
  const onWidthChangeRef = useRef(onWidthChange);
  useEffect(() => { onWidthChangeRef.current = onWidthChange; }, [onWidthChange]);

  // BUG-7 fix: keep a ref to the current drag handlers so the cleanup
  // function below can detach them if the component unmounts mid-drag
  // (e.g. user navigates while still holding the mouse down).
  // Otherwise the listeners leak on `document` and any subsequent
  // mousemove would call setState on an unmounted component.
  const activeDragRef = useRef<{
    onMove: (ev: MouseEvent) => void;
    onUp: () => void;
    prevBodyCursor: string;
    prevBodyUserSelect: string;
  } | null>(null);

  // On unmount, clean up any in-flight drag.
  useEffect(() => {
    return () => {
      const drag = activeDragRef.current;
      if (drag) {
        document.removeEventListener('mousemove', drag.onMove);
        document.removeEventListener('mouseup', drag.onUp);
        document.body.style.cursor = drag.prevBodyCursor;
        document.body.style.userSelect = drag.prevBodyUserSelect;
        activeDragRef.current = null;
      }
    };
  }, []);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = getWidth();

      const prevBodyCursor = document.body.style.cursor;
      const prevBodyUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        const next = clamp(startWidth + delta, minWidth, maxWidth);
        onWidthChangeRef.current(next);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = prevBodyCursor;
        document.body.style.userSelect = prevBodyUserSelect;
        activeDragRef.current = null;
        try { localStorage.setItem(storageKey, String(getWidth())); } catch { /* ignore */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      activeDragRef.current = { onMove, onUp, prevBodyCursor, prevBodyUserSelect };
    },
    [side, minWidth, maxWidth, storageKey, getWidth],
  );

  return startResize;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

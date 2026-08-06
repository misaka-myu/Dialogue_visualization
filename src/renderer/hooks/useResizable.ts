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
        try { localStorage.setItem(storageKey, String(getWidth())); } catch { /* ignore */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [side, minWidth, maxWidth, storageKey, getWidth],
  );

  return startResize;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
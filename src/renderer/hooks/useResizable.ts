// src/renderer/hooks/useResizable.ts
// Generic horizontal splitter for sidebar / directory strip. The width lives
// in zustand; this hook owns the mouse drag and emits new widths to the
// caller. Persistence to localStorage happens via a thin effect in the
// calling component (so we don't store anything here).

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

/** Hydrate the initial width from localStorage. Returns the value (or
 *  fallback if storage is unavailable / unset). */
export function readStoredWidth(storageKey: string, fallback: number): number {
  try {
    const v = localStorage.getItem(storageKey);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch { /* localStorage unavailable */ }
  return fallback;
}
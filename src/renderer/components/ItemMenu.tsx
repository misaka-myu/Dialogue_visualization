// src/renderer/components/ItemMenu.tsx
// Generic three-dots dropdown menu for sidebar list items. Renders an
// absolutely-positioned panel below the trigger; closes on outside click
// or Escape. The trigger button is positioned `absolute` so the parent
// list item keeps its own click behavior — place this component INSIDE a
// `position: relative` row and let the trigger sit at the right edge.

import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  /** Use 'danger' to render the action in red (destructive operations). */
  danger?: boolean;
}

interface Props {
  items: MenuItem[];
}

export function ItemMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', right: 4, top: 4, zIndex: 10 }}
      // Stop the parent <button>'s click handler (sidebar item) from firing
      // when the user clicks the dots.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="操作菜单"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid #444',
          color: 'inherit',
          cursor: 'pointer',
          padding: '0 6px',
          fontSize: 13,
          lineHeight: '18px',
          borderRadius: 3,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 100,
            minWidth: 120,
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            padding: 4,
          }}
        >
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: item.danger ? '#ff6b6b' : 'inherit',
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 3,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

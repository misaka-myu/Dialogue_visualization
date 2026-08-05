// src/renderer/components/ConversationDirectory.tsx
// Right-side panel listing every message in the current session. Clicking a
// row scrolls the chat to that message; rows are highlighted in sync with
// the chat viewport's topmost visible message.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useStore } from '../store';
import { getMessageTokenInfo, formatTokenCount } from '../utils/tokens';
import { copyMessageText, copyMessageJson } from '../utils/messageCopy';
import { getVirtuosoRef } from '../hooks/virtuosoRef';
import type { Message } from '../../main/model/types';

interface RoleStyle {
  icon: string;
  label: string;
}

const ROLE_STYLES: Record<Message['role'], RoleStyle> = {
  user: { icon: '👤', label: 'USER' },
  assistant: { icon: '🤖', label: 'ASSISTANT' },
  tool: { icon: '🛠', label: 'TOOL' },
  system: { icon: '⚙️', label: 'SYSTEM' },
};

function formatTs(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Local three-dots menu so we can inline it in the flex row without the
 *  absolute-wrapper nesting issue we hit with the shared ItemMenu. */
function RowMenu({ onCopyText, onCopyJson }: { onCopyText: () => void; onCopyJson: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginLeft: 4 }}>
      <button
        type="button"
        aria-label="操作菜单"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          background: 'transparent',
          border: '1px solid #444',
          color: 'inherit',
          cursor: 'pointer',
          padding: '0 6px',
          fontSize: 12,
          lineHeight: '18px',
          borderRadius: 3,
        }}
        className="directory-row-trigger"
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
            marginTop: 2,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onCopyText(); }}
            style={menuItemStyle}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            复制文本
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onCopyJson(); }}
            style={menuItemStyle}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            复制为 JSON
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 3,
};

function Row({ message, index, active }: { message: Message; index: number; active: boolean }) {
  const meta = message.meta;
  const role = ROLE_STYLES[message.role] ?? ROLE_STYLES.user;
  const tok = getMessageTokenInfo(message);
  const ts = formatTs(meta?.timestamp);
  const sidechain = meta?.isSidechain;

  const handleRowClick = useCallback(() => {
    useStore.getState().setActiveDirectoryIndex(index);
    const v = getVirtuosoRef();
    v?.scrollToIndex({ index, align: 'start', behavior: 'smooth' });
  }, [index]);

  const copyText = useCallback(() => {
    void copyMessageText(message);
  }, [message]);

  const copyJson = useCallback(() => {
    void copyMessageJson(message);
  }, [message]);

  return (
    <div
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleRowClick();
        }
      }}
      style={{
        padding: '6px 8px',
        borderBottom: '1px solid #2a2a2a',
        cursor: 'pointer',
        background: active ? '#2c4a6e' : 'transparent',
        borderLeft: active
          ? '3px solid #64b5f6'
          : sidechain
          ? '3px solid #ff8a65'
          : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ opacity: 0.5, width: 28 }}>#{index + 1}</span>
        <span style={{ fontSize: 13 }}>{role.icon}</span>
        <span style={{ fontWeight: 600 }}>{role.label}</span>
        <span
          style={{
            marginLeft: 'auto',
            opacity: 0.75,
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
          title={`${tok.count} tokens ${tok.real ? '(real)' : '(estimate)'}`}
        >
          {tok.real ? '✓' : '≈'} {formatTokenCount(tok.count)}
        </span>
        <RowMenu onCopyText={copyText} onCopyJson={copyJson} />
      </div>
      {ts && (
        <div style={{ fontSize: 10, opacity: 0.5, marginLeft: 34, marginTop: 2 }}>
          {ts}
        </div>
      )}
    </div>
  );
}

export function ConversationDirectory() {
  const session = useStore((s) => s.currentSession);
  const activeIndex = useStore((s) => s.activeDirectoryIndex);
  const messages = session?.conversation ?? [];

  if (!session) {
    return (
      <div style={{ width: 240, background: '#1e1e1e', borderLeft: '1px solid #333', padding: 12, fontSize: 12, opacity: 0.5 }}>
        从左侧选择一个会话
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div style={{ width: 240, background: '#1e1e1e', borderLeft: '1px solid #333', padding: 12, fontSize: 12, opacity: 0.5 }}>
        无对话
      </div>
    );
  }

  return (
    <div style={{ width: 240, background: '#1e1e1e', borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', fontSize: 11, opacity: 0.7 }}>
        对话目录 · {messages.length} 条
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Virtuoso
          data={messages}
          itemContent={(index, m) => (
            <Row message={m} index={index} active={activeIndex === index} />
          )}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}
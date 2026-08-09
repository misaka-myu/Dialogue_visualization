// src/renderer/views/ChatFlowView.tsx
import { useState, useMemo, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useStore } from '../store';
import { ContentBlock } from '../../main/model/types';
import { getMessageTokenInfo, formatTokenCount } from '../utils/tokens';
import { setVirtuosoRef } from '../hooks/virtuosoRef';

import { HoverCopyBar } from '../components/HoverCopyBar';
import { ContentBlockView } from '../components/ContentBlockView';
import { languageFromPath } from '../components/CodeViewer';

function Message({ role, blocks, meta, toolUseLangs }: { role: string; blocks: ContentBlock[]; meta?: import('../../main/model/types').MessageMeta; toolUseLangs?: Map<string, string> }) {
  const [open, setOpen] = useState(true);
  const colors: Record<string, { bg: string; label: string; icon: string }> = {
    user: { bg: 'rgba(144,202,250,0.1)', label: 'USER', icon: '👤' },
    assistant: { bg: 'rgba(155,140,255,0.1)', label: 'ASSISTANT', icon: '🤖' },
    tool: { bg: 'rgba(129,199,132,0.08)', label: 'TOOL', icon: '📥' },
    system: { bg: 'rgba(255,183,77,0.08)', label: 'SYSTEM', icon: '⚙️' },
  };
  const c = colors[role] ?? colors.user;
  const tok = getMessageTokenInfo({ role: role as import('../../main/model/types').Role, content: blocks, meta });
  const tokLabel = `${formatTokenCount(tok.count)} tok ${tok.real ? '✓' : '≈'}`;
  const ts = meta?.timestamp ? new Date(meta.timestamp).toLocaleString() : '';
  const msgObj = { role: role as import('../../main/model/types').Role, content: blocks, meta };

  return (
    <div className="message-container" style={{ position: 'relative', background: c.bg, padding: '6px 10px', marginBottom: 6, borderRadius: 6, borderLeft: meta?.isSidechain ? '3px solid #ff8a65' : 'none' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ fontSize: 10, fontWeight: 600, opacity: 0.7, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ opacity: 0.6 }}>{open ? '▼' : '▶'}</span>
        <span>{c.icon} {c.label} · {tokLabel}</span>
        {meta?.model && <span style={{ color: '#ffb74d' }}>🤖 {meta.model}</span>}
        {meta?.effort && <span style={{ opacity: 0.6 }}>effort: {meta.effort}</span>}
        {meta?.isSidechain && <span style={{ color: '#ff8a65' }}>↳ 侧链</span>}
        {ts && <span style={{ opacity: 0.5 }}>{ts}</span>}
        {meta?.gitBranch && <span style={{ opacity: 0.5 }}>🌿 {meta.gitBranch}</span>}
        <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <HoverCopyBar message={msgObj} />
        </div>
      </div>
      {open && blocks.map((b, i) => {
        const lang = b.type === 'tool_result' ? toolUseLangs?.get(b.toolUseId) : undefined;
        return <ContentBlockView key={i} block={b} lang={lang} variant="default" />;
      })}
    </div>
  );
}

export function ChatFlowView() {
  const session = useStore((s) => s.currentSession);
  const messages = session?.conversation ?? [];
  const system = session?.requests?.[0]?.system ?? [];
  const [systemOpen, setSystemOpen] = useState(false);

  const toolUseLangs = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of messages) {
      for (const b of msg.content) {
        if (b.type === 'tool_use' && b.input && typeof b.input === 'object') {
          const lang = languageFromPath((b.input as { file_path?: string }).file_path);
          if (lang) m.set(b.id, lang);
        }
      }
    }
    return m;
  }, [messages]);

  const setActiveDirectoryIndex = useStore((s) => s.setActiveDirectoryIndex);

  // Scroll-sync: when the visible range shifts, write the topmost index to
  // the store so ConversationDirectory can highlight the matching row.
  // Throttled with rAF to prevent rapid state churn and scroll jitter during fast scrolling.
  const directoryOpen = useStore((s) => s.directoryOpen);
  const rafIdRef = useRef<number | null>(null);

  const onRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (!directoryOpen) return;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (useStore.getState().activeDirectoryIndex !== range.startIndex) {
          setActiveDirectoryIndex(range.startIndex);
        }
      });
    },
    [directoryOpen, setActiveDirectoryIndex],
  );

  if (!session) {
    return <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {system.length > 0 && (
        <div style={{ padding: '6px 12px 0' }}>
          <button
            onClick={() => setSystemOpen(!systemOpen)}
            style={{ padding: '4px 8px', background: 'rgba(255,183,77,0.08)', border: 'none', borderRadius: 4, cursor: 'pointer', color: 'inherit' }}
          >
            ⚙️ SYSTEM · {formatTokenCount(Math.ceil(system.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0) / 4))} tok {systemOpen ? '▼' : '▶'}
          </button>
          {systemOpen && (
            <div style={{ maxHeight: '40vh', overflow: 'auto', marginTop: 4, padding: '8px 12px', background: 'rgba(255,183,77,0.08)', borderBottom: '1px solid #333', borderRadius: 4 }}>
              {system.map((b, i) => <ContentBlockView key={i} block={b} variant="default" />)}
            </div>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Virtuoso
          ref={setVirtuosoRef}
          rangeChanged={onRangeChanged}
          data={messages}
          defaultItemHeight={100}
          overscan={300}
          itemContent={(index, m) => (
            <div style={{ padding: '0 12px' }}>
              <Message role={m.role} blocks={m.content} meta={m.meta} toolUseLangs={toolUseLangs} />
            </div>
          )}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}

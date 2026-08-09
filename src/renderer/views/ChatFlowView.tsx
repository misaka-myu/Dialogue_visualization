// src/renderer/views/ChatFlowView.tsx
import { useState, useMemo, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useStore } from '../store';
import { ContentBlock } from '../../main/model/types';
import { CodeViewer, languageFromPath } from '../components/CodeViewer';
import { getMessageTokenInfo, formatTokenCount } from '../utils/tokens';
import { setVirtuosoRef } from '../hooks/virtuosoRef';

import { MarkdownViewer } from '../components/MarkdownViewer';
import { HoverCopyBar } from '../components/HoverCopyBar';
import { UserTextSegments } from '../components/CommandBlocks';
import { hasLocalCommandTags, parseUserTextSegments } from '../utils/commandParser';

function Block({ block, lang }: { block: ContentBlock; lang?: string }) {
  switch (block.type) {
    case 'text': {
      if (hasLocalCommandTags(block.text)) {
        return <UserTextSegments segments={parseUserTextSegments(block.text)} />;
      }
      return <MarkdownViewer content={block.text} />;
    }
    case 'tool_use':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(255,183,77,0.15)', borderRadius: 4, fontSize: 12 }}>
          <span>🔧 <strong>tool_use: {block.name}</strong></span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </div>
      );
    case 'tool_result': {
      const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(129,199,132,0.1)', borderLeft: '3px solid #81c784', borderRadius: '0 4px 4px 0', fontSize: 12 }}>
          <span style={{ color: '#81c784', fontWeight: 600 }}>📥 tool_result</span>
          <div style={{ marginTop: 4 }}>
            <CodeViewer value={raw} language={lang} />
          </div>
        </div>
      );
    }
    case 'thinking':
      return <ThinkingBlock text={block.thinking} signature={block.signature} />;
    default:
      return null;
  }
}

function ThinkingBlock({ text, signature }: { text: string; signature?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const charLen = text.length;
  const tokEstimate = Math.ceil(charLen / 4);

  return (
    <div style={{ marginTop: 4, background: 'rgba(206,147,216,0.08)', border: '1px solid rgba(206,147,216,0.2)', borderRadius: 4, fontSize: 12 }}>
      {/* Header bar */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', userSelect: 'none', background: 'rgba(206,147,216,0.06)',
          color: '#ce93d8', fontWeight: 600, fontSize: 11,
        }}
      >
        <span>💭 思考过程</span>
        <span style={{ opacity: 0.6, fontSize: 10 }}>· {charLen} 字 (≈{tokEstimate} tok)</span>
        {signature && (
          <span style={{ fontSize: 9, opacity: 0.6, background: 'rgba(256,256,256,0.1)', padding: '1px 4px', borderRadius: 3 }}>
            🔒 已校验签名
          </span>
        )}
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{collapsed ? '▶ 展开' : '▼ 收起'}</span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: '6px 10px', opacity: 0.9, lineHeight: 1.45, borderTop: '1px dashed rgba(206,147,216,0.15)' }}>
          {text ? <MarkdownViewer content={text} /> : <span style={{ opacity: 0.4 }}>(未捕获到具体思考文本)</span>}
        </div>
      )}
    </div>
  );
}

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
        return <Block key={i} block={b} lang={lang} />;
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
              {system.map((b, i) => <Block key={i} block={b} />)}
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

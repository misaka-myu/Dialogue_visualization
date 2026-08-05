// src/renderer/views/ChatFlowView.tsx
import { useState } from 'react';
import { useStore } from '../store';
import { ContentBlock } from '../../main/model/types';

const MAX_RENDERED_MESSAGES = 200;
const MAX_CONTENT_CHARS = 5000;

function truncateText(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS) + `… (截断，共 ${text.length} 字符)`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <div style={{ whiteSpace: 'pre-wrap' }}>{truncateText(block.text)}</div>;
    case 'tool_use':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(255,183,77,0.15)', borderRadius: 4, fontSize: 12 }}>
          <span>🔧 <strong>tool_use: {block.name}</strong></span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto' }}>
            {truncateText(JSON.stringify(block.input, null, 2))}
          </pre>
        </div>
      );
    case 'tool_result': {
      const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(129,199,132,0.1)', borderLeft: '3px solid #81c784', borderRadius: '0 4px 4px 0', fontSize: 12 }}>
          <span style={{ color: '#81c784', fontWeight: 600 }}>📥 tool_result</span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto' }}>
            {truncateText(raw)}
          </pre>
        </div>
      );
    }
    case 'thinking':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(206,147,216,0.1)', borderRadius: 4, fontSize: 12, opacity: 0.7 }}>
          💭 {truncateText(block.thinking)}
        </div>
      );
    default:
      return null;
  }
}

function Message({ role, blocks, meta }: { role: string; blocks: ContentBlock[]; meta?: import('../../main/model/types').MessageMeta }) {
  const colors: Record<string, { bg: string; label: string; icon: string }> = {
    user: { bg: 'rgba(144,202,250,0.1)', label: 'USER', icon: '👤' },
    assistant: { bg: 'rgba(155,140,255,0.1)', label: 'ASSISTANT', icon: '🤖' },
    tool: { bg: 'rgba(129,199,132,0.08)', label: 'TOOL', icon: '📥' },
    system: { bg: 'rgba(255,183,77,0.08)', label: 'SYSTEM', icon: '⚙️' },
  };
  const c = colors[role] ?? colors.user;
  const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const toks = estimateTokens(text);
  const ts = meta?.timestamp ? new Date(meta.timestamp).toLocaleString() : '';
  return (
    <div style={{ background: c.bg, padding: '6px 10px', marginBottom: 6, borderRadius: 6, borderLeft: meta?.isSidechain ? '3px solid #ff8a65' : 'none' }}>
      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.7, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>{c.icon} {c.label} · {toks} tok</span>
        {meta?.model && <span style={{ color: '#ffb74d' }}>🤖 {meta.model}</span>}
        {meta?.effort && <span style={{ opacity: 0.6 }}>effort: {meta.effort}</span>}
        {meta?.isSidechain && <span style={{ color: '#ff8a65' }}>↳ 侧链</span>}
        {ts && <span style={{ opacity: 0.5 }}>{ts}</span>}
        {meta?.gitBranch && <span style={{ opacity: 0.5 }}>🌿 {meta.gitBranch}</span>}
      </div>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  );
}

export function ChatFlowView() {
  const session = useStore((s) => s.currentSession);
  const messages = session?.conversation ?? [];
  const system = session?.requests?.[0]?.system ?? [];
  const [systemOpen, setSystemOpen] = useState(false);

  if (!session) {
    return <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>;
  }

  const capped = messages.slice(0, MAX_RENDERED_MESSAGES);
  const overflow = messages.length - capped.length;

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      {system.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <button
            onClick={() => setSystemOpen(!systemOpen)}
            style={{ padding: '4px 8px', background: 'rgba(255,183,77,0.08)', border: 'none', borderRadius: 4, cursor: 'pointer', color: 'inherit' }}
          >
            ⚙️ SYSTEM · {system.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0)} 字 {systemOpen ? '▼' : '▶'}
          </button>
          {systemOpen && system.map((b, i) => <Block key={i} block={b} />)}
        </div>
      )}
      {overflow > 0 && (
        <div style={{ padding: '4px 8px', marginBottom: 6, fontSize: 11, opacity: 0.6, background: 'rgba(255,183,77,0.06)', borderRadius: 4 }}>
          显示前 {MAX_RENDERED_MESSAGES} 条，共 {messages.length} 条
        </div>
      )}
      {capped.map((m, i) => (
        <Message key={i} role={m.role} blocks={m.content} meta={m.meta} />
      ))}
    </div>
  );
}

// src/renderer/views/ChatFlowView.tsx
import { useState } from 'react';
import { useStore } from '../store';
import { ContentBlock } from '../../main/model/types';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <div style={{ whiteSpace: 'pre-wrap' }}>{block.text}</div>;
    case 'tool_use':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(255,183,77,0.15)', borderRadius: 4, fontSize: 12 }}>
          <span>🔧 <strong>tool_use: {block.name}</strong></span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto' }}>
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </div>
      );
    case 'tool_result':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(129,199,132,0.1)', borderLeft: '3px solid #81c784', borderRadius: '0 4px 4px 0', fontSize: 12 }}>
          <span style={{ color: '#81c784', fontWeight: 600 }}>📥 tool_result</span>
          <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto' }}>
            {typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
          </pre>
        </div>
      );
    case 'thinking':
      return (
        <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(206,147,216,0.1)', borderRadius: 4, fontSize: 12, opacity: 0.7 }}>
          💭 {block.thinking}
        </div>
      );
    default:
      return null;
  }
}

function Message({ role, blocks }: { role: string; blocks: ContentBlock[] }) {
  const colors: Record<string, { bg: string; label: string; icon: string }> = {
    user: { bg: 'rgba(144,202,250,0.1)', label: 'USER', icon: '👤' },
    assistant: { bg: 'rgba(155,140,255,0.1)', label: 'ASSISTANT', icon: '🤖' },
    tool: { bg: 'rgba(129,199,132,0.08)', label: 'TOOL', icon: '📥' },
    system: { bg: 'rgba(255,183,77,0.08)', label: 'SYSTEM', icon: '⚙️' },
  };
  const c = colors[role] ?? colors.user;
  const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const toks = estimateTokens(text);
  return (
    <div style={{ background: c.bg, padding: '6px 10px', marginBottom: 6, borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>{c.icon} {c.label} · {toks} tok</div>
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  );
}

export function ChatFlowView() {
  const req = useStore((s) => s.currentRequest);
  const [systemOpen, setSystemOpen] = useState(false);

  if (!req) {
    return <div style={{ padding: 24, opacity: 0.5 }}>选中一个会话和请求以查看对话流</div>;
  }

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      {req.system.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <button
            onClick={() => setSystemOpen(!systemOpen)}
            style={{ padding: '4px 8px', background: 'rgba(255,183,77,0.08)', border: 'none', borderRadius: 4, cursor: 'pointer', color: 'inherit' }}
          >
            ⚙️ SYSTEM · {req.system.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0)} 字 {systemOpen ? '▼' : '▶'}
          </button>
          {systemOpen && req.system.map((b, i) => <Block key={i} block={b} />)}
        </div>
      )}
      {req.messages.map((m, i) => (
        <Message key={i} role={m.role} blocks={m.content} />
      ))}
      {req.response && (
        <Message role="assistant" blocks={req.response.content} />
      )}
    </div>
  );
}

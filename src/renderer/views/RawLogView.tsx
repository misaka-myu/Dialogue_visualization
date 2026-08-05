// src/renderer/views/RawLogView.tsx
import { useState } from 'react';
import { useStore } from '../store';
import { JsonNode } from './JsonTreeView';

const MAX_LINES = 500;

function lineType(line: Record<string, unknown>): string {
  if (typeof line.type === 'string') {
    if (line.type === 'user' || line.type === 'assistant') {
      const role = (line.message as { role?: string } | undefined)?.role;
      return role ? `${line.type}:${role}` : line.type;
    }
    return line.type;
  }
  return 'unknown';
}

function RawLine({ index, line }: { index: number; line: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const type = lineType(line);
  const ts = typeof line.timestamp === 'string' ? line.timestamp : '';
  return (
    <div style={{ borderBottom: '1px solid #222' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', padding: '4px 8px', display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}
      >
        <span style={{ opacity: 0.4, width: 16 }}>{open ? '▼' : '▶'}</span>
        <span style={{ opacity: 0.5, width: 44 }}>#{index}</span>
        <span style={{ color: '#9b8cff', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{type}</span>
        <span style={{ opacity: 0.5 }}>{ts}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 12px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
          <JsonNode label="" value={line} forceOpen={false} depth={0} />
        </div>
      )}
    </div>
  );
}

export function RawLogView() {
  const session = useStore((s) => s.currentSession);
  const [filter, setFilter] = useState('all');

  if (!session) {
    return <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>;
  }

  // Proxy-live captures only see structured API traffic — no underlying
  // JSONL lines exist. Show an explanation instead of a blank list.
  if (session.source === 'proxy-live') {
    return (
      <div style={{ padding: 24, opacity: 0.7 }}>
        实时捕获看不到原始 JSONL 行 —— 代理只转发 API 请求。
        <br />
        请切到 “对话流” 或 “JSON 树” 查看捕获内容。
      </div>
    );
  }

  const all = (session.rawLines ?? []) as Record<string, unknown>[];
  const types = Array.from(new Set(all.map(lineType)));
  const filtered = filter === 'all' ? all : all.filter((l) => lineType(l) === filter);
  const capped = filtered.slice(0, MAX_LINES);
  const overflow = filtered.length - capped.length;

  const btnStyle: React.CSSProperties = {
    padding: '3px 8px', fontSize: 11, cursor: 'pointer',
    background: 'transparent', border: '1px solid #444', color: 'inherit', borderRadius: 3,
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 12px', borderBottom: '1px solid #333', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, opacity: 0.6 }}>共 {all.length} 行</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: 3, fontSize: 11, background: '#222', color: 'inherit', border: '1px solid #444', borderRadius: 3 }}
        >
          <option value="all">全部类型</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {filter !== 'all' && <span style={{ fontSize: 11, opacity: 0.6 }}>筛选后 {filtered.length} 行</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {capped.map((line, i) => {
          const key = typeof line.uuid === 'string' ? line.uuid : `line-${i}`;
          return <RawLine key={key} index={i} line={line} />;
        })}
        {overflow > 0 && (
          <div style={{ padding: '8px 12px', fontSize: 11, opacity: 0.5 }}>
            … 还有 {overflow} 行（已截断，仅显示前 {MAX_LINES} 行）
          </div>
        )}
      </div>
    </div>
  );
}

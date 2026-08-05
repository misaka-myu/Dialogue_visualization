// src/renderer/views/JsonTreeView.tsx
import { useState } from 'react';
import { useStore } from '../store';

const MAX_ARRAY_CHILDREN = 50;
const DEFAULT_OPEN_DEPTH = 2;

function typeColor(type: string): string {
  switch (type) {
    case 'tool_use': return '#ffb74d';
    case 'tool_result': return '#81c784';
    case 'text': return '#90caf9';
    case 'thinking': return '#ce93d8';
    default: return '#ccc';
  }
}

interface NodeProps {
  label?: string;
  value: unknown;
  forceOpen: boolean;
  depth: number;
}

export function JsonNode({ label, value, forceOpen, depth }: NodeProps) {
  const [localOpen, setLocalOpen] = useState(depth < DEFAULT_OPEN_DEPTH);
  const [showAll, setShowAll] = useState(false);
  const open = forceOpen || localOpen;

  if (value === null || value === undefined) {
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        {label && <span style={{ color: '#9b8cff' }}>{label}: </span>}
        <span style={{ opacity: 0.5 }}>{value === null ? 'null' : 'undefined'}</span>
      </div>
    );
  }
  if (typeof value === 'string') {
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        {label && <span style={{ color: '#9b8cff' }}>{label}: </span>}
        <span style={{ color: '#90caf9' }}>"{value.length > 80 ? value.slice(0, 80) + '…' : value}"</span>
      </div>
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        {label && <span style={{ color: '#9b8cff' }}>{label}: </span>}
        <span style={{ color: '#ffb74d' }}>{String(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const allEntries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as object);
  const capped = !showAll && allEntries.length > MAX_ARRAY_CHILDREN ? allEntries.slice(0, MAX_ARRAY_CHILDREN) : allEntries;
  const overflow = allEntries.length - capped.length;

  const blockType = typeof value === 'object' && value !== null && typeof (value as any).type === 'string' ? (value as any).type : undefined;

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 14, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setLocalOpen(!localOpen)}
      >
        <span style={{ opacity: 0.6 }}>{open ? '▼' : '▶'}</span>
        {label && <span style={{ color: '#9b8cff' }}> {label}</span>}
        {blockType && <span style={{ color: typeColor(blockType), marginLeft: 6 }}>[{blockType}]</span>}
        <span style={{ opacity: 0.4, marginLeft: 6 }}>{isArray ? `[${allEntries.length}]` : `{${allEntries.length}}`}</span>
      </div>
      {open && (
        <>
          {capped.map(([k, v]) => (
            <JsonNode key={k} label={k} value={v} forceOpen={forceOpen} depth={depth + 1} />
          ))}
          {overflow > 0 && (
            <button
              onClick={() => setShowAll(true)}
              style={{ marginLeft: (depth + 1) * 14, fontSize: 11, opacity: 0.7, background: 'transparent', border: '1px solid #444', color: 'inherit', borderRadius: 3, padding: '2px 8px', cursor: 'pointer' }}
            >
              … 展开剩余 {overflow} 项（当前仅显示前 {MAX_ARRAY_CHILDREN} 项）
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function JsonTreeView() {
  const session = useStore((s) => s.currentSession);
  const [forceOpen, setForceOpen] = useState(false);

  if (!session) {
    return <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>;
  }

  const btnStyle: React.CSSProperties = {
    padding: '3px 8px', fontSize: 11, cursor: 'pointer',
    background: 'transparent', border: '1px solid #444', color: 'inherit', borderRadius: 3,
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 12px', borderBottom: '1px solid #333', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button style={btnStyle} onClick={() => setForceOpen(true)}>展开全部</button>
        <button style={btnStyle} onClick={() => setForceOpen(false)}>折叠到默认</button>
        <span style={{ opacity: 0.5, fontSize: 11 }}>大数组截断显示前 {MAX_ARRAY_CHILDREN} 项</span>
      </div>
      <div style={{ padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 12, overflow: 'auto', flex: 1 }}>
        <JsonNode label="session" value={session} forceOpen={forceOpen} depth={0} />
      </div>
    </div>
  );
}

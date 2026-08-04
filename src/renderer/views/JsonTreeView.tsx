// src/renderer/views/JsonTreeView.tsx
import { useState } from 'react';
import { useStore } from '../store';
import { ApiRequest } from '../../main/model/types';

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
  defaultOpen?: boolean;
  depth: number;
}

function JsonNode({ label, value, defaultOpen = true, depth }: NodeProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (value === null) {
    return <div style={{ paddingLeft: depth * 14 }}>{label && <span style={{ color: '#9b8cff' }}>{label}: </span>}<span style={{ opacity: 0.5 }}>null</span></div>;
  }
  if (typeof value === 'string') {
    return <div style={{ paddingLeft: depth * 14 }}>{label && <span style={{ color: '#9b8cff' }}>{label}: </span>}<span style={{ color: '#90caf9' }}>"{value.length > 80 ? value.slice(0, 80) + '…' : value}"</span></div>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <div style={{ paddingLeft: depth * 14 }}>{label && <span style={{ color: '#9b8cff' }}>{label}: </span>}<span style={{ color: '#ffb74d' }}>{String(value)}</span></div>;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as object);

  const blockType = typeof value === 'object' && value !== null && 'type' in (value as any) ? (value as any).type : undefined;

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 14, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ opacity: 0.6 }}>{open ? '▼' : '▶'}</span>
        {label && <span style={{ color: '#9b8cff' }}> {label}</span>}
        {blockType && <span style={{ color: typeColor(blockType), marginLeft: 6 }}>[{blockType}]</span>}
        <span style={{ opacity: 0.4, marginLeft: 6 }}>{isArray ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </div>
      {open && entries.map(([k, v]) => (
        <JsonNode key={k} label={k} value={v} defaultOpen={depth < 1} depth={depth + 1} />
      ))}
    </div>
  );
}

export function JsonTreeView() {
  const req = useStore((s) => s.currentRequest);
  if (!req) {
    return <div style={{ padding: 24, opacity: 0.5 }}>选中一个会话和请求以查看 JSON 结构</div>;
  }
  const view: Partial<ApiRequest> = {
    model: req.model,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
    params: req.params,
    response: req.response,
  };
  return (
    <div style={{ padding: 12, fontFamily: 'ui-monospace, monospace', fontSize: 12, overflow: 'auto', height: '100%' }}>
      <JsonNode value={view} defaultOpen={true} depth={0} />
    </div>
  );
}

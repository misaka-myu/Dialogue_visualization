// src/renderer/views/JsonTreeView.tsx
import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useStore } from '../store';

const MAX_ARRAY_CHILDREN = 50;
const DEFAULT_OPEN_DEPTH = 1;

function typeColor(type: string): string {
  switch (type) {
    case 'tool_use': return '#ffb74d';
    case 'tool_result': return '#81c784';
    case 'text': return '#90caf9';
    case 'thinking': return '#ce93d8';
    default: return '#ccc';
  }
}

// ---- Legacy recursive JsonNode (used by RawLogView for per-line expansion) ----
interface LegacyNodeProps {
  label?: string;
  value: unknown;
  forceOpen: boolean;
  depth: number;
}

export function JsonNode({ label, value, forceOpen, depth }: LegacyNodeProps) {
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

// ---- Virtualized JSON tree (only renders visible rows) ----
interface Row {
  path: string;
  label: string;
  value: unknown;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  isArray: boolean;
  blockType?: string;
  isOverflow?: boolean;
  overflowCount?: number;
}

interface Opts {
  forceOpen: boolean;
  openPaths: Set<string>;
  closedPaths: Set<string>;
  showAllPaths: Set<string>;
}

function isOpen(path: string, depth: number, opts: Opts): boolean {
  if (opts.forceOpen) return true;
  if (opts.closedPaths.has(path)) return false;
  return opts.openPaths.has(path) || depth < DEFAULT_OPEN_DEPTH;
}

function walk(value: unknown, path: string, label: string, depth: number, opts: Opts, out: Row[]): void {
  const isObj = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const childCount = isObj ? (isArray ? (value as unknown[]).length : Object.keys(value as object).length) : 0;
  const blockType = isObj && typeof (value as any).type === 'string' ? (value as any).type : undefined;
  out.push({ path, label, value, depth, hasChildren: childCount > 0, childCount, isArray, blockType });
  if (isObj && isOpen(path, depth, opts)) {
    let entries: [string, unknown][];
    if (isArray) entries = (value as unknown[]).map((v, i) => [String(i), v]);
    else entries = Object.entries(value as object);
    const capped = !opts.showAllPaths.has(path) && entries.length > MAX_ARRAY_CHILDREN ? entries.slice(0, MAX_ARRAY_CHILDREN) : entries;
    const overflow = entries.length - capped.length;
    for (const [k, v] of capped) {
      walk(v, path + '.' + k, k, depth + 1, opts, out);
    }
    if (overflow > 0) {
      out.push({ path: path + '.__overflow__', label: '', value: null, depth: depth + 1, hasChildren: false, childCount: 0, isArray: false, isOverflow: true, overflowCount: overflow });
    }
  }
}

function leafPreview(value: unknown): { text: string; color: string } | null {
  if (value === null) return { text: 'null', color: '#888' };
  if (value === undefined) return { text: 'undefined', color: '#888' };
  if (typeof value === 'string') return { text: `"${value.length > 80 ? value.slice(0, 80) + '…' : value}"`, color: '#90caf9' };
  if (typeof value === 'number' || typeof value === 'boolean') return { text: String(value), color: '#ffb74d' };
  return null;
}

export function JsonTreeView() {
  const session = useStore((s) => s.currentSession);
  const [forceOpen, setForceOpen] = useState(false);
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [closedPaths, setClosedPaths] = useState<Set<string>>(new Set());
  const [showAllPaths, setShowAllPaths] = useState<Set<string>>(new Set());

  const opts: Opts = { forceOpen, openPaths, closedPaths, showAllPaths };

  const rows = useMemo(() => {
    if (!session) return [];
    const out: Row[] = [];
    walk(session, '', 'session', 0, opts, out);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, forceOpen, openPaths, closedPaths, showAllPaths]);

  if (!session) {
    return <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>;
  }

  const toggle = (path: string, depth: number) => {
    if (forceOpen) return;
    const open = isOpen(path, depth, opts);
    if (open) {
      const op = new Set(openPaths);
      op.delete(path);
      setOpenPaths(op);
      const cp = new Set(closedPaths);
      cp.add(path);
      setClosedPaths(cp);
    } else {
      const cp = new Set(closedPaths);
      cp.delete(path);
      setClosedPaths(cp);
      const op = new Set(openPaths);
      op.add(path);
      setOpenPaths(op);
    }
  };

  const resetDefault = () => {
    setForceOpen(false);
    setOpenPaths(new Set());
    setClosedPaths(new Set());
    setShowAllPaths(new Set());
  };

  const btnStyle: React.CSSProperties = { padding: '3px 8px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: '1px solid #444', color: 'inherit', borderRadius: 3 };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 12px', borderBottom: '1px solid #333', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button style={btnStyle} onClick={() => setForceOpen(true)}>展开全部</button>
        <button style={btnStyle} onClick={resetDefault}>折叠到默认</button>
        <span style={{ opacity: 0.5, fontSize: 11 }}>{rows.length} 个可见节点（虚拟化）</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Virtuoso
          data={rows}
          itemContent={(_i, row) => {
            if (row.isOverflow) {
              // BUG-6: anchor the replace to the END of the path so we never
              // accidentally strip a '.__overflow__' segment that happens to
              // appear earlier in the key chain (defensive; current code
              // shouldn't construct such paths, but the regex makes the
              // intent explicit and resilient if that ever changes).
              const parentPath = row.path.replace(/.__overflow__$/, '');
              return (
                <button
                  onClick={() => setShowAllPaths(new Set(showAllPaths).add(parentPath))}
                  style={{ marginLeft: row.depth * 14, fontSize: 11, opacity: 0.7, background: 'transparent', border: '1px solid #444', color: 'inherit', borderRadius: 3, padding: '2px 8px', cursor: 'pointer' }}
                >
                  … 展开剩余 {row.overflowCount} 项
                </button>
              );
            }
            const open = isOpen(row.path, row.depth, opts);
            const preview = leafPreview(row.value);
            const clickable = row.hasChildren && !forceOpen;
            return (
              <div
                onClick={() => clickable && toggle(row.path, row.depth)}
                style={{ paddingLeft: row.depth * 14, paddingRight: 12, cursor: clickable ? 'pointer' : 'default', userSelect: 'none', padding: '1px 0', fontSize: 12, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre' }}
              >
                {row.hasChildren ? <span style={{ opacity: 0.6 }}>{open ? '▼' : '▶'}</span> : <span style={{ opacity: 0 }}>·</span>}
                {row.label && <span style={{ color: '#9b8cff' }}> {row.label}</span>}
                {row.blockType && <span style={{ color: typeColor(row.blockType), marginLeft: 6 }}>[{row.blockType}]</span>}
                {row.hasChildren && <span style={{ opacity: 0.4, marginLeft: 6 }}>{row.isArray ? `[${row.childCount}]` : `{${row.childCount}}`}</span>}
                {preview && <span style={{ color: preview.color, marginLeft: 6 }}>{preview.text}</span>}
              </div>
            );
          }}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}

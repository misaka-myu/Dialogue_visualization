// src/renderer/components/Sidebar.tsx
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ItemMenu, MenuItem } from './ItemMenu';
import { useResizable, readStoredWidth } from '../hooks/useResizable';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inline-styled list item with an absolutely-positioned ItemMenu. We use a
 *  div + onClick (not a <button>) so the menu trigger can sit on top without
 *  nested-button issues. Keyboard accessibility is a known compromise; the
 *  primary "open" action is also bound to Enter/Space via the onKeyDown
 *  handler below. */
function ListRow({
  active,
  onClick,
  menuItems,
  children,
}: {
  active: boolean;
  onClick: () => void;
  menuItems: MenuItem[];
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 28px 6px 6px',
        marginBottom: 4,
        borderRadius: 4,
        cursor: 'pointer',
        background: active ? 'rgba(155,140,255,0.2)' : 'transparent',
        color: 'inherit',
        outline: 'none',
        border: 'none',
      }}
    >
      {children}
      {/* Show the menu button on hover, or always show when the item is active. */}
      {(hovered || active) && <ItemMenu items={menuItems} />}
    </div>
  );
}

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const liveHistory = useStore((s) => s.liveHistory);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const refreshLiveHistory = useStore((s) => s.refreshLiveHistory);
  const openSession = useStore((s) => s.openSession);
  const openLive = useStore((s) => s.openLive);
  const currentSession = useStore((s) => s.currentSession);
  const proxyStatus = useStore((s) => s.proxyStatus);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const [isHandleHover, setIsHandleHover] = useState(false);

  // Hydrate from localStorage once on mount; the hook then handles writes
  // on each drag-end.
  useEffect(() => {
    const stored = readStoredWidth('dialogueviz.sidebar.width', 240);
    const clamped = Math.max(160, Math.min(480, stored));
    if (clamped !== sidebarWidth) setSidebarWidth(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSidebarResize = useResizable({
    side: 'left',
    minWidth: 160,
    maxWidth: 480,
    storageKey: 'dialogueviz.sidebar.width',
    getWidth: () => useStore.getState().sidebarWidth,
    onWidthChange: setSidebarWidth,
  });

  const deleteLiveCapture = useStore((s) => s.deleteLiveCapture);
  const renameLiveCapture = useStore((s) => s.renameLiveCapture);
  const exportLiveCapture = useStore((s) => s.exportLiveCapture);
  const deleteClaudeSession = useStore((s) => s.deleteClaudeSession);
  const exportClaudeSession = useStore((s) => s.exportClaudeSession);
  const pickExportPath = useStore((s) => s.pickExportPath);

  useEffect(() => {
    refreshSessions();
    refreshLiveHistory();
  }, [refreshSessions, refreshLiveHistory]);

  // A loaded-from-history session is identified by the file path; live capture
  // uses the in-memory id. The store tracks the open path explicitly.
  const currentSourcePath = useStore((s) => s.openSourcePath);

  // --- Live capture action handlers ---
  function handleLiveRename(path: string, currentTitle: string) {
    // The plan calls for a prompt with the current title as the default.
    // Browsers don't support `defaultValue` in `window.prompt`; we just
    // prefill via concatenation so the user can edit/clear it.
    const next = window.prompt('重命名历史捕获：', currentTitle);
    if (next === null) return; // canceled
    const trimmed = next.trim();
    if (!trimmed) {
      window.alert('标题不能为空。');
      return;
    }
    if (trimmed === currentTitle) return;
    renameLiveCapture(path, trimmed).then((result) => {
      if (result === null) window.alert('重命名失败，请检查文件是否可写。');
    });
  }

  function handleLiveDelete(path: string, title: string) {
    const ok = window.confirm(`确定要删除历史捕获 “${title}” 吗？\n\n该操作不可撤销。`);
    if (!ok) return;
    deleteLiveCapture(path).then((success) => {
      if (!success) window.alert('删除失败，请检查文件是否被占用。');
    });
  }

  function handleLiveExport(path: string, title: string) {
    const safeName = title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'capture';
    pickExportPath(`${safeName}.json`).then((exportPath) => {
      if (!exportPath) return;
      exportLiveCapture(path, exportPath).then((result) => {
        if (result === null) window.alert('导出失败，请检查目标路径。');
        else window.alert(`已导出到：\n${result}`);
      });
    });
  }

  // --- Claude Code action handlers (destructive) ---
  function handleClaudeDelete(sourcePath: string, title: string) {
    const display = title || sourcePath;
    const ok = window.confirm(
      `警告：将永久删除 Claude Code 会话 “${display}”\n\n` +
        `此操作会从 ~/.claude/projects/ 删除原始 JSONL 文件，Claude Code 中也会消失。\n\n` +
        `建议先点 “导出” 留一份副本。\n\n确定要继续吗？`
    );
    if (!ok) return;
    deleteClaudeSession(sourcePath).then((success) => {
      if (!success) window.alert('删除失败，请检查文件是否被占用。');
    });
  }

  function handleClaudeExport(sourcePath: string, sessionId: string) {
    const safeName = (sessionId || 'session').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    pickExportPath(`${safeName}.jsonl`).then((exportPath) => {
      if (!exportPath) return;
      exportClaudeSession(sourcePath, exportPath).then((result) => {
        if (result === null) window.alert('导出失败，请检查目标路径。');
        else window.alert(`已导出到：\n${result}`);
      });
    });
  }

  return (
    <div style={{ display: 'flex', flexShrink: 0, width: sidebarWidth + 4 }}>
      <div style={{ width: sidebarWidth, borderRight: '1px solid #333', padding: 8, overflowY: 'auto', overflowX: 'hidden' }}>
        {proxyStatus && currentSession?.source === 'proxy-live' && (
        <>
          <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8, color: '#81c784' }}>● 实时捕获</div>
          <div
            style={{ padding: 6, marginBottom: 12, borderRadius: 4, background: 'rgba(129,199,132,0.1)', borderLeft: '2px solid #81c784' }}
          >
            <div style={{ fontSize: 12 }}>{currentSession.title ?? '实时捕获'}</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>{currentSession.requests.length} 请求 · {currentSession.conversation.length} 条</div>
          </div>
        </>
      )}
      {proxyStatus && currentSession?.source !== 'proxy-live' && (
        <>
          <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8, color: '#81c784' }}>● 实时捕获</div>
          <button
            onClick={() => useStore.getState().goToLive()}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: 6, marginBottom: 12, borderRadius: 4, cursor: 'pointer', background: 'rgba(129,199,132,0.08)', border: '1px solid #81c784', color: 'inherit' }}
          >
            <div style={{ fontSize: 12 }}>返回实时捕获</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>点击切回正在捕获的会话</div>
          </button>
        </>
      )}
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8, color: '#9b8cff' }}>● 历史捕获</div>
      {liveHistory.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 12 }}>暂无历史</div>
      )}
      {liveHistory.map((m) => (
        <ListRow
          key={m.path}
          active={currentSourcePath === m.path}
          onClick={() => openLive(m.path)}
          menuItems={[
            { label: '重命名', onClick: () => handleLiveRename(m.path, m.title) },
            { label: '导出', onClick: () => handleLiveExport(m.path, m.title) },
            { label: '删除', onClick: () => handleLiveDelete(m.path, m.title), danger: true },
          ]}
        >
          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{m.title}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>{m.requestCount} 请求 · {formatTime(m.startedAt)} · {m.sizeKB}KB</div>
        </ListRow>
      ))}
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>Claude Code 会话</div>
      {sessions.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.5 }}>未找到会话</div>
      )}
      {sessions.map((s) => (
        <ListRow
          key={s.sourcePath}
          active={currentSourcePath === s.sourcePath}
          onClick={() => openSession(s.sourcePath)}
          menuItems={[
            { label: '导出', onClick: () => handleClaudeExport(s.sourcePath, s.sessionId) },
            { label: '删除', onClick: () => handleClaudeDelete(s.sourcePath, s.title ?? s.sessionId), danger: true },
          ]}
        >
          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.title ?? s.sessionId}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>{s.projectDir ?? ''}</div>
        </ListRow>
      ))}
      </div>
      <div
        onMouseDown={startSidebarResize}
        onMouseEnter={() => setIsHandleHover(true)}
        onMouseLeave={() => setIsHandleHover(false)}
        title="拖动调整侧栏宽度"
        style={{
          width: 4,
          cursor: 'col-resize',
          background: isHandleHover ? '#666' : 'transparent',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      />
    </div>
  );
}

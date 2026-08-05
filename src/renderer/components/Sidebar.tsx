// src/renderer/components/Sidebar.tsx
import { useEffect } from 'react';
import { useStore } from '../store';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const setCurrentSession = useStore((s) => s.setCurrentSession);

  useEffect(() => {
    refreshSessions();
    refreshLiveHistory();
  }, [refreshSessions, refreshLiveHistory]);

  // A loaded-from-history session is identified by the file path; live capture
  // uses the in-memory id. Compare on the path when available.
  const currentSourcePath = currentSession && 'sourcePath' in currentSession
    ? (currentSession as unknown as { sourcePath?: string }).sourcePath
    : undefined;

  return (
    <div style={{ width: 240, borderRight: '1px solid #333', padding: 8, overflowY: 'auto' }}>
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
        <button
          key={m.path}
          onClick={() => openLive(m.path)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: 6, marginBottom: 4, borderRadius: 4, cursor: 'pointer',
            background: currentSourcePath === m.path ? 'rgba(155,140,255,0.2)' : 'transparent',
            border: 'none', color: 'inherit',
          }}
        >
          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>{m.requestCount} 请求 · {formatTime(m.startedAt)} · {m.sizeKB}KB</div>
        </button>
      ))}
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>Claude Code 会话</div>
      {sessions.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.5 }}>未找到会话</div>
      )}
      {sessions.map((s) => (
        <button
          key={s.sourcePath}
          onClick={() => openSession(s.sourcePath)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: 6, marginBottom: 4, borderRadius: 4, cursor: 'pointer',
            background: currentSession?.id === s.sessionId ? 'rgba(155,140,255,0.2)' : 'transparent',
            border: 'none', color: 'inherit',
          }}
        >
          <div style={{ fontSize: 12 }}>{s.title ?? s.sessionId}</div>
          <div style={{ fontSize: 10, opacity: 0.5 }}>{s.projectDir ?? ''}</div>
        </button>
      ))}
    </div>
  );
}

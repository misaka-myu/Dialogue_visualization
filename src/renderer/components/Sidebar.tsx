// src/renderer/components/Sidebar.tsx
import { useEffect } from 'react';
import { useStore } from '../store';

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const openSession = useStore((s) => s.openSession);
  const currentSession = useStore((s) => s.currentSession);
  const proxyStatus = useStore((s) => s.proxyStatus);
  const setCurrentSession = useStore((s) => s.setCurrentSession);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

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
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>Claude Code 会话</div>
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

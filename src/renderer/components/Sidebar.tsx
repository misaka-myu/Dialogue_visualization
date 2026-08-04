// src/renderer/components/Sidebar.tsx
import { useEffect } from 'react';
import { useStore } from '../store';

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const openSession = useStore((s) => s.openSession);
  const currentSession = useStore((s) => s.currentSession);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return (
    <div style={{ width: 240, borderRight: '1px solid #333', padding: 8, overflowY: 'auto' }}>
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
        Claude Code 会话
      </div>
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

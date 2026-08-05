// src/renderer/components/ViewSwitcher.tsx
import { useStore, ViewKind } from '../store';

export function ViewSwitcher() {
  const currentView = useStore((s) => s.currentView);
  const setCurrentView = useStore((s) => s.setCurrentView);
  const currentSession = useStore((s) => s.currentSession);

  const views: { kind: ViewKind; label: string }[] = [
    { kind: 'chat-flow', label: '对话流' },
    { kind: 'json-tree', label: 'JSON 树' },
    { kind: 'raw-log', label: '原始日志' },
  ];

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid #333' }}>
      {views.map((v) => (
        <button
          key={v.kind}
          onClick={() => setCurrentView(v.kind)}
          style={{
            padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
            background: currentView === v.kind ? 'rgba(155,140,255,0.3)' : 'transparent',
            border: '1px solid #444', color: 'inherit',
          }}
        >
          {v.label}
        </button>
      ))}
      {currentSession && (
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>
          {currentSession.requests.length} 请求 · {currentSession.conversation.length} 条对话
        </span>
      )}
    </div>
  );
}

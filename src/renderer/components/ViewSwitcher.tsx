// src/renderer/components/ViewSwitcher.tsx
import { useStore, ViewKind } from '../store';

export function ViewSwitcher() {
  const currentView = useStore((s) => s.currentView);
  const setCurrentView = useStore((s) => s.setCurrentView);
  const currentSession = useStore((s) => s.currentSession);
  const currentRequest = useStore((s) => s.currentRequest);
  const setCurrentRequest = useStore((s) => s.setCurrentRequest);

  const views: { kind: ViewKind; label: string }[] = [
    { kind: 'chat-flow', label: '对话流' },
    { kind: 'json-tree', label: 'JSON 树' },
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
        <select
          value={currentRequest?.id ?? ''}
          onChange={(e) => {
            const req = currentSession.requests.find((r) => r.id === e.target.value);
            setCurrentRequest(req ?? null);
          }}
          style={{ marginLeft: 'auto', padding: 4, background: '#222', color: 'inherit', border: '1px solid #444' }}
        >
          {currentSession.requests.map((r, i) => (
            <option key={r.id} value={r.id}>请求 #{i + 1}</option>
          ))}
        </select>
      )}
    </div>
  );
}

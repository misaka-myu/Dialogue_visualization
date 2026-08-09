// src/renderer/components/ViewSwitcher.tsx
import { useStore, ViewKind } from '../store';

export function ViewSwitcher() {
  const currentView = useStore((s) => s.currentView);
  const setCurrentView = useStore((s) => s.setCurrentView);
  const currentSession = useStore((s) => s.currentSession);
  const proxyStatus = useStore((s) => s.proxyStatus);
  const startCapture = useStore((s) => s.startCapture);
  const startCodexCapture = useStore((s) => s.startCodexCapture);
  const stopCapture = useStore((s) => s.stopCapture);

  const views: { kind: ViewKind; label: string }[] = [
    { kind: 'chat-flow', label: '💬 对话流' },
    { kind: 'api-inspector', label: '📡 API 请求明细' },
    { kind: 'token-chart', label: '📊 Token 用量' },
    { kind: 'json-tree', label: 'JSON 树' },
  ];
  // Proxy-live captures only see structured API traffic, not the underlying
  // JSONL, so the "raw-log" view has nothing meaningful to show.
  if (!currentSession || currentSession.source !== 'proxy-live') {
    views.push({ kind: 'raw-log', label: '原始日志' });
  }

  const copyCmd = () => {
    if (!proxyStatus) return;
    // settings.json already rewritten to point at our proxy; user just runs `claude`.
    navigator.clipboard?.writeText('claude');
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid #333', flexWrap: 'wrap' }}>
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
      {proxyStatus ? (
        <>
          <span style={{ fontSize: 11, color: '#81c784' }}>● 捕获中 :{proxyStatus.port}</span>
          <button
            onClick={copyCmd}
            style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'rgba(155,140,255,0.2)', border: '1px solid #444', color: 'inherit', fontSize: 11 }}
            title="settings.json 已改写指向代理，在终端直接运行 claude 即可"
          >
            📋 复制 claude 命令
          </button>
          <button
            onClick={() => stopCapture()}
            style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'rgba(239,83,80,0.2)', border: '1px solid #444', color: 'inherit' }}
          >
            ⏹ 停止
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => startCapture()}
            style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'rgba(129,199,132,0.2)', border: '1px solid #444', color: 'inherit' }}
          >
            🔴 Claude 捕获
          </button>
          <button
            onClick={() => startCodexCapture()}
            style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: 'rgba(155,140,255,0.2)', border: '1px solid #444', color: 'inherit' }}
          >
            🔴 Codex 捕获
          </button>
        </>
      )}
      {currentSession && (
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>
          {currentSession.requests.length} 请求 · {currentSession.conversation.length} 条对话
        </span>
      )}
    </div>
  );
}

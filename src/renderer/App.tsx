// src/renderer/App.tsx
import { Component, ReactNode, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ViewSwitcher } from './components/ViewSwitcher';
import { JsonTreeView } from './views/JsonTreeView';
import { ChatFlowView } from './views/ChatFlowView';
import { RawLogView } from './views/RawLogView';
import { ConversationDirectory } from './components/ConversationDirectory';
import { useStore } from './store';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  componentDidCatch(err: Error) {
    this.setState({ error: err.message || String(err) });
  }
  render() {
    if (this.state.error) {
      return <div style={{ padding: 24, color: '#ff6b6b' }}>渲染出错：{this.state.error}</div>;
    }
    return this.props.children as ReactNode;
  }
}

/** Transient status banner. Reads `store.toast` and auto-clears after 2.5s
 *  so the next setToast wins cleanly. Replaces the old window.alert calls
 *  (which block the renderer thread in Electron). */
function Toast() {
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        padding: '8px 16px',
        background: 'rgba(40,40,40,0.95)',
        border: '1px solid #555',
        borderRadius: 4,
        fontSize: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
      }}
    >
      {toast}
    </div>
  );
}

export function App() {
  const currentView = useStore((s) => s.currentView);
  const currentSession = useStore((s) => s.currentSession);
  const directoryOpen = useStore((s) => s.directoryOpen);
  const setDirectoryOpen = useStore((s) => s.setDirectoryOpen);

  return (
    <>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <ViewSwitcher />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {!currentSession ? (
              <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>
            ) : (
              <ErrorBoundary key={currentView}>
                {currentView === 'json-tree' ? (
                  <JsonTreeView />
                ) : currentView === 'raw-log' ? (
                  <RawLogView />
                ) : (
                  <ChatFlowView />
                )}
              </ErrorBoundary>
            )}
          </div>
        </div>
        {directoryOpen && <ConversationDirectory />}
        <div
          onClick={() => setDirectoryOpen(!directoryOpen)}
          title={directoryOpen ? '收起对话目录' : '展开对话目录'}
          style={{
            width: 16,
            background: directoryOpen ? '#1a1a1a' : '#222',
            borderLeft: directoryOpen ? 'none' : '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#888',
            fontSize: 16,
            fontWeight: 600,
            userSelect: 'none',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = '#2a2a2a';
            (e.currentTarget as HTMLDivElement).style.color = '#ddd';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = directoryOpen ? '#1a1a1a' : '#222';
            (e.currentTarget as HTMLDivElement).style.color = '#888';
          }}
        >
          {directoryOpen ? '›' : '‹'}
        </div>
      </div>
      <Toast />
    </>
  );
}
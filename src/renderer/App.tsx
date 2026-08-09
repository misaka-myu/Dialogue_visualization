// src/renderer/App.tsx
import { Component, ReactNode, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ViewSwitcher } from './components/ViewSwitcher';
import { JsonTreeView } from './views/JsonTreeView';
import { ChatFlowView } from './views/ChatFlowView';
import { RawLogView } from './views/RawLogView';
import { ConversationDirectory } from './components/ConversationDirectory';
import { RequestMessageDirectory } from './components/RequestMessageDirectory';
import { useStore } from './store';

import { ApiInspectorView } from './components/ApiInspectorView';
import { TokenChartView } from './views/TokenChartView';

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
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        padding: '6px 16px',
        background: 'rgba(25, 25, 25, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 20,
        fontSize: 12,
        color: '#e0e0e0',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
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
                ) : currentView === 'api-inspector' ? (
                  <ApiInspectorView />
                ) : currentView === 'token-chart' ? (
                  <TokenChartView />
                ) : (
                  <ChatFlowView />
                )}
              </ErrorBoundary>
            )}
          </div>
        </div>
        {directoryOpen && currentView !== 'token-chart' && (currentView === 'api-inspector' ? <RequestMessageDirectory /> : <ConversationDirectory />)}
        {!directoryOpen && (
          <div
            onClick={() => setDirectoryOpen(true)}
            title="展开对话目录"
            style={{
              width: 16,
              background: '#222',
              borderLeft: '1px solid #333',
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
              (e.currentTarget as HTMLDivElement).style.background = '#222';
              (e.currentTarget as HTMLDivElement).style.color = '#888';
            }}
          >
            ‹
          </div>
        )}
        {directoryOpen && (
          <div
            onClick={() => setDirectoryOpen(false)}
            title="收起对话目录"
            style={{
              width: 16,
              background: '#1a1a1a',
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
              (e.currentTarget as HTMLDivElement).style.background = '#1a1a1a';
              (e.currentTarget as HTMLDivElement).style.color = '#888';
            }}
          >
            ›
          </div>
        )}
      </div>
      <Toast />
    </>
  );
}
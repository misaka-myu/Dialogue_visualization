// src/renderer/App.tsx
import { Component, ReactNode } from 'react';
import { Sidebar } from './components/Sidebar';
import { ViewSwitcher } from './components/ViewSwitcher';
import { JsonTreeView } from './views/JsonTreeView';
import { ChatFlowView } from './views/ChatFlowView';
import { useStore } from './store';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  componentDidCatch(err: Error) { this.setState({ error: err.message || String(err) }); }
  render() {
    if (this.state.error) {
      return <div style={{ padding: 24, color: '#ff6b6b' }}>渲染出错：{this.state.error}</div>;
    }
    return this.props.children;
  }
}

export function App() {
  const currentView = useStore((s) => s.currentView);
  const currentSession = useStore((s) => s.currentSession);

  return (
    <>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ViewSwitcher />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!currentSession ? (
            <div style={{ padding: 24, opacity: 0.5 }}>从左侧选择一个会话开始</div>
          ) : (
            <ErrorBoundary>
              {currentView === 'json-tree' ? <JsonTreeView /> : <ChatFlowView />}
            </ErrorBoundary>
          )}
        </div>
      </div>
    </>
  );
}

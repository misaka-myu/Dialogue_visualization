// src/renderer/App.tsx
import { Sidebar } from './components/Sidebar';
import { ViewSwitcher } from './components/ViewSwitcher';
import { JsonTreeView } from './views/JsonTreeView';
import { ChatFlowView } from './views/ChatFlowView';
import { useStore } from './store';

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
          ) : currentView === 'json-tree' ? (
            <JsonTreeView />
          ) : (
            <ChatFlowView />
          )}
        </div>
      </div>
    </>
  );
}

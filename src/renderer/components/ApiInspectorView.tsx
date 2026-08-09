// src/renderer/components/ApiInspectorView.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { ApiRequest, Message, ContentBlock } from '../../main/model/types';
import { CodeViewer } from './CodeViewer';
import { HoverCopyBar } from './HoverCopyBar';
import { ContentBlockView } from './ContentBlockView';
import { formatTokenCount } from '../utils/tokens';
import { findCurrentReq, findCurrentReqIndex } from '../utils/requestSelection';
import '../styles/api-inspector.css';

type TabType = 'overview' | 'system-tools' | 'sent-messages' | 'raw-json';

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ApiInspectorView() {
  const session = useStore((s) => s.currentSession);
  const selectedRequestId = useStore((s) => s.selectedRequestId);
  const setSelectedRequestId = useStore((s) => s.setSelectedRequestId);

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [copiedRaw, setCopiedRaw] = useState(false);
  // Index of the message card the directory wants us to scroll to.
  // Triggers a re-scroll when `activeTab` flips to 'sent-messages' (React
  // // state instead of setTimeout — survives StrictMode double-render and
  // // slow machines where 50ms wasn't enough).
  const [pendingJump, setPendingJump] = useState<number | null>(null);

  const requests = session?.requests ?? [];

  // Currently selected ApiRequest
  const currentReq = useMemo(
    () => findCurrentReq(requests, selectedRequestId),
    [requests, selectedRequestId],
  );

  const reqIndex = useMemo(
    () => findCurrentReqIndex(requests, selectedRequestId),
    [requests, selectedRequestId],
  );

  // Derive full input messages sent for this request
  const sentMessages: Message[] = useMemo(() => {
    if (!currentReq || !session) return [];
    if (currentReq.inputMessages && currentReq.inputMessages.length > 0) {
      return currentReq.inputMessages;
    }
    // Reconstruct from conversation slice
    const count = currentReq.messageCount || session.conversation.length;
    return session.conversation.slice(0, count);
  }, [currentReq, session]);

  useEffect(() => {
    const handleJump = (e: Event) => {
      const customEvent = e as CustomEvent<{ index: number }>;
      const idx = customEvent.detail?.index;
      if (typeof idx !== 'number') return;
      // Always set the pending jump + flip to sent-messages. The effect
      // below fires once the tab is actually active so the target DOM
      // element exists when we scrollIntoView.
      setPendingJump(idx);
      setActiveTab('sent-messages');
    };
    window.addEventListener('api-inspector-jump-msg', handleJump);
    return () => window.removeEventListener('api-inspector-jump-msg', handleJump);
  }, []);

  // Scroll the requested message card into view after the sent-messages
  // tab has rendered. We watch `activeTab` as well so a jump that lands
  // while the tab is already active still scrolls (pendingJump alone
  // wouldn't change and the effect wouldn't re-fire).
  useEffect(() => {
    if (activeTab !== 'sent-messages' || pendingJump === null) return;
    const el = document.getElementById(`api-msg-${pendingJump}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setPendingJump(null);
  }, [activeTab, pendingJump]);

  if (!session || !requests.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
        当前会话暂无抓包数据
      </div>
    );
  }

  const handleCopyRaw = () => {
    if (!currentReq) return;
    const rawData = {
      id: currentReq.id,
      timestamp: currentReq.timestamp,
      model: currentReq.model,
      params: currentReq.params,
      system: currentReq.system,
      toolsCount: currentReq.tools?.length ?? 0,
      tools: currentReq.tools,
      sentMessages,
      response: currentReq.response,
    };
    const jsonStr = JSON.stringify(rawData, null, 2);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(jsonStr).then(() => {
        setCopiedRaw(true);
        setTimeout(() => setCopiedRaw(false), 2000);
      });
    }
  };

  return (
    <div className="api-inspector-container">
      {/* Left Sidebar: Request Timeline List */}
      <div className="api-inspector-left">
        <div className="api-inspector-left-header">
          <span>📡 HTTP 请求轴 ({requests.length})</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{session.client}</span>
        </div>

        <div className="api-inspector-request-list">
          {requests.map((req, idx) => {
            const isSelected = reqIndex === idx;
            const usage = req.response?.usage;
            const inTok = usage?.inputTokens ?? 0;
            const outTok = usage?.outputTokens ?? 0;
            const cacheRead = usage?.cacheReadTokens ?? 0;
            const cacheHitPct = inTok > 0 && cacheRead > 0 ? Math.round((cacheRead / (inTok + cacheRead)) * 100) : 0;

            // Check tool calls
            const toolCount = req.response?.content?.filter((b) => b.type === 'tool_use').length ?? 0;

            return (
              <div
                key={req.id ? `${req.id}-${idx}` : idx}
                className={`api-inspector-request-item ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedRequestId(req.id || `req-idx-${idx}`)}
              >
                <div className="api-inspector-item-header">
                  <span style={{ color: isSelected ? '#64b5f6' : 'inherit' }}>Req #{idx + 1}</span>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>{formatTime(req.timestamp)}</span>
                </div>

                <div className="api-inspector-item-meta">
                  <span style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: 3, fontSize: 10, color: '#ffb74d' }}>
                    {req.model || 'unknown-model'}
                  </span>
                  <span>📥 {formatTokenCount(inTok)}</span>
                  <span>📤 {formatTokenCount(outTok)}</span>
                  {cacheHitPct > 0 && (
                    <span style={{ color: '#81c784', fontSize: 10 }}>⚡ {cacheHitPct}% cache</span>
                  )}
                  {toolCount > 0 && (
                    <span style={{ color: '#ffb74d', fontSize: 10 }}>🔧 {toolCount} tool</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Content Panel: Selected Request Inspector */}
      {currentReq && (
        <div className="api-inspector-right">
          {/* Sub-tabs header */}
          <div className="api-inspector-tabs">
            <button
              type="button"
              className={`api-inspector-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              📊 请求概览
            </button>
            <button
              type="button"
              className={`api-inspector-tab ${activeTab === 'system-tools' ? 'active' : ''}`}
              onClick={() => setActiveTab('system-tools')}
            >
              📜 System & Tools ({currentReq.system?.length ?? 0}/{currentReq.tools?.length ?? 0})
            </button>
            <button
              type="button"
              className={`api-inspector-tab ${activeTab === 'sent-messages' ? 'active' : ''}`}
              onClick={() => setActiveTab('sent-messages')}
            >
              💬 发送消息 ({sentMessages.length})
            </button>
            <button
              type="button"
              className={`api-inspector-tab ${activeTab === 'raw-json' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw-json')}
            >
              📄 原始 JSON Body
            </button>

            <button
              type="button"
              onClick={handleCopyRaw}
              style={{
                marginLeft: 'auto',
                alignSelf: 'center',
                marginRight: 12,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#e0e0e0',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {copiedRaw ? '✓ 已复制 JSON' : '📋 复制完整 Payload'}
            </button>
          </div>

          {/* Sub-tab 1: Overview */}
          {activeTab === 'overview' && (
            <div className="api-inspector-content">
              <div className="api-inspector-section">
                <div className="api-inspector-section-title">📌 请求元数据 (Request Metadata)</div>
                <div className="api-inspector-grid">
                  <div className="api-inspector-grid-item">
                    <span className="api-inspector-label">请求编号</span>
                    <span className="api-inspector-value">Request #{reqIndex + 1}</span>
                  </div>
                  <div className="api-inspector-grid-item">
                    <span className="api-inspector-label">模型 (Model)</span>
                    <span className="api-inspector-value" style={{ color: '#ffb74d' }}>{currentReq.model}</span>
                  </div>
                  <div className="api-inspector-grid-item">
                    <span className="api-inspector-label">请求时间</span>
                    <span className="api-inspector-value">{formatTime(currentReq.timestamp)}</span>
                  </div>
                  <div className="api-inspector-grid-item">
                    <span className="api-inspector-label">客户端来源</span>
                    <span className="api-inspector-value">{session.client} ({session.source})</span>
                  </div>
                </div>
              </div>

              <div className="api-inspector-section">
                <div className="api-inspector-section-title">⚙️ 模型参数 (Model Parameters)</div>
                <div className="api-inspector-grid">
                  <div className="api-inspector-grid-item">
                    <span className="api-inspector-label">Max Tokens</span>
                    <span className="api-inspector-value">{currentReq.params?.maxTokens ?? 'N/A'}</span>
                  </div>
                  {currentReq.params?.temperature !== undefined && (
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Temperature</span>
                      <span className="api-inspector-value">{currentReq.params.temperature}</span>
                    </div>
                  )}
                  {currentReq.params?.topP !== undefined && (
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Top P</span>
                      <span className="api-inspector-value">{currentReq.params.topP}</span>
                    </div>
                  )}
                  {currentReq.response?.stopReason && (
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Stop Reason</span>
                      <span className="api-inspector-value" style={{ color: '#81c784' }}>{currentReq.response.stopReason}</span>
                    </div>
                  )}
                </div>
              </div>

              {currentReq.response?.usage && (
                <div className="api-inspector-section">
                  <div className="api-inspector-section-title">📥 Token 消耗与缓存分析 (Token Usage & Caching)</div>
                  <div className="api-inspector-grid">
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Input Tokens (新计费)</span>
                      <span className="api-inspector-value" style={{ color: '#64b5f6' }}>
                        {formatTokenCount(currentReq.response.usage.inputTokens)}
                      </span>
                    </div>
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Output Tokens (生成)</span>
                      <span className="api-inspector-value" style={{ color: '#81c784' }}>
                        {formatTokenCount(currentReq.response.usage.outputTokens)}
                      </span>
                    </div>
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Cache Read Tokens (命中缓存)</span>
                      <span className="api-inspector-value" style={{ color: '#ba68c8' }}>
                        {formatTokenCount(currentReq.response.usage.cacheReadTokens)}
                      </span>
                    </div>
                    <div className="api-inspector-grid-item">
                      <span className="api-inspector-label">Cache Creation Tokens (写入缓存)</span>
                      <span className="api-inspector-value" style={{ color: '#ff8a65' }}>
                        {formatTokenCount(currentReq.response.usage.cacheCreationTokens)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-tab 2: System & Tools */}
          {activeTab === 'system-tools' && (
            <div className="api-inspector-content">
              {/* System Prompts */}
              <div className="api-inspector-section">
                <div className="api-inspector-section-title">📜 系统提示词 (System Prompts)</div>
                {(!currentReq.system || currentReq.system.length === 0) ? (
                  <span style={{ opacity: 0.5, fontSize: 12 }}>无 System Prompt</span>
                ) : (
                  currentReq.system.map((block, i) => (
                    <div key={i} style={{ marginBottom: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                      <span style={{ fontSize: 11, color: '#64b5f6', fontWeight: 600 }}>System Block #{i + 1}</span>
                      <div style={{ marginTop: 4 }}>
                        {block.type === 'text'
                          ? <ContentBlockView block={block} variant="default" />
                          : <CodeViewer value={JSON.stringify(block, null, 2)} language="json" />}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Tools Definition */}
              <div className="api-inspector-section">
                <div className="api-inspector-section-title">🛠️ 声明的工具定义列表 (Tools Schema - {currentReq.tools?.length ?? 0})</div>
                {(!currentReq.tools || currentReq.tools.length === 0) ? (
                  <span style={{ opacity: 0.5, fontSize: 12 }}>无 Tools 定义</span>
                ) : (
                  currentReq.tools.map((t, i) => (
                    <div key={i} style={{ marginBottom: 8, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ padding: '4px 8px', background: 'rgba(255,183,77,0.1)', fontSize: 12, fontWeight: 600, color: '#ffb74d' }}>
                        🔧 {t.name}
                      </div>
                      <div style={{ padding: 8, fontSize: 11, opacity: 0.8 }}>
                        <p style={{ margin: '0 0 6px', opacity: 0.7 }}>{t.description}</p>
                        <CodeViewer value={JSON.stringify(t.inputSchema, null, 2)} language="json" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Sub-tab 3: Sent Messages Payload */}
          {activeTab === 'sent-messages' && (
            <div className="api-inspector-content">
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                以下是本次 HTTP 请求实际打包发送给大模型的完整 <code style={{ color: '#64b5f6' }}>messages</code> 数组（共 {sentMessages.length} 条消息，未做任何去重与切分）：
              </div>

              {sentMessages.map((msg, i) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={i}
                    id={`api-msg-${i}`}
                    className="api-inspector-msg-card"
                    style={{
                      position: 'relative',
                      marginBottom: 12,
                      border: `1px solid ${isUser ? 'rgba(100, 181, 246, 0.25)' : 'rgba(129, 199, 132, 0.25)'}`,
                      borderRadius: 6,
                      background: isUser ? 'rgba(100, 181, 246, 0.04)' : 'rgba(129, 199, 132, 0.04)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 8px',
                        background: isUser ? 'rgba(100, 181, 246, 0.1)' : 'rgba(129, 199, 132, 0.1)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: isUser ? '#64b5f6' : '#81c784',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>{isUser ? '👤 USER' : '🤖 ASSISTANT'} (Message #{i + 1})</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ opacity: 0.5, fontSize: 10 }}>{msg.content.length} blocks</span>
                        <HoverCopyBar message={msg} />
                      </div>
                    </div>

                    <div style={{ padding: 8 }}>
                      {msg.content.map((b, bIdx) => (
                        <div key={bIdx} style={{ marginBottom: bIdx === msg.content.length - 1 ? 0 : 8 }}>
                          <ContentBlockView block={b} variant="compact" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sub-tab 4: Raw JSON */}
          {activeTab === 'raw-json' && (
            <div className="api-inspector-content" style={{ padding: 12 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64b5f6', marginBottom: 6 }}>📤 Request Payload JSON</div>
                <CodeViewer
                  value={JSON.stringify(
                    {
                      model: currentReq.model,
                      params: currentReq.params,
                      system: currentReq.system,
                      tools: currentReq.tools,
                      messages: sentMessages,
                    },
                    null,
                    2,
                  )}
                  language="json"
                />
              </div>

              {currentReq.response && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#81c784', marginBottom: 6 }}>📥 Response Payload JSON</div>
                  <CodeViewer value={JSON.stringify(currentReq.response, null, 2)} language="json" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

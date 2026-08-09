// src/renderer/components/RequestMessageDirectory.tsx
// Right-side message directory panel when in API Inspector mode.
// Allows quick jumping between messages sent in the selected HTTP request.

import React, { useMemo } from 'react';
import { useStore } from '../store';
import { Message } from '../../main/model/types';
import { useResizable } from '../hooks/useResizable';
import { formatTokenCount } from '../utils/tokens';
import { findCurrentReq } from '../utils/requestSelection';

function getMessagePreview(msg: Message): string {
  for (const block of msg.content) {
    if (block.type === 'text' && block.text.trim()) {
      // Strip XML tags for cleaner directory preview
      const clean = block.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean) return clean.slice(0, 70);
    }
    if (block.type === 'tool_use') {
      return `🔧 tool_use: ${block.name}`;
    }
    if (block.type === 'tool_result') {
      return `📥 tool_result (${block.toolUseId})`;
    }
    if (block.type === 'thinking') {
      return `💭 thinking: ${block.thinking.slice(0, 50)}`;
    }
  }
  return '(empty content)';
}

export function RequestMessageDirectory() {
  const session = useStore((s) => s.currentSession);
  const selectedRequestId = useStore((s) => s.selectedRequestId);
  const directoryWidth = useStore((s) => s.directoryWidth);
  const setDirectoryWidth = useStore((s) => s.setDirectoryWidth);
  const setDirectoryOpen = useStore((s) => s.setDirectoryOpen);

  const handleMouseDown = useResizable({
    side: 'right',
    minWidth: 160,
    maxWidth: 480,
    storageKey: 'dialogueviz.directory.width',
    getWidth: () => directoryWidth,
    onWidthChange: setDirectoryWidth,
  });

  const requests = session?.requests ?? [];
  const currentReq = useMemo(
    () => findCurrentReq(requests, selectedRequestId),
    [requests, selectedRequestId],
  );

  const sentMessages: Message[] = useMemo(() => {
    if (!currentReq || !session) return [];
    if (currentReq.inputMessages && currentReq.inputMessages.length > 0) {
      return currentReq.inputMessages;
    }
    const count = currentReq.messageCount || session.conversation.length;
    return session.conversation.slice(0, count);
  }, [currentReq, session]);

  const handleJumpToMessage = (index: number) => {
    // Fire event to switch tab to 'sent-messages' and scroll to api-msg-${index}
    const el = document.getElementById(`api-msg-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.dispatchEvent(new CustomEvent('api-inspector-jump-msg', { detail: { index } }));
    }
  };

  return (
    <div
      style={{
        width: directoryWidth,
        minWidth: 160,
        maxWidth: 480,
        background: '#181818',
        borderLeft: '1px solid #2a2a2a',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        userSelect: 'auto',
        fontSize: 12,
        color: '#e0e0e0',
      }}
    >
      {/* Resizer Handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          top: 0,
          left: -4,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
        }}
      />

      {/* Panel Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12, color: '#64b5f6' }}>
          💬 发送消息目录 ({sentMessages.length})
        </span>
        <button
          type="button"
          onClick={() => setDirectoryOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: 12,
          }}
          title="收起目录"
        >
          ✕
        </button>
      </div>

      {/* Messages List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {sentMessages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const preview = getMessagePreview(msg);

          return (
            <div
              key={idx}
              onClick={() => handleJumpToMessage(idx)}
              style={{
                padding: '6px 8px',
                marginBottom: 4,
                borderRadius: 4,
                background: isUser ? 'rgba(100, 181, 246, 0.06)' : 'rgba(129, 199, 132, 0.06)',
                border: `1px solid ${isUser ? 'rgba(100, 181, 246, 0.15)' : 'rgba(129, 199, 132, 0.15)'}`,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 11, color: isUser ? '#64b5f6' : '#81c784' }}>
                  #{idx + 1} {isUser ? '👤 USER' : '🤖 ASSISTANT'}
                </span>
                <span style={{ fontSize: 10, opacity: 0.5 }}>
                  {msg.content.length} blocks
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  opacity: 0.8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {preview}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

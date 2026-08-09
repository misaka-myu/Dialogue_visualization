// src/renderer/components/HoverCopyBar.tsx
import React, { useState } from 'react';
import { Message } from '../../main/model/types';
import { copyToClipboard, toCopyJSON } from '../utils/messageCopy';
import { extractMessageTextForDisplay } from '../utils/messageContent';

interface HoverCopyBarProps {
  message: Message;
  className?: string;
}

export function HoverCopyBar({ message, className }: HoverCopyBarProps) {
  const [copiedText, setCopiedText] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const handleCopyText = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = extractMessageTextForDisplay(message.content);
    copyToClipboard(text, '文本').then((ok) => {
      if (ok) {
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 1500);
      }
    });
  };

  const handleCopyJson = (e: React.MouseEvent) => {
    e.stopPropagation();
    const json = toCopyJSON(message);
    copyToClipboard(json, 'JSON').then((ok) => {
      if (ok) {
        setCopiedJson(true);
        setTimeout(() => setCopiedJson(false), 1500);
      }
    });
  };

  return (
    <div
      className={`hover-copy-bar ${className ?? ''}`}
      style={{
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'rgba(25, 25, 25, 0.9)',
        backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 4,
        padding: '2px 4px',
        fontSize: 10,
        zIndex: 5,
      }}
    >
      <button
        type="button"
        onClick={handleCopyText}
        style={{
          background: 'transparent',
          border: 'none',
          color: copiedText ? '#81c784' : '#e0e0e0',
          cursor: 'pointer',
          padding: '1px 4px',
          fontSize: 10,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
        title="复制消息文本"
      >
        {copiedText ? '✓ 文本已复制' : '📋 文本'}
      </button>
      <span style={{ opacity: 0.3, fontSize: 10 }}>|</span>
      <button
        type="button"
        onClick={handleCopyJson}
        style={{
          background: 'transparent',
          border: 'none',
          color: copiedJson ? '#81c784' : '#e0e0e0',
          cursor: 'pointer',
          padding: '1px 4px',
          fontSize: 10,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
        title="复制消息 JSON Payload"
      >
        {copiedJson ? '✓ JSON已复制' : '📄 JSON'}
      </button>
    </div>
  );
}

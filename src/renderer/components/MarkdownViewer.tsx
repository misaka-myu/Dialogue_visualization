// src/renderer/components/MarkdownViewer.tsx
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeViewer } from './CodeViewer';
import '../styles/markdown.css';

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {/* ignore */});
  };

  return (
    <div style={{ margin: '8px 0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        padding: '3px 8px', background: 'rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 10, color: 'rgba(255,255,255,0.6)', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span>{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            color: 'inherit', borderRadius: 3, cursor: 'pointer', fontSize: 10, padding: '1px 5px',
          }}
        >
          {copied ? '✓ 已复制' : '复制'}
        </button>
      </div>
      {/* CodeViewer CodeMirror container */}
      <CodeViewer value={value} language={language} />
    </div>
  );
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  return (
    <div className={`markdown-body ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children).replace(/\n$/, '');
            if (!inline && match) {
              return <CodeBlock language={match[1]} value={value} />;
            }
            if (!inline && value.includes('\n')) {
              return <CodeBlock language="" value={value} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          a({ node, children, href, ...props }: any) {
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

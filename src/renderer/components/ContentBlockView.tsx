// src/renderer/components/ContentBlockView.tsx
// Shared rendering of a ContentBlock (text/thinking/tool_use/tool_result/image).
// Both ChatFlowView and ApiInspectorView need to render these blocks, but
// with different visual priorities:
//
//   - ChatFlowView: readability-first. Thinking blocks are collapsible,
//     tool_results get CodeViewer highlighting with the tool's file_path
//     language, tool_use input is shown via <pre> for soft wrap.
//
//   - ApiInspectorView: compactness-first. Everything is shown inline as a
//     small box; tool_result JSON.stringify's its content rather than
//     running it through CodeViewer.
//
// We expose two variants via the `variant` prop. The text/thinking paths
// are mostly identical (UserTextSegments / MarkdownViewer) and can share
// code; tool_use/tool_result differ enough that each variant owns its
// own box style.

import { ContentBlock } from '../../main/model/types';
import { CodeViewer } from './CodeViewer';
import { MarkdownViewer } from './MarkdownViewer';
import { UserTextSegments } from './CommandBlocks';
import { hasLocalCommandTags, parseUserTextSegments } from '../utils/commandParser';
import { useState } from 'react';

export type ContentBlockVariant = 'default' | 'compact';

interface Props {
  block: ContentBlock;
  /** Language hint for tool_result. ChatFlowView derives it from the
   *  paired tool_use's file_path; Inspector passes undefined. */
  lang?: string;
  variant: ContentBlockVariant;
}

export function ContentBlockView({ block, lang, variant }: Props) {
  switch (block.type) {
    case 'text': {
      if (hasLocalCommandTags(block.text)) {
        return <UserTextSegments segments={parseUserTextSegments(block.text)} />;
      }
      return <MarkdownViewer content={block.text} />;
    }
    case 'thinking':
      return variant === 'compact' ? (
        <ThinkingBlockCompact text={block.thinking} />
      ) : (
        <ThinkingBlockDefault text={block.thinking} signature={block.signature} />
      );
    case 'tool_use':
      return variant === 'compact' ? (
        <ToolUseCompact name={block.name} input={block.input} />
      ) : (
        <ToolUseDefault name={block.name} input={block.input} />
      );
    case 'tool_result': {
      const raw = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content, null, 2);
      return variant === 'compact' ? (
        <ToolResultCompact toolUseId={block.toolUseId} content={raw} />
      ) : (
        <ToolResultDefault content={raw} lang={lang} />
      );
    }
    default:
      return null;
  }
}

// ── Default variant (ChatFlowView) ────────────────────────────────────────────

function ToolUseDefault({ name, input }: { name: string; input: unknown }) {
  return (
    <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(255,183,77,0.15)', borderRadius: 4, fontSize: 12 }}>
      <span>🔧 <strong>tool_use: {name}</strong></span>
      <pre style={{ margin: '4px 0 0', opacity: 0.7, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  );
}

function ToolResultDefault({ content, lang }: { content: string; lang?: string }) {
  return (
    <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(129,199,132,0.1)', borderLeft: '3px solid #81c784', borderRadius: '0 4px 4px 0', fontSize: 12 }}>
      <span style={{ color: '#81c784', fontWeight: 600 }}>📥 tool_result</span>
      <div style={{ marginTop: 4 }}>
        <CodeViewer value={content} language={lang} />
      </div>
    </div>
  );
}

function ThinkingBlockDefault({ text, signature }: { text: string; signature?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const charLen = text.length;
  const tokEstimate = Math.ceil(charLen / 4);
  return (
    <div style={{ marginTop: 4, background: 'rgba(206,147,216,0.08)', border: '1px solid rgba(206,147,216,0.2)', borderRadius: 4, fontSize: 12 }}>
      <div
        role="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', userSelect: 'none', background: 'rgba(206,147,216,0.06)',
          color: '#ce93d8', fontWeight: 600, fontSize: 11,
        }}
      >
        <span>💭 思考过程</span>
        <span style={{ opacity: 0.6, fontSize: 10 }}>· {charLen} 字 (≈{tokEstimate} tok)</span>
        {signature && (
          <span style={{ fontSize: 9, opacity: 0.6, background: 'rgba(256,256,256,0.1)', padding: '1px 4px', borderRadius: 3 }}>
            🔒 已校验签名
          </span>
        )}
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{collapsed ? '▶ 展开' : '▼ 收起'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '6px 10px', opacity: 0.9, lineHeight: 1.45, borderTop: '1px dashed rgba(206,147,216,0.15)' }}>
          {text ? <MarkdownViewer content={text} /> : <span style={{ opacity: 0.4 }}>(未捕获到具体思考文本)</span>}
        </div>
      )}
    </div>
  );
}

// ── Compact variant (ApiInspectorView) ────────────────────────────────────────

function ToolUseCompact({ name, input }: { name: string; input: unknown }) {
  return (
    <div style={{ padding: 6, background: 'rgba(255,183,77,0.1)', borderRadius: 4, fontSize: 11, color: '#ffb74d' }}>
      🔧 Tool Call: {name}
      <pre style={{ margin: '4px 0 0', opacity: 0.8, fontSize: 10 }}>{JSON.stringify(input, null, 2)}</pre>
    </div>
  );
}

function ToolResultCompact({ toolUseId, content }: { toolUseId: string; content: string }) {
  return (
    <div style={{ padding: 6, background: 'rgba(129,199,132,0.1)', borderRadius: 4, fontSize: 11, color: '#81c784' }}>
      📥 Tool Result ({toolUseId}):
      <pre style={{ margin: '4px 0 0', opacity: 0.8, fontSize: 10 }}>{content}</pre>
    </div>
  );
}

function ThinkingBlockCompact({ text }: { text: string }) {
  return (
    <div style={{ padding: 6, background: 'rgba(206,147,216,0.08)', borderRadius: 4, fontSize: 11, color: '#ce93d8' }}>
      💭 思考: {text}
    </div>
  );
}
// src/renderer/components/CommandBlocks.tsx
// Shared rendering for the XML-tagged segments that Claude Code CLI
// injects into user text: <command-name>, <local-command-stdout>,
// <system-reminder>, etc. Both ChatFlowView (inline per-block) and
// ApiInspectorView (per-message card) need to render these segments
// identically; this file is the single source of truth.

import { useState } from 'react';
import { MarkdownViewer } from './MarkdownViewer';
import type { LocalCommandSegment, SystemReminderSegment, UserTextSegment } from '../utils/commandParser';
import type { ParsedUserSegment } from '../utils/commandParser';

export function LocalCommandBlock({ segment }: { segment: LocalCommandSegment }) {
  const [open, setOpen] = useState(true);
  const hasOutput = Boolean(segment.stdout || segment.stderr);

  return (
    <div style={{
      margin: '6px 0',
      background: 'rgba(100, 181, 246, 0.08)',
      border: '1px solid rgba(100, 181, 246, 0.25)',
      borderRadius: 4,
      fontSize: 12,
      overflow: 'hidden',
    }}>
      <div
        role={hasOutput ? 'button' : undefined}
        aria-expanded={hasOutput ? open : undefined}
        onClick={() => hasOutput && setOpen(!open)}
        style={{
          padding: '4px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(100, 181, 246, 0.1)',
          color: '#64b5f6',
          fontWeight: 600,
          fontSize: 11,
          cursor: hasOutput ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <span>⚡ 本地命令</span>
        <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 3, color: '#e0e0e0', fontFamily: 'monospace' }}>
          {segment.name}
        </code>
        {segment.message && <span style={{ opacity: 0.6, fontSize: 10 }}>({segment.message})</span>}
        {segment.args && <span style={{ opacity: 0.6, fontSize: 10 }}>{segment.args}</span>}
        {hasOutput && (
          <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 10 }}>
            {open ? '▼ 收起输出' : '▶ 展开输出'}
          </span>
        )}
      </div>

      {open && (segment.stdout || segment.stderr) && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid rgba(100, 181, 246, 0.15)', background: 'rgba(0, 0, 0, 0.2)' }}>
          {segment.stdout && (
            <pre style={{ margin: 0, fontSize: 11, opacity: 0.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
              {segment.stdout}
            </pre>
          )}
          {segment.stderr && (
            <pre style={{ margin: '4px 0 0', fontSize: 11, color: '#e57373', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
              {segment.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function SystemReminderBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      margin: '6px 0',
      background: 'rgba(255, 171, 145, 0.08)',
      border: '1px solid rgba(255, 171, 145, 0.25)',
      borderRadius: 4,
      fontSize: 12,
      overflow: 'hidden',
    }}>
      <div
        role="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          padding: '4px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255, 171, 145, 0.1)',
          color: '#ffab91',
          fontWeight: 600,
          fontSize: 11,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span>📌 系统提醒 (System Reminder)</span>
        <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 10 }}>
          {open ? '▼ 收起内容' : '▶ 展开内容'}
        </span>
      </div>
      {open && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid rgba(255, 171, 145, 0.15)', background: 'rgba(0, 0, 0, 0.2)' }}>
          <MarkdownViewer content={text} />
        </div>
      )}
    </div>
  );
}

/** Render a sequence of parsed user-text segments, dispatching each to
 *  the matching block component. Pure presentation — callers must have
 *  already run `parseUserTextSegments` on the raw text. */
export function UserTextSegments({ segments }: { segments: ParsedUserSegment[] }) {
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === 'local_command') return <LocalCommandBlock key={idx} segment={seg} />;
        if (seg.type === 'system_reminder') return <SystemReminderBlock key={idx} text={seg.text} />;
        return <MarkdownViewer key={idx} content={seg.text} />;
      })}
    </>
  );
}

export type { LocalCommandSegment, SystemReminderSegment, UserTextSegment };

// src/renderer/components/ConversationDirectory.tsx
// Right-side table-of-contents panel.
// Organises conversation into rounds – one round per user message.
// Each round is collapsible and shows the thinking blocks, tool calls,
// tool results and assistant responses that occurred in that round.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { getMessageTokenInfo, formatTokenCount } from '../utils/tokens';
import { copyMessageText, copyMessageJson } from '../utils/messageCopy';
import { getVirtuosoRef } from '../hooks/virtuosoRef';
import { useResizable } from '../hooks/useResizable';
import type { Message } from '../../main/model/types';

// ─── Data model ───────────────────────────────────────────────────────────────

interface RoundStep {
  /** Index in session.conversation – used for scrollToIndex */
  messageIndex: number;
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'response';
  /** For tool_call / tool_result */
  toolName?: string;
  /** Short preview text (command, path, response excerpt, …) */
  preview: string;
  /** Content length in characters – shown as "≈Nk" */
  charCount?: number;
}

interface Round {
  roundNumber: number;
  userIndex: number;
  userMessage: Message;
  steps: RoundStep[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the most meaningful short string from a tool's input object. */
function toolInputPreview(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const inp = input as Record<string, unknown>;
  if (typeof inp.command === 'string') return inp.command.replace(/\s+/g, ' ').slice(0, 90);
  if (typeof inp.file_path === 'string') return inp.file_path.slice(0, 90);
  if (typeof inp.path === 'string') return inp.path.slice(0, 90);
  if (typeof inp.query === 'string') return inp.query.slice(0, 90);
  if (typeof inp.pattern === 'string') return inp.pattern.slice(0, 90);
  if (typeof inp.content === 'string') return inp.content.slice(0, 60);
  return JSON.stringify(input).slice(0, 60);
}

/** Build Round[] from the flat conversation array. */
function buildRounds(messages: Message[]): Round[] {
  // Pre-build toolUseId → toolName map so result rows can show the tool name.
  const toolNameMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolNameMap.set(block.id, block.name);
        }
      }
    }
  }

  const rounds: Round[] = [];
  let roundNum = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    roundNum++;
    const steps: RoundStep[] = [];

    // Collect everything until the next user message.
    let j = i + 1;
    while (j < messages.length && messages[j].role !== 'user') {
      const stepMsg = messages[j];

      if (stepMsg.role === 'assistant') {
        for (const block of stepMsg.content) {
          if (block.type === 'thinking' && block.thinking?.trim()) {
            steps.push({
              messageIndex: j,
              kind: 'thinking',
              preview: '',
              charCount: block.thinking.length,
            });
          } else if (block.type === 'tool_use') {
            steps.push({
              messageIndex: j,
              kind: 'tool_call',
              toolName: block.name,
              preview: toolInputPreview(block.input),
            });
          } else if (block.type === 'text' && block.text?.trim()) {
            steps.push({
              messageIndex: j,
              kind: 'response',
              preview: block.text.trim().slice(0, 80),
              charCount: block.text.length,
            });
          }
        }
      } else if (stepMsg.role === 'tool') {
        for (const block of stepMsg.content) {
          if (block.type === 'tool_result') {
            const raw =
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content ?? '');
            const tn = toolNameMap.get(block.toolUseId) ?? 'tool';
            steps.push({
              messageIndex: j,
              kind: 'tool_result',
              toolName: tn,
              preview: raw.trim().slice(0, 60),
              charCount: raw.length,
            });
          }
        }
      }

      j++;
    }

    rounds.push({
      roundNumber: roundNum,
      userIndex: i,
      userMessage: msg,
      steps,
    });
  }

  return rounds;
}

/** Extract a short readable preview from a user message. */
function userPreview(message: Message): string {
  for (const block of message.content) {
    if (block.type === 'text') {
      const t = block.text.trim();
      if (t) return t.slice(0, 100);
    }
  }
  return '';
}

/** Format a character count as "Nk" or "N". */
function fmtChars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── Three-dots copy menu (same as original) ─────────────────────────────────

function RowMenu({ onCopyText, onCopyJson }: { onCopyText: () => void; onCopyJson: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginLeft: 4 }}>
      <button
        type="button"
        aria-label="操作菜单"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="directory-row-trigger"
        style={{
          background: 'transparent', border: '1px solid #444', color: 'inherit',
          cursor: 'pointer', padding: '0 6px', fontSize: 12, lineHeight: '18px', borderRadius: 3,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, zIndex: 100,
            minWidth: 120, background: '#2a2a2a', border: '1px solid #444',
            borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.5)', padding: 4, marginTop: 2,
          }}
        >
          {[
            { label: '复制文本', action: onCopyText },
            { label: '复制为 JSON', action: onCopyJson },
          ].map(({ label, action }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setOpen(false); action(); }}
              style={menuItemStyle}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', color: 'inherit',
  padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
};

// ─── Step row ─────────────────────────────────────────────────────────────────

const STEP_CONFIG = {
  thinking:    { icon: '💭', label: '思考',   color: '#ce93d8', bg: 'rgba(206,147,216,0.08)' },
  tool_call:   { icon: '🔧', label: '',        color: '#ffb74d', bg: 'rgba(255,183,77,0.08)'  },
  tool_result: { icon: '📥', label: '',        color: '#81c784', bg: 'rgba(129,199,132,0.06)' },
  response:    { icon: '🤖', label: '',        color: '#64b5f6', bg: 'rgba(100,181,246,0.06)' },
} as const;

function StepRow({
  step,
  isLast,
  isActive,
  onScrollTo,
}: {
  step: RoundStep;
  isLast: boolean;
  isActive: boolean;
  onScrollTo: (idx: number) => void;
}) {
  const cfg = STEP_CONFIG[step.kind];
  const label = step.toolName ?? cfg.label;
  const charLabel = step.charCount !== undefined ? `≈${fmtChars(step.charCount)}` : '';

  return (
    <div
      onClick={() => onScrollTo(step.messageIndex)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onScrollTo(step.messageIndex); }
      }}
      className="directory-row"
      data-active={isActive ? 'true' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 8px 2px 20px',
        cursor: 'pointer',
        background: isActive ? 'rgba(100,181,246,0.18)' : cfg.bg,
        borderLeft: isActive ? '2px solid #64b5f6' : '2px solid transparent',
        fontSize: 10,
        color: isActive ? '#e8e8e8' : 'rgba(210,210,210,0.72)',
        minHeight: 22,
      }}
    >
      {/* Tree branch connector */}
      <span style={{ color: 'rgba(255,255,255,0.15)', flexShrink: 0, fontSize: 11 }}>
        {isLast ? '└' : '├'}
      </span>
      {/* Icon */}
      <span style={{ flexShrink: 0 }}>{cfg.icon}</span>
      {/* Label (tool name / role label) */}
      {label && (
        <span style={{ color: cfg.color, fontWeight: 600, flexShrink: 0 }}>{label}</span>
      )}
      {/* Preview */}
      {step.preview && (
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7,
        }}>
          · {step.preview}
        </span>
      )}
      {/* Char count */}
      {charLabel && (
        <span style={{ flexShrink: 0, opacity: 0.38, marginLeft: 'auto', paddingLeft: 4 }}>
          {charLabel}
        </span>
      )}
    </div>
  );
}

// ─── Round entry (header + optional steps) ────────────────────────────────────

function RoundEntry({
  round,
  expanded,
  onToggle,
  activeIndex,
  onScrollTo,
}: {
  round: Round;
  expanded: boolean;
  onToggle: () => void;
  activeIndex: number | null;
  onScrollTo: (idx: number) => void;
}) {
  const { roundNumber, userIndex, userMessage, steps } = round;
  const preview = useMemo(() => userPreview(userMessage), [userMessage]);
  const tok = getMessageTokenInfo(userMessage);
  const isActive = activeIndex === userIndex;
  const isSidechain = userMessage.meta?.isSidechain;
  const hasSteps = steps.length > 0;

  const copyText = useCallback(() => { void copyMessageText(userMessage); }, [userMessage]);
  const copyJson = useCallback(() => { void copyMessageJson(userMessage); }, [userMessage]);

  return (
    <div>
      {/* ── Round header ── */}
      <div
        className="directory-row"
        data-active={isActive ? 'true' : undefined}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 4,
          padding: '5px 8px 5px 4px',
          background: isActive ? '#2c4a6e' : 'transparent',
          borderLeft: isActive
            ? '3px solid #64b5f6'
            : isSidechain
            ? '3px solid #ff8a65'
            : '3px solid transparent',
        }}
      >
        {/* Expand / collapse toggle */}
        <button
          type="button"
          aria-label={expanded ? '折叠' : '展开'}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          style={{
            flexShrink: 0, width: 16, height: 16,
            background: 'transparent', border: 'none',
            color: hasSteps ? 'rgba(255,255,255,0.45)' : 'transparent',
            cursor: hasSteps ? 'pointer' : 'default',
            fontSize: 9, paddingTop: 4,
          }}
        >
          {hasSteps ? (expanded ? '▼' : '▶') : ''}
        </button>

        {/* Number badge */}
        <span
          style={{
            flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
            background: isActive ? '#64b5f6' : 'rgba(155,140,255,0.18)',
            color: isActive ? '#000' : '#9b8cff',
            fontSize: 10, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: 2, cursor: 'pointer',
          }}
          onClick={() => onScrollTo(userIndex)}
        >
          {roundNumber}
        </span>

        {/* Content area (clickable → scroll) */}
        <div
          onClick={() => onScrollTo(userIndex)}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
        >
          <div
            style={{
              fontSize: 11, lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
              wordBreak: 'break-word', opacity: 0.9,
            }}
            title={preview}
          >
            {preview || <span style={{ opacity: 0.5 }}>USER</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, opacity: 0.55, marginTop: 1 }}>
            <span>👤 USER</span>
            {hasSteps && (
              <span style={{ opacity: 0.6 }}>· {steps.length} 步</span>
            )}
            <span style={{ marginLeft: 'auto' }} title={`${tok.count} tokens`}>
              {tok.real ? '✓' : '≈'} {formatTokenCount(tok.count)}
            </span>
            <RowMenu onCopyText={copyText} onCopyJson={copyJson} />
          </div>
        </div>
      </div>

      {/* ── Steps (only when expanded) ── */}
      {expanded && steps.map((step, i) => (
        <StepRow
          key={`${step.messageIndex}-${step.kind}-${i}`}
          step={step}
          isLast={i === steps.length - 1}
          isActive={activeIndex === step.messageIndex}
          onScrollTo={onScrollTo}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConversationDirectory() {
  const session = useStore((s) => s.currentSession);
  const activeIndex = useStore((s) => s.activeDirectoryIndex);
  const directoryWidth = useStore((s) => s.directoryWidth);
  const setDirectoryWidth = useStore((s) => s.setDirectoryWidth);
  const [isHandleHover, setIsHandleHover] = useState(false);
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(() => new Set());
  const messages = session?.conversation ?? [];

  const startDirectoryResize = useResizable({
    side: 'right',
    minWidth: 160,
    maxWidth: 480,
    storageKey: 'dialogueviz.directory.width',
    getWidth: () => useStore.getState().directoryWidth,
    onWidthChange: setDirectoryWidth,
  });

  // Collapse all rounds and clear highlight when session changes.
  const sessionId = session?.id;
  useEffect(() => {
    setExpandedRounds(new Set());
    useStore.getState().setActiveDirectoryIndex(null);
  }, [sessionId]);

  const rounds = useMemo(() => buildRounds(messages), [messages]);

  const handleScrollTo = useCallback((index: number) => {
    // Keep highlight persistent until the user clicks a different item.
    useStore.getState().setActiveDirectoryIndex(index);
    const v = getVirtuosoRef();
    // Use 'auto' (instant jump): 'smooth' relies on estimated heights for
    // off-screen items and can overshoot then correct, causing a visible
    // reverse-scroll glitch with variable-height content.
    v?.scrollToIndex({ index, align: 'start', behavior: 'auto' });
  }, []);

  const handleToggle = useCallback((roundNumber: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(roundNumber)) next.delete(roundNumber);
      else next.add(roundNumber);
      return next;
    });
  }, []);

  const allExpanded = expandedRounds.size === rounds.length;
  const toggleAll = useCallback(() => {
    setExpandedRounds(allExpanded ? new Set() : new Set(rounds.map((r) => r.roundNumber)));
  }, [allExpanded, rounds]);

  return (
    <div style={{ display: 'flex', flexShrink: 0, width: directoryWidth + 4 }}>
      {/* Resize handle */}
      <div
        onMouseDown={startDirectoryResize}
        onMouseEnter={() => setIsHandleHover(true)}
        onMouseLeave={() => setIsHandleHover(false)}
        title="拖动调整目录宽度"
        style={{
          width: 4, cursor: 'col-resize',
          background: isHandleHover ? '#666' : 'transparent',
          transition: 'background 0.15s', flexShrink: 0,
        }}
      />

      {/* Directory panel */}
      <div style={{
        width: directoryWidth, background: '#1e1e1e',
        borderLeft: '1px solid #333',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid #333',
          fontSize: 11, opacity: 0.7,
          display: 'flex', alignItems: 'center', gap: 6,
          flexShrink: 0,
        }}>
          <span>对话目录</span>
          <span style={{ opacity: 0.5 }}>· {rounds.length} 轮</span>
          {rounds.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              title={allExpanded ? '全部折叠' : '全部展开'}
              style={{
                marginLeft: 'auto', background: 'transparent',
                border: '1px solid #444', color: 'inherit',
                cursor: 'pointer', fontSize: 10, padding: '1px 6px',
                borderRadius: 3, lineHeight: '16px',
              }}
            >
              {allExpanded ? '全折叠' : '全展开'}
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {rounds.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, opacity: 0.5 }}>
              {session ? '无用户消息' : '从左侧选择一个会话'}
            </div>
          ) : (
            rounds.map((round) => (
              <RoundEntry
                key={round.userIndex}
                round={round}
                expanded={expandedRounds.has(round.roundNumber)}
                onToggle={() => handleToggle(round.roundNumber)}
                activeIndex={activeIndex}
                onScrollTo={handleScrollTo}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
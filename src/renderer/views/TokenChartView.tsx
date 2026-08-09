// src/renderer/views/TokenChartView.tsx
//
// Stacked-bar token usage over rounds. Pure SVG (no chart library) so
// the bundle stays small and the styling matches the rest of the app.
// Each bar is one round, segments stack: cache_creation (bottom),
// input, output, cache_read (top). Hover for a tooltip with exact
// numbers; a thin marker below the bar shows whether the data is real
// (API-reported) or estimated (chars/4 fallback).

import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { buildRoundTokenSeries, RoundTokenData } from '../utils/roundToken';
import { formatTokenCount } from '../utils/tokens';

const CHART_WIDTH = 880;
const CHART_HEIGHT = 280;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 48;
const BAR_GAP = 6;
const COLORS = {
  cache_creation: '#ba68c8',
  input: '#64b5f6',
  output: '#81c784',
  cache_read: '#ffb74d',
  label: 'rgba(255,255,255,0.55)',
  axis: 'rgba(255,255,255,0.25)',
  estimate: 'rgba(255,255,255,0.25)',
};

export function TokenChartView() {
  const session = useStore((s) => s.currentSession);
  const series = useMemo(() => (session ? buildRoundTokenSeries(session) : []), [session]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!session) {
    return (
      <div style={{ padding: 24, opacity: 0.5 }}>
        从左侧选择一个会话查看 token 用量趋势。
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div style={{ padding: 24, opacity: 0.5 }}>
        当前会话没有用户消息，无法绘制 round 趋势。
      </div>
    );
  }

  // Pick a "nice" max value that includes a little headroom.
  const maxStack = Math.max(
    1,
    ...series.map((r) => r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens),
  );
  const niceMax = niceCeil(maxStack * 1.1);

  const innerW = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const innerH = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const barW = Math.max(4, (innerW - BAR_GAP * (series.length - 1)) / series.length);

  return (
    <div style={{ padding: '12px 16px', overflow: 'auto' }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>📊 Token 用量趋势（按 round）</span>
        <Legend />
        <span style={{ marginLeft: 'auto', opacity: 0.55 }}>
          {series.length} rounds · max {formatTokenCount(niceMax)} tok
        </span>
      </div>
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 4, display: 'block', maxWidth: '100%' }}
      >
        {/* Y axis grid lines + labels */}
        {yTicks(niceMax).map((tick) => {
          const y = PADDING_TOP + innerH - (tick / niceMax) * innerH;
          return (
            <g key={tick}>
              <line x1={PADDING_LEFT} x2={CHART_WIDTH - PADDING_RIGHT} y1={y} y2={y} stroke={COLORS.axis} strokeDasharray="2 3" />
              <text x={PADDING_LEFT - 6} y={y + 3} fontSize={10} fill={COLORS.label} textAnchor="end">
                {formatTokenCount(tick)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {series.map((r, i) => {
          const x = PADDING_LEFT + i * (barW + BAR_GAP);
          const total = r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens;
          const h = (total / niceMax) * innerH;
          let yCursor = PADDING_TOP + innerH;
          const segs: Array<[string, number, number]> = [
            ['cache_creation', r.cacheCreationTokens, yCursor],
            ['input', r.inputTokens, yCursor],
            ['output', r.outputTokens, yCursor],
            ['cache_read', r.cacheReadTokens, yCursor],
          ];
          // Walk bottom-up.
          const rendered: React.ReactNode[] = [];
          for (const [key, value] of [
            ['cache_creation', r.cacheCreationTokens],
            ['input', r.inputTokens],
            ['output', r.outputTokens],
            ['cache_read', r.cacheReadTokens],
          ] as const) {
            if (value <= 0) continue;
            const segH = (value / niceMax) * innerH;
            yCursor -= segH;
            rendered.push(
              <rect
                key={key}
                x={x}
                y={yCursor}
                width={barW}
                height={segH}
                fill={COLORS[key]}
                opacity={hoverIdx === i ? 1 : 0.92}
              />,
            );
          }
          return (
            <g key={r.roundNumber} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
              {rendered}
              {/* X-axis label: round number */}
              <text
                x={x + barW / 2}
                y={CHART_HEIGHT - PADDING_BOTTOM + 14}
                fontSize={10}
                fill={COLORS.label}
                textAnchor="middle"
              >
                R{r.roundNumber}
              </text>
              {/* Source marker (real vs estimated) — short bar below the label */}
              <line
                x1={x + barW / 2 - 6}
                x2={x + barW / 2 + 6}
                y1={CHART_HEIGHT - PADDING_BOTTOM + 24}
                y2={CHART_HEIGHT - PADDING_BOTTOM + 24}
                stroke={r.source === 'real' ? COLORS.output : COLORS.estimate}
                strokeWidth={2}
              />
              {r.model && (
                <text
                  x={x + barW / 2}
                  y={CHART_HEIGHT - PADDING_BOTTOM + 36}
                  fontSize={9}
                  fill={COLORS.label}
                  textAnchor="middle"
                  opacity={0.6}
                >
                  {r.model}
                </text>
              )}
            </g>
          );
        })}
        {/* Tooltip */}
        {hoverIdx !== null && series[hoverIdx] && (
          <Tooltip data={series[hoverIdx]} x={PADDING_LEFT + hoverIdx * (barW + BAR_GAP) + barW / 2} />
        )}
      </svg>
    </div>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ['cache_creation', COLORS.cache_creation],
    ['input', COLORS.input],
    ['output', COLORS.output],
    ['cache_read', COLORS.cache_read],
  ];
  return (
    <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {items.map(([label, color]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
          <span style={{ opacity: 0.7 }}>{label}</span>
        </span>
      ))}
    </span>
  );
}

function Tooltip({ data, x }: { data: RoundTokenData; x: number }) {
  const total = data.inputTokens + data.outputTokens + data.cacheReadTokens + data.cacheCreationTokens;
  const lines: Array<['cache_creation' | 'input' | 'output' | 'cache_read', number]> = [
    ['cache_creation', data.cacheCreationTokens],
    ['input', data.inputTokens],
    ['output', data.outputTokens],
    ['cache_read', data.cacheReadTokens],
  ];
  // Clamp x so the box doesn't run off the right edge.
  const boxW = 180;
  const boxX = Math.min(Math.max(boxW / 2, x), 880 - boxW / 2) - boxW / 2;
  return (
    <g>
      <rect x={boxX} y={PADDING_TOP} width={boxW} height={92} rx={4} fill="rgba(30,30,30,0.96)" stroke="rgba(255,255,255,0.15)" />
      <text x={boxX + 8} y={PADDING_TOP + 16} fontSize={11} fill="white" fontWeight={600}>
        R{data.roundNumber} · {data.source === 'real' ? '✓' : '≈'} {formatTokenCount(total)} tok
      </text>
      {lines.map(([k, v], i) => (
        <text key={k} x={boxX + 8} y={PADDING_TOP + 32 + i * 14} fontSize={10} fill={COLORS[k]}>
          {k} {formatTokenCount(v)}
        </text>
      ))}
    </g>
  );
}

/** Round up to a "nice" axis max (1, 2, 5 × 10^n). */
function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const m = n / base;
  let nice: number;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

/** 5 nice y-tick values from 0..max. */
function yTicks(max: number): number[] {
  const step = max / 5;
  return [0, step, step * 2, step * 3, step * 4, max].map((v) => Math.round(v));
}
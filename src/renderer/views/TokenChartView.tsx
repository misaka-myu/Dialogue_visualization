// src/renderer/views/TokenChartView.tsx
//
// Stacked-bar token usage over rounds. Pure SVG (no chart library) so
// the bundle stays small and the styling matches the rest of the app.
// Each bar is one round, segments stack: cache_creation (bottom),
// input, output, cache_read (top). Hover for a tooltip with exact
// numbers; a thin marker below the bar shows whether the data is real
// (API-reported) or estimated (chars/4 fallback).

import { useEffect, useMemo, useState } from 'react';
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
  // Reset hover when the session changes so we don't carry a stale
  // index over to a different number of bars.
  useEffect(() => {
    setHoverIdx(null);
  }, [session?.id]);

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

  // Aggregate into buckets when the session has many rounds. Without
  // this, CHART_WIDTH is fixed at 880 and ~130+ rounds make each bar
  // clip to 4px; ~2000+ rounds would render past the SVG bounds with
  // the y-axis labels still assuming a 880px canvas. Bucketing keeps
  // the chart legible at any session size. The threshold / bucket
  // size are picked so the chart stays readable on a typical window
  // width: 80 bars at ~10px each fits comfortably.
  const BUCKET_THRESHOLD = 80;
  const display: { rounds: RoundTokenData[]; isBucket: boolean; firstRound: number; lastRound: number }[] = [];
  if (series.length > BUCKET_THRESHOLD) {
    // Aim for ~BUCKET_THRESHOLD bars; round bucket size up.
    const bucketSize = Math.ceil(series.length / BUCKET_THRESHOLD);
    for (let i = 0; i < series.length; i += bucketSize) {
      const slice = series.slice(i, i + bucketSize);
      display.push({
        rounds: slice,
        isBucket: true,
        firstRound: slice[0].roundNumber,
        lastRound: slice[slice.length - 1].roundNumber,
      });
    }
  } else {
    for (const r of series) {
      display.push({ rounds: [r], isBucket: false, firstRound: r.roundNumber, lastRound: r.roundNumber });
    }
  }

  // Pick a "nice" max value that includes a little headroom.
  const maxStack = Math.max(
    1,
    ...display.map((d) =>
      d.rounds.reduce(
        (acc, r) => acc + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens,
        0,
      ),
    ),
  );
  const niceMax = niceCeil(maxStack * 1.1);

  // Width scales with the number of bars so the SVG never overflows.
  const BAR_TARGET_WIDTH = 10;
  const barW = Math.max(4, BAR_TARGET_WIDTH);
  const totalW = PADDING_LEFT + display.length * (barW + BAR_GAP) + PADDING_RIGHT - BAR_GAP;
  const chartW = Math.max(CHART_WIDTH, totalW);
  const innerW = chartW - PADDING_LEFT - PADDING_RIGHT;
  const innerH = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  return (
    <div style={{ padding: '12px 16px', overflow: 'auto' }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>📊 Token 用量趋势（按 round）</span>
        <Legend />
        <span style={{ marginLeft: 'auto', opacity: 0.55 }}>
          {series.length} rounds{series.length > BUCKET_THRESHOLD ? ` · ${display.length} bars (batched)` : ''} · max {formatTokenCount(niceMax)} tok
        </span>
      </div>
      <svg
        width={chartW}
        height={CHART_HEIGHT}
        style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 4, display: 'block', maxWidth: '100%' }}
      >
        {/* Y axis grid lines + labels */}
        {yTicks(niceMax).map((tick) => {
          const y = PADDING_TOP + innerH - (tick / niceMax) * innerH;
          return (
            <g key={tick}>
              <line x1={PADDING_LEFT} x2={chartW - PADDING_RIGHT} y1={y} y2={y} stroke={COLORS.axis} strokeDasharray="2 3" />
              <text x={PADDING_LEFT - 6} y={y + 3} fontSize={10} fill={COLORS.label} textAnchor="end">
                {formatTokenCount(tick)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {display.map((d, i) => {
          const x = PADDING_LEFT + i * (barW + BAR_GAP);
          // Aggregate across the bucket.
          const agg = d.rounds.reduce(
            (acc, r) => ({
              cacheCreationTokens: acc.cacheCreationTokens + r.cacheCreationTokens,
              inputTokens: acc.inputTokens + r.inputTokens,
              outputTokens: acc.outputTokens + r.outputTokens,
              cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
            }),
            { cacheCreationTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
          );
          const total = agg.cacheCreationTokens + agg.inputTokens + agg.outputTokens + agg.cacheReadTokens;
          const h = (total / niceMax) * innerH;
          let yCursor = PADDING_TOP + innerH;
          // Walk bottom-up.
          const rendered: React.ReactNode[] = [];
          for (const [key, value] of [
            ['cache_creation', agg.cacheCreationTokens],
            ['input', agg.inputTokens],
            ['output', agg.outputTokens],
            ['cache_read', agg.cacheReadTokens],
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
          // The bucket is "real" only if every round in it is real.
          const source = d.rounds.every((r) => r.source === 'real') ? 'real' : 'estimate';
          return (
            <g key={i} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
              {rendered}
              {/* X-axis label: round number (or "R{first}-{last}" for a bucket) */}
              <text
                x={x + barW / 2}
                y={CHART_HEIGHT - PADDING_BOTTOM + 14}
                fontSize={10}
                fill={COLORS.label}
                textAnchor="middle"
              >
                {d.isBucket
                  ? `R${d.firstRound}-${d.lastRound}`
                  : `R${d.firstRound}`}
              </text>
              {/* Source marker (real vs estimated) — short bar below the label */}
              <line
                x1={x + barW / 2 - 6}
                x2={x + barW / 2 + 6}
                y1={CHART_HEIGHT - PADDING_BOTTOM + 24}
                y2={CHART_HEIGHT - PADDING_BOTTOM + 24}
                stroke={source === 'real' ? COLORS.output : COLORS.estimate}
                strokeWidth={2}
              />
              {d.rounds.some((r) => r.model) && (
                <text
                  x={x + barW / 2}
                  y={CHART_HEIGHT - PADDING_BOTTOM + 36}
                  fontSize={9}
                  fill={COLORS.label}
                  textAnchor="middle"
                  opacity={0.6}
                >
                  {d.rounds.find((r) => r.model)?.model}
                </text>
              )}
            </g>
          );
        })}
        {/* Tooltip */}
        {hoverIdx !== null && display[hoverIdx] && (
          <Tooltip
            data={{
              roundNumber: display[hoverIdx].firstRound,
              userIndex: 0,
              source: display[hoverIdx].rounds.every((r) => r.source === 'real') ? 'real' : 'estimate',
              inputTokens: display[hoverIdx].rounds.reduce((a, r) => a + r.inputTokens, 0),
              outputTokens: display[hoverIdx].rounds.reduce((a, r) => a + r.outputTokens, 0),
              cacheReadTokens: display[hoverIdx].rounds.reduce((a, r) => a + r.cacheReadTokens, 0),
              cacheCreationTokens: display[hoverIdx].rounds.reduce((a, r) => a + r.cacheCreationTokens, 0),
            }}
            x={PADDING_LEFT + hoverIdx * (barW + BAR_GAP) + barW / 2}
            bucketRange={display[hoverIdx].isBucket ? [display[hoverIdx].firstRound, display[hoverIdx].lastRound] : null}
            chartW={chartW}
          />
        )}
      </svg>
    </div>
  );
}

function Legend() {
  return (
    <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Swatch color={COLORS.cache_creation} label="cache_creation" />
      <Swatch color={COLORS.input} label="input" />
      <Swatch color={COLORS.output} label="output" />
      <Swatch color={COLORS.cache_read} label="cache_read" />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.7 }}>
        <span style={{ width: 12, height: 0, borderTop: `2px solid ${COLORS.output}`, display: 'inline-block' }} />
        <span>✓ 实测</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.7 }}>
        <span style={{ width: 12, height: 0, borderTop: `2px solid ${COLORS.estimate}`, display: 'inline-block' }} />
        <span>≈ 估算</span>
      </span>
    </span>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
      <span style={{ opacity: 0.7 }}>{label}</span>
    </span>
  );
}

function Tooltip({
  data,
  x,
  bucketRange,
  chartW,
}: {
  data: RoundTokenData;
  x: number;
  bucketRange: [number, number] | null;
  chartW: number;
}) {
  const total = data.inputTokens + data.outputTokens + data.cacheReadTokens + data.cacheCreationTokens;
  const lines: Array<['cache_creation' | 'input' | 'output' | 'cache_read', number]> = [
    ['cache_creation', data.cacheCreationTokens],
    ['input', data.inputTokens],
    ['output', data.outputTokens],
    ['cache_read', data.cacheReadTokens],
  ];
  // Clamp x so the box doesn't run off the right edge of the parent svg.
  const boxW = 180;
  const boxX = Math.min(Math.max(boxW / 2, x), chartW - boxW / 2) - boxW / 2;
  return (
    <g>
      <rect x={boxX} y={PADDING_TOP} width={boxW} height={92} rx={4} fill="rgba(30,30,30,0.96)" stroke="rgba(255,255,255,0.15)" />
      <text x={boxX + 8} y={PADDING_TOP + 16} fontSize={11} fill="white" fontWeight={600}>
        {bucketRange ? `R${bucketRange[0]}-${bucketRange[1]}` : `R${data.roundNumber}`} · {data.source === 'real' ? '✓' : '≈'} {formatTokenCount(total)} tok
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
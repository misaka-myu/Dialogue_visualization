// src/renderer/utils/roundToken.ts
//
// Per-round token aggregates for the TokenChart view. A round is "one
// user turn + the assistant work that follows until the next user turn",
// matching the `buildRounds` definition in ConversationDirectory.
//
// Token sources, in priority order:
//   1. Real numbers from ApiRequest.response.usage (the proxy saw the
//      real response). Carries inputTokens / outputTokens / cacheReadTokens
//      / cacheCreationTokens / model.
//   2. Per-message estimates from getMessageTokenInfo (chars / 4) for any
//      round where the API didn't return a usage block — typically
//      scanned historical sessions that were loaded from a JSONL file
//      instead of captured live.
//
// The buildRoundTokenSeries() helper walks the session's `requests`
// and `conversation` together, joining them by `messageCount` so each
// round gets the right slice of usage data.

import type { Message, Session, TokenUsage } from '../../main/model/types';
import { getMessageTokenInfo } from './tokens';
import { buildRounds } from '../components/ConversationDirectory';

export interface RoundTokenData {
  roundNumber: number;
  userIndex: number;
  /** Real (✓) or estimated (≈). When the round is mixed we use real. */
  source: 'real' | 'estimate';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Most common model in the round, when known. */
  model?: string;
}

function sumUsage(usages: TokenUsage[]): Omit<RoundTokenData, 'roundNumber' | 'userIndex' | 'model' | 'source'> {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + (u.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (u.outputTokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (u.cacheReadTokens ?? 0),
      cacheCreationTokens: acc.cacheCreationTokens + (u.cacheCreationTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

/** Aggregate token usage for one round. If any of the round's
 *  ApiRequests have a real usage block, we prefer that and flag the
 *  source as 'real'; otherwise we fall back to char-based estimates
 *  from getMessageTokenInfo. */
export function buildRoundTokenSeries(session: Session): RoundTokenData[] {
  const rounds = buildRounds(session.conversation);
  // Pre-compute each round's inclusive upper bound on the ApiRequest
  // messageCount — i.e. the userIndex of the *next* round (or the
  // total conversation length for the final round). An ApiRequest
  // belongs to round r iff its messageCount is > r.userIndex and
  // <= the next round's start, so it covers the trailing message of
  // round r but no further.
  return rounds.map((round, idx) => {
    const roundUserIdx = round.userIndex;
    const nextRound = rounds[idx + 1];
    const endUserIdx = nextRound ? nextRound.userIndex : Infinity;
    const usages: TokenUsage[] = [];
    for (const req of session.requests) {
      if (
        req.messageCount > roundUserIdx &&
        req.messageCount <= endUserIdx &&
        req.response?.usage
      ) {
        usages.push(req.response.usage);
      }
    }
    const model = usages.find((u) => u.model)?.model;
    if (usages.length > 0) {
      return {
        roundNumber: round.roundNumber,
        userIndex: round.userIndex,
        source: 'real',
        ...sumUsage(usages),
        model,
      };
    }
    // Fallback: estimate from message character counts. We include all
    // messages from the user up to the start of the next round (or the
    // end of the conversation) so the bar roughly matches what the
    // real usage would have been.
    const next = rounds.find((r) => r.roundNumber === round.roundNumber + 1);
    const endIdx = next ? next.userIndex : session.conversation.length;
    let inputEstimate = 0;
    let outputEstimate = 0;
    for (let i = roundUserIdx; i < endIdx; i++) {
      const m = session.conversation[i];
      const info = getMessageTokenInfo(m);
      if (m.role === 'assistant') outputEstimate += info.count;
      else inputEstimate += info.count;
    }
    return {
      roundNumber: round.roundNumber,
      userIndex: round.userIndex,
      source: 'estimate',
      inputTokens: inputEstimate,
      outputTokens: outputEstimate,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  });
}

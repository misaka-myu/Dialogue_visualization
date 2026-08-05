// src/renderer/hooks/virtuosoRef.ts
// Module-scoped handle for the chat-flow Virtuoso. The ChatFlowView attaches
// its ref via `setVirtuosoRef`; the ConversationDirectory reads via
// `getVirtuosoRef` to scroll to a clicked row. Lives outside zustand because
// refs are imperative plumbing, not reactive UI state.

import type { VirtuosoHandle } from 'react-virtuoso';

let virtuosoRef: VirtuosoHandle | null = null;

export function setVirtuosoRef(r: VirtuosoHandle | null): void {
  virtuosoRef = r;
}

export function getVirtuosoRef(): VirtuosoHandle | null {
  return virtuosoRef;
}
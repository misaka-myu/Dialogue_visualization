// src/renderer/utils/requestSelection.ts
// Resolve the currently-selected ApiRequest across views.
//
// Two callers (ApiInspectorView, RequestMessageDirectory) need to agree on
// which request is "selected". The store carries a `selectedRequestId`
// that can be either a real `req.id` (when the session was loaded from a
// log file with stable ids) or the synthetic `req-idx-${i}` that the
// ApiInspectorView timeline emits when a request has no id (e.g. live
// captures where proxy.ts assigns ephemeral ids).
//
// Centralising the lookup here keeps both views from drifting: a fallback
// id that's recognised in one place must be recognised in the other.

import type { ApiRequest } from '../../main/model/types';

/** Find the request that matches `selectedId`, supporting both the real
 *  id and the synthetic `req-idx-${i}` fallback. Falls back to the first
 *  request when nothing matches (so an unrecognised id still shows the
 *  earliest captured request rather than an empty pane). */
export function findCurrentReq(requests: ApiRequest[], selectedId: string | null): ApiRequest | null {
  if (!requests.length) return null;
  if (selectedId === null) return requests[0];
  const idx = requests.findIndex(
    (r, i) => r.id === selectedId || `req-idx-${i}` === selectedId,
  );
  return idx === -1 ? requests[0] : requests[idx];
}

/** Same matching rules as `findCurrentReq`, but returns the index in the
 *  requests array. Returns 0 (matching `findCurrentReq` which falls back to
 *  the first request) when no request matches. Returning -1 here used to
 *  desync ApiInspectorView's left-rail highlight from the right-pane
 *  content (BUG-4). */
export function findCurrentReqIndex(requests: ApiRequest[], selectedId: string | null): number {
  if (!requests.length) return -1;
  if (selectedId === null) return 0;
  const idx = requests.findIndex(
    (r, i) => r.id === selectedId || `req-idx-${i}` === selectedId,
  );
  return idx === -1 ? 0 : idx;
}
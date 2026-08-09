import { describe, it, expect } from 'vitest';
import { findCurrentReq, findCurrentReqIndex } from '../../src/renderer/utils/requestSelection';
import type { ApiRequest } from '../../src/main/model/types';

function makeReqs(): ApiRequest[] {
  return [
    { id: 'req-real-0', timestamp: 1, model: 'm', system: [], messageCount: 0, params: { maxTokens: 0 } },
    { id: 'req-real-1', timestamp: 2, model: 'm', system: [], messageCount: 0, params: { maxTokens: 0 } },
    { id: '', timestamp: 3, model: 'm', system: [], messageCount: 0, params: { maxTokens: 0 } },
  ];
}

describe('findCurrentReq', () => {
  it('returns null for empty list', () => {
    expect(findCurrentReq([], null)).toBeNull();
    expect(findCurrentReq([], 'req-real-0')).toBeNull();
  });

  it('returns first request when selectedId is null', () => {
    const reqs = makeReqs();
    expect(findCurrentReq(reqs, null)).toBe(reqs[0]);
  });

  it('matches by real id', () => {
    const reqs = makeReqs();
    expect(findCurrentReq(reqs, 'req-real-1')).toBe(reqs[1]);
  });

  it('matches the synthetic req-idx-N fallback (the case that used to diverge)', () => {
    const reqs = makeReqs();
    expect(findCurrentReq(reqs, 'req-idx-2')).toBe(reqs[2]);
  });

  it('falls back to first request on unrecognised id', () => {
    const reqs = makeReqs();
    expect(findCurrentReq(reqs, 'req-not-real')).toBe(reqs[0]);
  });
});

describe('findCurrentReqIndex', () => {
  it('returns -1 for empty list', () => {
    expect(findCurrentReqIndex([], null)).toBe(-1);
  });

  it('returns 0 when selectedId is null', () => {
    expect(findCurrentReqIndex(makeReqs(), null)).toBe(0);
  });

  it('matches fallback id at the correct index', () => {
    expect(findCurrentReqIndex(makeReqs(), 'req-idx-2')).toBe(2);
  });

  // BUG-4: the two helpers used to disagree on unrecognised ids
  // (findCurrentReq fell back to 0, findCurrentReqIndex returned -1),
  // which made ApiInspectorView's left-rail highlight and right-pane
  // content desync. They now agree on the same 0-fallback.
  it('returns 0 for unrecognised id (matches findCurrentReq fallback)', () => {
    expect(findCurrentReqIndex(makeReqs(), 'req-not-real')).toBe(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../src/renderer/store';
import { Session } from '../../src/main/model/types';

describe('ApiInspectorView Store & State', () => {
  beforeEach(() => {
    useStore.setState({
      currentSession: null,
      currentView: 'chat-flow',
      selectedRequestId: null,
    });
  });

  it('supports api-inspector view mode switching', () => {
    expect(useStore.getState().currentView).toBe('chat-flow');
    useStore.getState().setCurrentView('api-inspector');
    expect(useStore.getState().currentView).toBe('api-inspector');
  });

  it('updates selectedRequestId when set', () => {
    expect(useStore.getState().selectedRequestId).toBeNull();
    useStore.getState().setSelectedRequestId('req-123');
    expect(useStore.getState().selectedRequestId).toBe('req-123');
  });

  it('sets initial selectedRequestId from session requests when session is opened', () => {
    const mockSession: Session = {
      id: 'test-session-1',
      source: 'proxy-live',
      client: 'claude-code',
      startedAt: Date.now(),
      requests: [
        {
          id: 'req-alpha',
          timestamp: Date.now(),
          model: 'claude-3-7-sonnet-20250219',
          system: [{ type: 'text', text: 'system prompt' }],
          messageCount: 1,
          params: { maxTokens: 4096 },
        },
      ],
      conversation: [],
    };

    useStore.getState().setCurrentSession(mockSession);
    expect(useStore.getState().currentSession?.id).toBe('test-session-1');
    expect(useStore.getState().selectedRequestId).toBe('req-alpha');
  });
});

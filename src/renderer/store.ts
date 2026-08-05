// src/renderer/store.ts
import { create } from 'zustand';
import { Session, ApiRequest, Message } from '../main/model/types';
import { SessionMeta } from '../main/adapters/claude-log';

export type ViewKind = 'chat-flow' | 'json-tree' | 'raw-log';

interface State {
  sessions: SessionMeta[];
  currentSession: Session | null;
  /** Saved live capture session so user can return to it after browsing scanned sessions. */
  liveSession: Session | null;
  currentRequest: ApiRequest | null;
  currentRequestMessages: Message[];
  currentView: ViewKind;
  loading: boolean;
  proxyStatus: { port: number; upstream: string } | null;
  setSessions: (s: SessionMeta[]) => void;
  setCurrentSession: (s: Session | null) => void;
  setCurrentRequest: (r: ApiRequest | null) => void;
  setCurrentView: (v: ViewKind) => void;
  setLoading: (b: boolean) => void;
  refreshSessions: () => Promise<void>;
  openSession: (sourcePath: string) => Promise<void>;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  goToLive: () => void;
}

function deriveMessages(session: Session | null, request: ApiRequest | null): Message[] {
  if (!session || !request) return [];
  return session.conversation.slice(0, request.messageCount);
}

export const useStore = create<State>((set, get) => ({
  sessions: [],
  currentSession: null,
  liveSession: null,
  currentRequest: null,
  currentRequestMessages: [],
  currentView: 'chat-flow',
  loading: false,
  proxyStatus: null,
  setSessions: (s) => set({ sessions: s }),
  setCurrentSession: (s) => {
    const req = s?.requests[0] ?? null;
    set({
      currentSession: s,
      currentRequest: req,
      currentRequestMessages: deriveMessages(s, req),
    });
  },
  setCurrentRequest: (r) => {
    set({
      currentRequest: r,
      currentRequestMessages: deriveMessages(get().currentSession, r),
    });
  },
  setCurrentView: (v) => set({ currentView: v }),
  setLoading: (b) => set({ loading: b }),
  refreshSessions: async () => {
    const sessions = await window.api.listSessions();
    set({ sessions });
  },
  openSession: async (sourcePath) => {
    set({ loading: true });
    try {
      const session = await window.api.loadSession(sourcePath);
      get().setCurrentSession(session);
    } finally {
      set({ loading: false });
    }
  },
  startCapture: async () => {
    const status = await window.api.startProxy();
    if (!status) return;
    set({ proxyStatus: status });
    const live: Session = {
      id: `proxy-live-${Date.now()}`,
      source: 'proxy-live',
      client: 'claude-code',
      startedAt: Date.now(),
      title: `实时捕获 (port ${status.port})`,
      requests: [],
      conversation: [],
    };
    get().setCurrentSession(live);
    set({ liveSession: live });
    window.api.onLiveUpdate((req) => {
      const s = get().currentSession;
      if (!s || s.source !== 'proxy-live') return;
      const requests = [...s.requests, req];
      let conversation = s.conversation;
      if (req.inputMessages) {
        conversation = [...req.inputMessages];
        if (req.response) {
          const u = req.response.usage;
          conversation = [...conversation, { role: 'assistant', content: req.response.content, meta: { outputTokens: u?.outputTokens || undefined, model: req.response.usage.model } }];
        }
      }
      const next = { ...s, requests, conversation };
      set({ currentSession: next, liveSession: next });
    });
  },
  stopCapture: async () => {
    await window.api.stopProxy();
    set({ proxyStatus: null });
  },
  goToLive: () => {
    const live = get().liveSession;
    if (live) get().setCurrentSession(live);
  },
}));

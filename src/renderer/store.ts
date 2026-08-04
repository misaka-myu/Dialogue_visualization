// src/renderer/store.ts
import { create } from 'zustand';
import { Session, ApiRequest, Message } from '../main/model/types';
import { SessionMeta } from '../main/adapters/claude-log';

export type ViewKind = 'json-tree' | 'chat-flow';

interface State {
  sessions: SessionMeta[];
  currentSession: Session | null;
  currentRequest: ApiRequest | null;
  /** Derived: the input messages for currentRequest = conversation.slice(0, messageCount). */
  currentRequestMessages: Message[];
  currentView: ViewKind;
  loading: boolean;
  setSessions: (s: SessionMeta[]) => void;
  setCurrentSession: (s: Session | null) => void;
  setCurrentRequest: (r: ApiRequest | null) => void;
  setCurrentView: (v: ViewKind) => void;
  setLoading: (b: boolean) => void;
  refreshSessions: () => Promise<void>;
  openSession: (sourcePath: string) => Promise<void>;
}

function deriveMessages(session: Session | null, request: ApiRequest | null): Message[] {
  if (!session || !request) return [];
  return session.conversation.slice(0, request.messageCount);
}

export const useStore = create<State>((set, get) => ({
  sessions: [],
  currentSession: null,
  currentRequest: null,
  currentRequestMessages: [],
  currentView: 'chat-flow',
  loading: false,
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
}));

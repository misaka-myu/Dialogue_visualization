// src/renderer/store.ts
import { create } from 'zustand';
import { Session, ApiRequest } from '../main/model/types';
import { SessionMeta } from '../main/adapters/claude-log';

export type ViewKind = 'json-tree' | 'chat-flow';

interface State {
  sessions: SessionMeta[];
  currentSession: Session | null;
  currentRequest: ApiRequest | null;
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

export const useStore = create<State>((set, get) => ({
  sessions: [],
  currentSession: null,
  currentRequest: null,
  currentView: 'chat-flow',
  loading: false,
  setSessions: (s) => set({ sessions: s }),
  setCurrentSession: (s) => {
    set({ currentSession: s, currentRequest: s?.requests[0] ?? null });
  },
  setCurrentRequest: (r) => set({ currentRequest: r }),
  setCurrentView: (v) => set({ currentView: v }),
  setLoading: (b) => set({ loading: b }),
  refreshSessions: async () => {
    const sessions = await window.api.listSessions();
    set({ sessions });
  },
  openSession: async (sourcePath) => {
    set({ loading: true });
    const session = await window.api.loadSession(sourcePath);
    get().setCurrentSession(session);
    set({ loading: false });
  },
}));

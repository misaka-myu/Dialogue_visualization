// src/renderer/store.ts
import { create } from 'zustand';
import { Session, ApiRequest, Message } from '../main/model/types';
import { SessionMeta } from '../main/adapters/claude-log';
import { LiveMeta } from '../main/store/persistent-store';

export type ViewKind = 'chat-flow' | 'json-tree' | 'raw-log';

interface State {
  sessions: SessionMeta[];
  /** Past proxy-live captures, newest first. */
  liveHistory: LiveMeta[];
  currentSession: Session | null;
  /** The file path the user most recently opened from the sidebar (proxy-live
   *  capture path or Claude Code JSONL path). Used to clear `currentSession`
   *  when the underlying file is deleted. */
  openSourcePath: string | null;
  /** Saved live capture session so user can return to it after browsing scanned sessions. */
  liveSession: Session | null;
  currentRequest: ApiRequest | null;
  currentRequestMessages: Message[];
  currentView: ViewKind;
  loading: boolean;
  proxyStatus: { port: number; upstream: string } | null;
  /** Right-side conversation directory panel visibility. Persisted in-memory
   *  only — survives navigation, resets on app restart. */
  directoryOpen: boolean;
  /** Index of the message currently at the top of the chat viewport, used to
   *  highlight the corresponding row in the conversation directory. null
   *  means "no scroll position known yet" (e.g. just switched sessions). */
  activeDirectoryIndex: number | null;
  /** Transient status banner message. The Toast component auto-clears it
   *  after a short delay so callers can fire-and-forget. */
  toast: string | null;
  setSessions: (s: SessionMeta[]) => void;
  setLiveHistory: (l: LiveMeta[]) => void;
  setCurrentSession: (s: Session | null) => void;
  setCurrentRequest: (r: ApiRequest | null) => void;
  setCurrentView: (v: ViewKind) => void;
  setLoading: (b: boolean) => void;
  setDirectoryOpen: (open: boolean) => void;
  setActiveDirectoryIndex: (i: number | null) => void;
  setToast: (message: string | null) => void;
  refreshSessions: () => Promise<void>;
  refreshLiveHistory: () => Promise<void>;
  openSession: (sourcePath: string) => Promise<void>;
  openLive: (path: string) => Promise<void>;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  goToLive: () => void;
  /** Delete a proxy-live capture (our own .proxy-live-*.json). */
  deleteLiveCapture: (path: string) => Promise<boolean>;
  /** Rename a proxy-live capture (in-place title update). */
  renameLiveCapture: (path: string, newTitle: string) => Promise<string | null>;
  /** Export a proxy-live capture to a user-chosen path. */
  exportLiveCapture: (path: string, exportPath: string) => Promise<string | null>;
  /** Delete a Claude Code JSONL session (DESTRUCTIVE — affects Claude Code). */
  deleteClaudeSession: (sourcePath: string) => Promise<boolean>;
  /** Export a Claude Code JSONL session to a user-chosen path. */
  exportClaudeSession: (sourcePath: string, exportPath: string) => Promise<string | null>;
  /** Open a save dialog and return the chosen path (or null if canceled). */
  pickExportPath: (defaultName: string) => Promise<string | null>;
}

function deriveMessages(session: Session | null, request: ApiRequest | null): Message[] {
  if (!session || !request) return [];
  return session.conversation.slice(0, request.messageCount);
}

export const useStore = create<State>((set, get) => ({
  sessions: [],
  liveHistory: [],
  currentSession: null,
  openSourcePath: null,
  liveSession: null,
  currentRequest: null,
  currentRequestMessages: [],
  currentView: 'chat-flow',
  loading: false,
  proxyStatus: null,
  directoryOpen: true,
  activeDirectoryIndex: null,
  toast: null,
  setSessions: (s) => set({ sessions: s }),
  setLiveHistory: (l) => set({ liveHistory: l }),
  setCurrentSession: (s) => {
    const req = s?.requests[0] ?? null;
    set({
      currentSession: s,
      currentRequest: req,
      currentRequestMessages: deriveMessages(s, req),
      // No file path is associated with a programmatic session change
      // (e.g. starting a fresh capture); callers that DO open a specific
      // file should follow up by setting openSourcePath themselves.
      openSourcePath: s ? get().openSourcePath : null,
      // Reset scroll-sync highlight so the directory doesn't briefly show a
      // stale index while the new session's rangeChanged fires.
      activeDirectoryIndex: null,
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
  setDirectoryOpen: (open) => set({ directoryOpen: open }),
  setActiveDirectoryIndex: (i) => set({ activeDirectoryIndex: i }),
  setToast: (message) => set({ toast: message }),
  refreshSessions: async () => {
    const sessions = await window.api.listSessions();
    set({ sessions });
  },
  refreshLiveHistory: async () => {
    try {
      const liveHistory = await window.api.listLive();
      set({ liveHistory });
    } catch {
      // Live history is a convenience feature; never block the UI on it.
    }
  },
  openSession: async (sourcePath) => {
    set({ loading: true });
    try {
      const session = await window.api.loadSession(sourcePath);
      get().setCurrentSession(session);
      set({ openSourcePath: sourcePath });
    } finally {
      set({ loading: false });
    }
  },
  openLive: async (path) => {
    set({ loading: true });
    try {
      const session = await window.api.loadLive(path);
      if (!session) return;
      get().setCurrentSession(session);
      set({ openSourcePath: path });
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
    // Refresh the history list so the new capture shows up in the sidebar.
    get().refreshLiveHistory();
  },
  stopCapture: async () => {
    await window.api.stopProxy();
    set({ proxyStatus: null });
    // Capture may have grown; refresh history so the file's metadata is fresh.
    get().refreshLiveHistory();
  },
  goToLive: () => {
    const live = get().liveSession;
    if (live) get().setCurrentSession(live);
  },
  deleteLiveCapture: async (path) => {
    try {
      const ok = await window.api.deleteLive(path);
      if (!ok) return false;
      if (get().openSourcePath === path) {
        get().setCurrentSession(null);
        set({ openSourcePath: null });
      }
      await get().refreshLiveHistory();
      return true;
    } catch (err) {
      console.error('[store] deleteLiveCapture failed:', err);
      return false;
    }
  },
  renameLiveCapture: async (path, newTitle) => {
    try {
      const result = await window.api.liveRename(path, newTitle);
      if (result !== null) await get().refreshLiveHistory();
      return result;
    } catch (err) {
      console.error('[store] renameLiveCapture failed:', err);
      return null;
    }
  },
  exportLiveCapture: async (path, exportPath) => {
    try {
      return await window.api.liveExport(path, exportPath);
    } catch (err) {
      console.error('[store] exportLiveCapture failed:', err);
      return null;
    }
  },
  deleteClaudeSession: async (sourcePath) => {
    try {
      const ok = await window.api.claudeDelete(sourcePath);
      if (!ok) return false;
      if (get().openSourcePath === sourcePath) {
        get().setCurrentSession(null);
        set({ openSourcePath: null });
      }
      await get().refreshSessions();
      return true;
    } catch (err) {
      console.error('[store] deleteClaudeSession failed:', err);
      return false;
    }
  },
  exportClaudeSession: async (sourcePath, exportPath) => {
    try {
      return await window.api.claudeExport(sourcePath, exportPath);
    } catch (err) {
      console.error('[store] exportClaudeSession failed:', err);
      return null;
    }
  },
  pickExportPath: async (defaultName) => {
    try {
      return await window.api.pickExportPath(defaultName);
    } catch (err) {
      console.error('[store] pickExportPath failed:', err);
      return null;
    }
  },
}));

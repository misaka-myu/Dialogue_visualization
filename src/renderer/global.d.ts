// src/renderer/global.d.ts
import { SessionMeta } from '../main/adapters/claude-log';
import { Session, ApiRequest } from '../main/model/types';
import { LiveMeta } from '../main/store/persistent-store';

export interface ApiBinding {
  listSessions: () => Promise<SessionMeta[]>;
  loadSession: (sourcePath: string) => Promise<Session | null>;
  startProxy: () => Promise<{ port: number; upstream: string } | null>;
  stopProxy: () => Promise<void>;
  launchClaude: (port: number) => Promise<{ pid: number } | null>;
  onLiveUpdate: (cb: (req: ApiRequest) => void) => void;
  listLive: () => Promise<LiveMeta[]>;
  loadLive: (path: string) => Promise<Session | null>;
  deleteLive: (path: string) => Promise<boolean>;
}

declare global {
  interface Window {
    api: ApiBinding;
  }
}

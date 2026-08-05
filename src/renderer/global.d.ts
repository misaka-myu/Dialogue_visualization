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
  liveRename: (path: string, newTitle: string) => Promise<string | null>;
  liveExport: (path: string, exportPath: string) => Promise<string | null>;
  claudeDelete: (sourcePath: string) => Promise<boolean>;
  claudeExport: (sourcePath: string, exportPath: string) => Promise<string | null>;
  pickExportPath: (defaultName: string) => Promise<string | null>;
}

declare global {
  interface Window {
    api: ApiBinding;
  }
}

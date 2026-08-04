// src/renderer/global.d.ts
import { SessionMeta } from '../main/adapters/claude-log';
import { Session, ApiRequest } from '../main/model/types';

export interface ApiBinding {
  listSessions: () => Promise<SessionMeta[]>;
  loadSession: (sourcePath: string) => Promise<Session | null>;
}

declare global {
  interface Window {
    api: ApiBinding;
  }
}

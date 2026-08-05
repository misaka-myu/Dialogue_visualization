// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { ApiRequest, Session } from '../main/model/types';
import { LiveMeta } from '../main/store/persistent-store';

contextBridge.exposeInMainWorld('api', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (sourcePath: string) => ipcRenderer.invoke('sessions:load', sourcePath),
  startProxy: () => ipcRenderer.invoke('proxy:start'),
  stopProxy: () => ipcRenderer.invoke('proxy:stop'),
  launchClaude: (port: number) => ipcRenderer.invoke('proxy:launch-claude', port),
  onLiveUpdate: (cb: (req: ApiRequest) => void) =>
    ipcRenderer.on('proxy:live-update', (_e, req) => cb(req)),
  listLive: () => ipcRenderer.invoke('live:list'),
  loadLive: (path: string) => ipcRenderer.invoke('live:load', path),
  deleteLive: (path: string) => ipcRenderer.invoke('live:delete', path),
});

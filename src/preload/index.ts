// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { ApiRequest } from '../main/model/types';

contextBridge.exposeInMainWorld('api', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (sourcePath: string) => ipcRenderer.invoke('sessions:load', sourcePath),
  startProxy: () => ipcRenderer.invoke('proxy:start'),
  stopProxy: () => ipcRenderer.invoke('proxy:stop'),
  launchClaude: (port: number) => ipcRenderer.invoke('proxy:launch-claude', port),
  onLiveUpdate: (cb: (req: ApiRequest) => void) =>
    ipcRenderer.on('proxy:live-update', (_e, req) => cb(req)),
});

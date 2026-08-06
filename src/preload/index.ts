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
  liveRename: (path: string, newTitle: string) => ipcRenderer.invoke('live:rename', path, newTitle),
  liveExport: (path: string, exportPath: string) => ipcRenderer.invoke('live:export', path, exportPath),
  claudeDelete: (sourcePath: string) => ipcRenderer.invoke('claude:delete', sourcePath),
  claudeExport: (sourcePath: string, exportPath: string) => ipcRenderer.invoke('claude:export', sourcePath, exportPath),
  // Codex
  listCodex: () => ipcRenderer.invoke('codex:list'),
  loadCodex: (sourcePath: string) => ipcRenderer.invoke('codex:load', sourcePath),
  codexDelete: (sourcePath: string) => ipcRenderer.invoke('codex:delete', sourcePath),
  codexExport: (sourcePath: string, exportPath: string) => ipcRenderer.invoke('codex:export', sourcePath, exportPath),
  startCodex: () => ipcRenderer.invoke('codex:start'),
  stopCodex: () => ipcRenderer.invoke('codex:stop'),
  pickExportPath: (defaultName: string) => ipcRenderer.invoke('claude:pickExportPath', defaultName),
});

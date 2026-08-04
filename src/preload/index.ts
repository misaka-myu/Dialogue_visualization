// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  loadSession: (sourcePath: string) => ipcRenderer.invoke('sessions:load', sourcePath),
});

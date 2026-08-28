/**
 * Preload bridge: the only door between the renderer and the main process.
 *
 * contextIsolation is on and nodeIntegration is off, so the renderer cannot
 * touch Node or Electron internals — it gets exactly the methods of RevelioApi,
 * each one a typed ipcRenderer.invoke call. Keeping this file to electron
 * imports only means it stays safe under the sandbox.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, MainEvent, RevelioApi } from '../shared/types';

const api: RevelioApi = {
  // Folders
  listFolders: () => ipcRenderer.invoke('folders:list'),
  addFolder: (path) => ipcRenderer.invoke('folders:add', path),
  removeFolder: (id) => ipcRenderer.invoke('folders:remove', id),
  reindexFolder: (id) => ipcRenderer.invoke('folders:reindex', id),
  setFolderWatch: (id, watch) => ipcRenderer.invoke('folders:setWatch', id, watch),
  setFolderAi: (id, ai) => ipcRenderer.invoke('folders:setAi', id, ai),
  pickFolder: () => ipcRenderer.invoke('folders:pick'),

  // Files
  getFile: (id) => ipcRenderer.invoke('files:get', id),
  openFile: (id) => ipcRenderer.invoke('files:open', id),
  revealFile: (id) => ipcRenderer.invoke('files:reveal', id),
  reanalyzeFile: (id) => ipcRenderer.invoke('files:reanalyze', id),
  retryFile: (id) => ipcRenderer.invoke('files:retry', id),

  // Search + stats
  search: (raw) => ipcRenderer.invoke('search:query', raw),
  getStats: () => ipcRenderer.invoke('stats:get'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch),

  // Events
  onEvent: (cb: (event: MainEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MainEvent): void => {
      cb(payload);
    };
    ipcRenderer.on('revelio:event', listener);
    return () => {
      ipcRenderer.removeListener('revelio:event', listener);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);

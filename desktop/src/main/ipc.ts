/**
 * IPC registration: the main-process implementation of the RevelioApi contract.
 *
 * Every handler runs server-side with full Node access; the renderer only ever
 * sees the return values defined in shared/types.ts. Channels are named
 * `<noun>:<verb>` and mirror the RevelioApi methods one to one.
 */

import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import {
  deleteFolder,
  findFolderByPath,
  getStats,
  insertFolder,
  listFolders,
  setFolderAi as dbSetFolderAi,
  setFolderWatch as dbSetFolderWatch,
  getFile,
} from './db/db';
import { getSettings, updateSettings } from './settings';
import { search } from './search/query';
import { normalizePath } from './indexing/walk';
import type { Indexer } from './indexing/indexer';
import type { FolderWatcher } from './indexing/watcher';
import type { AppSettings, MainEvent } from '@shared/types';

export interface IpcContext {
  indexer: Indexer;
  watcher: FolderWatcher;
  getWindow: () => BrowserWindow | null;
  emit: (event: MainEvent) => void;
}

export function registerIpc(ctx: IpcContext): void {
  const { indexer, watcher, emit } = ctx;

  const refreshWatchers = async (): Promise<void> => {
    await watcher.sync(listFolders(), getSettings().excludePatterns);
  };

  // ── Folders ────────────────────────────────────────────────────────────────

  ipcMain.handle('folders:list', () => listFolders());

  ipcMain.handle('folders:add', async (_e, rawPath: string) => {
    const path = normalizePath(rawPath.trim());
    if (!path) throw new Error('no folder path given');

    const existing = findFolderByPath(path);
    if (existing) return existing;

    // Reject nesting an already-connected folder: two watchers on one tree
    // would double-index everything.
    const all = listFolders();
    if (all.some((f) => path.startsWith(f.path + '/') || f.path.startsWith(path + '/'))) {
      throw new Error('This folder overlaps with one that is already connected.');
    }

    const label = path.split('/').filter(Boolean).pop() ?? path;
    const folder = insertFolder(path, label);

    emit({ type: 'files:changed' });
    void refreshWatchers();
    // Index in the background; progress events stream to the renderer.
    void indexer.indexFolder(folder.id).catch((error) => {
      console.error(`[ipc] indexing ${path} failed:`, error);
    });

    return folder;
  });

  ipcMain.handle('folders:remove', async (_e, id: number) => {
    await watcher.stop(id);
    deleteFolder(id, true);
    emit({ type: 'files:changed' });
  });

  ipcMain.handle('folders:reindex', (_e, id: number) => {
    void indexer.indexFolder(id).catch((error) => {
      console.error(`[ipc] reindex of folder ${id} failed:`, error);
    });
  });

  ipcMain.handle('folders:setWatch', async (_e, id: number, watch: boolean) => {
    dbSetFolderWatch(id, watch);
    await refreshWatchers();
  });

  ipcMain.handle('folders:setAi', (_e, id: number, ai: boolean) => {
    dbSetFolderAi(id, ai);
  });

  ipcMain.handle('folders:pick', async () => {
    const window = ctx.getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  });

  // ── Files ──────────────────────────────────────────────────────────────────

  ipcMain.handle('files:get', (_e, id: number) => indexer.getFileDetails(id));

  ipcMain.handle('files:open', async (_e, id: number) => {
    const row = getFile(id);
    if (!row) return 'file not in index';
    const error = await shell.openPath(row.path);
    return error || null;
  });

  ipcMain.handle('files:reveal', (_e, id: number) => {
    const row = getFile(id);
    if (row) shell.showItemInFolder(row.path);
  });

  ipcMain.handle('files:reanalyze', async (_e, id: number) => indexer.reanalyze(id));

  ipcMain.handle('files:retry', (_e, id: number) => {
    indexer.retry(id);
  });

  // ── Search + stats ─────────────────────────────────────────────────────────

  ipcMain.handle('search:query', (_e, raw: string) => search(typeof raw === 'string' ? raw : ''));

  ipcMain.handle('stats:get', () => getStats());

  // ── Settings ───────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = updateSettings(patch ?? {});
    // Exclusion patterns affect what the watchers see.
    void refreshWatchers();
    return next;
  });
}

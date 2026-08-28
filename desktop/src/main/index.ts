/**
 * Electron main entry.
 *
 * Wires the four long-lived pieces — database, settings, indexer, watcher —
 * then opens the window. The renderer talks to all of it exclusively through
 * the preload bridge (see ipc.ts for the handler implementations).
 */

import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, closeDatabase, listFolders, markFileMissing } from './db/db';
import { initSettings, getSettings } from './settings';
import { setOcrLangPath } from './processing/ocr';
import { Indexer } from './indexing/indexer';
import { FolderWatcher } from './indexing/watcher';
import { registerIpc } from './ipc';
import type { MainEvent } from '@shared/types';

let mainWindow: BrowserWindow | null = null;
let indexer: Indexer;
let watcher: FolderWatcher;

const emit = (event: MainEvent): void => {
  mainWindow?.webContents.send('revelio:event', event);
};

/**
 * Locates the bundled OCR language data. In dev it lives next to the project;
 * in a packaged build electron-builder copies it under process.resourcesPath.
 * Returns null when absent so tesseract falls back to its default (CDN).
 */
function resolveOcrLangDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'resources'), process.resourcesPath]
    : [join(app.getAppPath(), 'resources')];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'eng.traineddata'))) return dir;
  }
  return null;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#f7f4ea',
    title: 'Revelio',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the browser, never in a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');

  initSettings(userData);
  openDatabase(join(userData, 'revelio.db'));
  setOcrLangPath(resolveOcrLangDir());

  indexer = new Indexer(emit);
  watcher = new FolderWatcher({
    onFile: (file, folderId) => indexer.scheduleWalkedFile(file, folderId),
    onUnlink: (path) => {
      markFileMissing(path);
      emit({ type: 'files:changed' });
    },
  });

  registerIpc({ indexer, watcher, getWindow: () => mainWindow, emit });
  createWindow();

  // Pick up anything left pending from a previous run, then start watching.
  indexer.resumePending();
  void watcher.sync(listFolders(), getSettings().excludePatterns);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void watcher.stopAll();
  closeDatabase();
});

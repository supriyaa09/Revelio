/**
 * Folder monitoring.
 *
 * One chokidar watcher per connected root with `watch` enabled. New or changed
 * files are handed to the indexer; deletions mark the row missing. No upload
 * button anywhere: a file dropped into Downloads becomes searchable on its own.
 *
 * The `ignored` callback reuses the walk's exclusion semantics so the watcher
 * never even descends into node_modules-style trees.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { stat } from 'node:fs/promises';
import { kindForFilename, normalizePath } from './walk';
import type { WalkedFile } from './walk';
import type { FolderRecord } from '@shared/types';

interface WatcherCallbacks {
  onFile: (file: WalkedFile, folderId: number) => void;
  onUnlink: (path: string) => void;
}

export class FolderWatcher {
  private watchers = new Map<number, FSWatcher>();

  constructor(private callbacks: WatcherCallbacks) {}

  /** Align running watchers with the current folder list. */
  async sync(folders: FolderRecord[], globalExcludes: string[]): Promise<void> {
    const wanted = new Map(folders.filter((f) => f.watch).map((f) => [f.id, f]));

    for (const [id] of this.watchers) {
      if (!wanted.has(id)) await this.stop(id);
    }

    for (const [id, folder] of wanted) {
      if (!this.watchers.has(id)) {
        this.start(folder, globalExcludes);
      }
    }
  }

  private start(folder: FolderRecord, globalExcludes: string[]): void {
    const excludes = new Set(
      [...globalExcludes, ...folder.exclude_patterns].map((p) => p.trim().toLowerCase()).filter(Boolean),
    );

    const ignored = (path: string): boolean => {
      const norm = normalizePath(path);
      const segments = norm.split('/').filter(Boolean);
      for (const seg of segments) {
        if (seg.startsWith('.')) return true;
        if (excludes.has(seg)) return true;
        // "*.ext" rules apply to the final segment only.
      }
      return false;
    };

    const watcher = chokidar.watch(folder.path, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      depth: 30,
      awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 150 },
      ignored,
    });

    watcher.on('add', (p) => void this.handleAdd(p, folder.id));
    watcher.on('change', (p) => void this.handleAdd(p, folder.id));
    watcher.on('unlink', (p) => {
      this.callbacks.onUnlink(normalizePath(p));
    });
    watcher.on('error', (error) => {
      console.error(`[watcher] folder ${folder.path}:`, error);
    });

    this.watchers.set(folder.id, watcher);
  }

  private async handleAdd(rawPath: string, folderId: number): Promise<void> {
    const path = normalizePath(rawPath);
    const filename = path.split('/').pop() ?? path;

    const typed = kindForFilename(filename);
    if (!typed) return;

    try {
      const st = await stat(path);
      if (!st.isFile() || st.size === 0) return;

      this.callbacks.onFile(
        {
          path,
          filename,
          extension: typed.extension,
          kind: typed.kind,
          size: st.size,
          mtime: st.mtime.toISOString(),
          ctime: st.ctime.toISOString(),
        },
        folderId,
      );
    } catch {
      // File vanished between event and stat — the next walk reconciles it.
    }
  }

  async stop(folderId: number): Promise<void> {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(folderId);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((id) => this.stop(id)));
  }
}

/**
 * Tolerant recursive folder walk.
 *
 * Local folders are hostile territory: permission-denied entries, locked files,
 * junction/symlink loops, multi-million-file trees. The walk must never throw
 * its way out of a folder — every problem entry is skipped and counted, and the
 * rest of the tree is still indexed.
 *
 * Paths are normalized to forward slashes everywhere in the app so SQLite
 * prefix queries (`path LIKE folder || '/%'`) work identically on Windows and
 * POSIX.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileKind } from '@shared/types';

export interface WalkedFile {
  path: string; // normalized, '/' separators
  filename: string;
  extension: string | null;
  kind: FileKind;
  size: number;
  mtime: string; // ISO
  ctime: string; // ISO
}

export interface WalkOptions {
  maxFileSizeBytes: number;
  /** Directory/file-name segments to skip (e.g. node_modules) and "*.ext" rules. */
  excludePatterns: string[];
  /** Optional cap for tests / huge trees; 0 = unlimited. */
  maxFiles?: number;
}

export interface WalkResult {
  files: WalkedFile[];
  skipped: number;
  errors: number;
}

const KIND_BY_EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
};

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function kindForFilename(filename: string): { kind: FileKind; extension: string | null } | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  const kind = KIND_BY_EXT[ext];
  return kind ? { kind, extension: ext } : null;
}

/** Precompiled exclusion rules for one walk. */
interface ExcludeRules {
  segments: Set<string>;
  extensions: Set<string>;
}

function compileExcludes(patterns: string[]): ExcludeRules {
  const segments = new Set<string>();
  const extensions = new Set<string>();
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p.startsWith('*.')) extensions.add(p.slice(2));
    else segments.add(p.replace(/[\\/]/g, ''));
  }
  return { segments, extensions };
}

function isExcluded(filename: string, extension: string | null, rules: ExcludeRules): boolean {
  if (filename.startsWith('.')) return true; // hidden files
  if (rules.segments.has(filename.toLowerCase())) return true;
  if (extension && rules.extensions.has(extension)) return true;
  return false;
}

/**
 * Recursively walks `root`, returning every indexable file. Symlinks are never
 * followed (loop safety); unreadable directories are skipped, not fatal.
 */
export async function walkFolder(root: string, options: WalkOptions): Promise<WalkResult> {
  const rules = compileExcludes(options.excludePatterns);
  const files: WalkedFile[] = [];
  let skipped = 0;
  let errors = 0;
  const maxFiles = options.maxFiles ?? 0;

  const queue: string[] = [normalizePath(root)];

  while (queue.length > 0) {
    const dir = queue.shift()!;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      errors++;
      continue;
    }

    for (const entry of entries) {
      if (maxFiles > 0 && files.length >= maxFiles) return { files, skipped, errors };

      const name = entry.name;

      // Symlinks are skipped entirely: following them risks loops and escaping
      // the consented root. Junctions on Windows report as symlinks here too.
      if (entry.isSymbolicLink()) {
        skipped++;
        continue;
      }

      const full = join(dir, name);

      if (entry.isDirectory()) {
        if (isExcluded(name, null, rules)) {
          skipped++;
          continue;
        }
        queue.push(normalizePath(full));
        continue;
      }

      if (!entry.isFile()) {
        skipped++;
        continue;
      }

      const typed = kindForFilename(name);
      if (!typed) {
        skipped++;
        continue;
      }
      if (isExcluded(name, typed.extension, rules)) {
        skipped++;
        continue;
      }

      try {
        const st = await stat(full);
        if (!st.isFile()) {
          skipped++;
          continue;
        }
        if (st.size === 0) {
          skipped++;
          continue;
        }
        if (st.size > options.maxFileSizeBytes) {
          skipped++;
          continue;
        }
        files.push({
          path: normalizePath(full),
          filename: name,
          extension: typed.extension,
          kind: typed.kind,
          size: st.size,
          mtime: st.mtime.toISOString(),
          ctime: st.ctime.toISOString(),
        });
      } catch {
        // Locked or vanished between readdir and stat — not fatal.
        errors++;
      }
    }
  }

  return { files, skipped, errors };
}

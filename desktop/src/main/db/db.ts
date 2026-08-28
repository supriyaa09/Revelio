/**
 * Database access layer.
 *
 * Owns the better-sqlite3 connection and every prepared statement. Rows cross
 * this boundary as raw SQLite shapes (JSON columns as strings, booleans as
 * 0/1) and leave it as the typed records defined in shared/types.ts — the rest
 * of the main process never touches raw rows.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';
import type {
  ChunkRecord,
  EntityRef,
  FileKind,
  FileRecord,
  FileStatus,
  FolderRecord,
  ImportantDate,
  Stats,
} from '@shared/types';

let db: Database.Database | null = null;

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath);
  conn.exec(SCHEMA_SQL);
  conn.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION),
  );
  db = conn;
  return conn;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('database not opened');
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

// ── Row → record mapping ─────────────────────────────────────────────────────

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface FileRow {
  id: number;
  folder_id: number | null;
  path: string;
  filename: string;
  extension: string | null;
  kind: string | null;
  size: number | null;
  mtime: string | null;
  ctime: string | null;
  content_hash: string | null;
  status: string;
  error: string | null;
  method: string | null;
  page_count: number | null;
  char_count: number | null;
  title: string | null;
  summary: string | null;
  keywords: string | null;
  entities: string | null;
  important_dates: string | null;
  category: string | null;
  doc_date: string | null;
  ai_model: string | null;
  ai_status: string;
  ai_error: string | null;
  indexed_at: string | null;
  updated_at: string | null;
}

export function mapFileRow(row: FileRow): FileRecord {
  return {
    id: row.id,
    folder_id: row.folder_id,
    path: row.path,
    filename: row.filename,
    extension: row.extension,
    kind: (row.kind as FileKind | null) ?? null,
    size: row.size,
    mtime: row.mtime,
    ctime: row.ctime,
    content_hash: row.content_hash,
    status: row.status as FileStatus,
    error: row.error,
    method: (row.method as FileRecord['method']) ?? null,
    page_count: row.page_count,
    char_count: row.char_count,
    title: row.title,
    summary: row.summary,
    keywords: parseJson<string[]>(row.keywords, []),
    entities: parseJson<EntityRef[]>(row.entities, []),
    important_dates: parseJson<ImportantDate[]>(row.important_dates, []),
    category: row.category,
    doc_date: row.doc_date,
    ai_model: row.ai_model,
    ai_status: (row.ai_status as FileRecord['ai_status']) ?? 'none',
    ai_error: row.ai_error,
    indexed_at: row.indexed_at,
    updated_at: row.updated_at,
  };
}

interface FolderRow {
  id: number;
  path: string;
  label: string | null;
  watch: number;
  ai_enabled: number;
  exclude_patterns: string;
  last_indexed_at: string | null;
  created_at: string;
  file_count: number;
  ready_count: number;
  failed_count: number;
}

function mapFolderRow(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    path: row.path,
    label: row.label,
    watch: row.watch === 1,
    ai_enabled: row.ai_enabled === 1,
    exclude_patterns: parseJson<string[]>(row.exclude_patterns, []),
    last_indexed_at: row.last_indexed_at,
    created_at: row.created_at,
    file_count: row.file_count ?? 0,
    ready_count: row.ready_count ?? 0,
    failed_count: row.failed_count ?? 0,
  };
}

// ── Folders ──────────────────────────────────────────────────────────────────

const FOLDER_SELECT = `
  SELECT f.*,
         (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id AND x.status != 'missing') AS file_count,
         (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id AND x.status = 'ready')    AS ready_count,
         (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id AND x.status = 'failed')   AS failed_count
  FROM folders f
`;

export function listFolders(): FolderRecord[] {
  const rows = getDb().prepare(`${FOLDER_SELECT} ORDER BY f.created_at`).all() as FolderRow[];
  return rows.map(mapFolderRow);
}

export function getFolder(id: number): FolderRecord | null {
  const row = getDb().prepare(`${FOLDER_SELECT} WHERE f.id = ?`).get(id) as FolderRow | undefined;
  return row ? mapFolderRow(row) : null;
}

export function findFolderByPath(path: string): FolderRecord | null {
  const row = getDb().prepare(`${FOLDER_SELECT} WHERE f.path = ?`).get(path) as FolderRow | undefined;
  return row ? mapFolderRow(row) : null;
}

export function insertFolder(path: string, label: string | null): FolderRecord {
  const info = getDb()
    .prepare('INSERT INTO folders(path, label) VALUES (?, ?)')
    .run(path, label);
  return getFolder(Number(info.lastInsertRowid))!;
}

export function deleteFolder(id: number, deleteFiles: boolean): void {
  const conn = getDb();
  const tx = conn.transaction(() => {
    if (deleteFiles) {
      conn.prepare('DELETE FROM files WHERE folder_id = ?').run(id);
    } else {
      conn.prepare('UPDATE files SET folder_id = NULL WHERE folder_id = ?').run(id);
    }
    conn.prepare('DELETE FROM folders WHERE id = ?').run(id);
  });
  tx();
}

export function setFolderWatch(id: number, watch: boolean): void {
  getDb().prepare('UPDATE folders SET watch = ? WHERE id = ?').run(watch ? 1 : 0, id);
}

export function setFolderAi(id: number, ai: boolean): void {
  getDb().prepare('UPDATE folders SET ai_enabled = ? WHERE id = ?').run(ai ? 1 : 0, id);
}

export function markFolderIndexed(id: number): void {
  getDb()
    .prepare("UPDATE folders SET last_indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(id);
}

// ── Files ────────────────────────────────────────────────────────────────────

export function getFileRow(id: number): FileRow | undefined {
  return getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
}

export function getFile(id: number): FileRecord | null {
  const row = getFileRow(id);
  return row ? mapFileRow(row) : null;
}

export function findFileByPath(path: string): FileRecord | null {
  const row = getDb().prepare('SELECT * FROM files WHERE path = ?').get(path) as FileRow | undefined;
  return row ? mapFileRow(row) : null;
}

export function findFileByHash(hash: string, excludePath: string): FileRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM files WHERE content_hash = ? AND path != ? LIMIT 1')
    .get(hash, excludePath) as FileRow | undefined;
  return row ? mapFileRow(row) : null;
}

/**
 * Inserts a placeholder row for a newly-discovered file, or refreshes stat
 * fields for a known one. Returns the file id. A row that was `missing` and
 * reappears is revived as `pending`.
 */
export function upsertDiscoveredFile(input: {
  path: string;
  filename: string;
  extension: string | null;
  kind: FileKind;
  size: number;
  mtime: string;
  ctime: string;
  folder_id: number | null;
}): number {
  const conn = getDb();
  const existing = conn.prepare('SELECT id, status FROM files WHERE path = ?').get(input.path) as
    | { id: number; status: string }
    | undefined;

  if (existing) {
    conn
      .prepare(
        `UPDATE files SET filename = ?, extension = ?, kind = ?, size = ?, mtime = ?, ctime = ?,
         folder_id = ?, status = CASE WHEN status = 'missing' THEN 'pending' ELSE status END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
      )
      .run(
        input.filename,
        input.extension,
        input.kind,
        input.size,
        input.mtime,
        input.ctime,
        input.folder_id,
        existing.id,
      );
    return existing.id;
  }

  const info = conn
    .prepare(
      `INSERT INTO files(path, filename, extension, kind, size, mtime, ctime, folder_id, status, title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      input.path,
      input.filename,
      input.extension,
      input.kind,
      input.size,
      input.mtime,
      input.ctime,
      input.folder_id,
      titleFromFilename(input.filename),
    );
  return Number(info.lastInsertRowid);
}

export function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  // Turn "dbms-unit-2-notes" / "dbms_unit_2_notes" into something readable.
  return stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || filename;
}

export function setFileStatus(id: number, status: FileStatus, error: string | null = null): void {
  getDb()
    .prepare(
      `UPDATE files SET status = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
    .run(status, error, id);
}

/** Persists extraction results. Searchable from this moment on. */
export function saveExtraction(input: {
  id: number;
  content_hash: string;
  method: 'text' | 'ocr' | 'mixed';
  page_count: number;
  char_count: number;
  body: string;
}): void {
  getDb()
    .prepare(
      `UPDATE files SET status = 'ready', error = NULL, content_hash = ?, method = ?,
       page_count = ?, char_count = ?, body = ?,
       indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    )
    .run(
      input.content_hash,
      input.method,
      input.page_count,
      input.char_count,
      input.body,
      input.id,
    );
}

/** Persists AI enrichment results (or the reason there are none). */
export function saveAnalysis(input: {
  id: number;
  ai_status: 'pending' | 'ok' | 'skipped' | 'failed';
  ai_error?: string | null;
  ai_model?: string | null;
  summary?: string | null;
  keywords?: string[];
  entities?: EntityRef[];
  important_dates?: ImportantDate[];
  category?: string | null;
  doc_date?: string | null;
}): void {
  getDb()
    .prepare(
      `UPDATE files SET ai_status = ?, ai_error = ?, ai_model = ?,
       summary = COALESCE(?, summary),
       keywords = COALESCE(?, keywords),
       entities = COALESCE(?, entities),
       important_dates = COALESCE(?, important_dates),
       category = COALESCE(?, category),
       doc_date = COALESCE(?, doc_date),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    )
    .run(
      input.ai_status,
      input.ai_error ?? null,
      input.ai_model ?? null,
      input.summary ?? null,
      input.keywords ? JSON.stringify(input.keywords) : null,
      input.entities ? JSON.stringify(input.entities) : null,
      input.important_dates ? JSON.stringify(input.important_dates) : null,
      input.category ?? null,
      input.doc_date ?? null,
      input.id,
    );
}

export function saveChunks(fileId: number, chunks: ChunkRecord[]): void {
  const conn = getDb();
  const tx = conn.transaction(() => {
    conn.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
    const insert = conn.prepare(
      'INSERT INTO chunks(file_id, chunk_index, page_start, page_end, content) VALUES (?, ?, ?, ?, ?)',
    );
    for (const c of chunks) {
      insert.run(fileId, c.chunk_index, c.page_start, c.page_end, c.content);
    }
  });
  tx();
}

export function getChunks(fileId: number): ChunkRecord[] {
  const rows = getDb()
    .prepare('SELECT chunk_index, page_start, page_end, content FROM chunks WHERE file_id = ? ORDER BY chunk_index')
    .all(fileId) as ChunkRecord[];
  return rows;
}

export function markFileMissing(path: string): void {
  getDb()
    .prepare(
      `UPDATE files SET status = 'missing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE path = ?`,
    )
    .run(path);
}

/** A moved/renamed file keeps its row: only the locator changes. */
export function relocateFile(oldPath: string, newPath: string, filename: string): void {
  getDb()
    .prepare(
      `UPDATE files SET path = ?, filename = ?, title = ?, status = CASE WHEN status = 'missing' THEN 'ready' ELSE status END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE path = ?`,
    )
    .run(newPath, filename, titleFromFilename(filename), oldPath);
}

export function listPendingFileIds(limit = 500): number[] {
  const rows = getDb()
    .prepare("SELECT id FROM files WHERE status IN ('pending','processing') ORDER BY id LIMIT ?")
    .all(limit) as { id: number }[];
  return rows.map((r) => r.id);
}

export function listFilePathsUnderFolder(folderPath: string): string[] {
  // Paths are stored normalized with '/' separators; prefix match on the folder.
  const rows = getDb()
    .prepare("SELECT path FROM files WHERE path LIKE ? || '/%' AND status != 'missing'")
    .all(folderPath) as { path: string }[];
  return rows.map((r) => r.path);
}

export function deleteFileRow(id: number): void {
  getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getStats(): Stats {
  const conn = getDb();

  const counts = conn
    .prepare(
      `SELECT
         COUNT(*) AS files,
         SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) AS pending,
         COALESCE(SUM(char_count), 0) AS totalChars
       FROM files WHERE status != 'missing'`,
    )
    .get() as { files: number; ready: number | null; failed: number | null; pending: number | null; totalChars: number };

  const folders = (conn.prepare('SELECT COUNT(*) AS n FROM folders').get() as { n: number }).n;

  const categories = conn
    .prepare(
      `SELECT category AS name, COUNT(*) AS count FROM files
       WHERE category IS NOT NULL AND status != 'missing'
       GROUP BY category ORDER BY count DESC, name LIMIT 40`,
    )
    .all() as { name: string; count: number }[];

  const kinds = conn
    .prepare(
      `SELECT kind AS name, COUNT(*) AS count FROM files
       WHERE kind IS NOT NULL AND status != 'missing'
       GROUP BY kind ORDER BY count DESC`,
    )
    .all() as { name: string; count: number }[];

  const recentRows = conn
    .prepare(
      `SELECT * FROM files WHERE status != 'missing' ORDER BY COALESCE(indexed_at, updated_at) DESC LIMIT 12`,
    )
    .all() as FileRow[];

  return {
    files: counts.files ?? 0,
    ready: counts.ready ?? 0,
    failed: counts.failed ?? 0,
    pending: counts.pending ?? 0,
    folders,
    totalChars: counts.totalChars ?? 0,
    categories,
    kinds,
    recent: recentRows.map(mapFileRow),
  };
}

/** Existing AI category names, used as consistency hints for the analyzer. */
export function listExistingCategories(limit = 60): string[] {
  const rows = getDb()
    .prepare(
      `SELECT category, COUNT(*) AS n FROM files
       WHERE category IS NOT NULL AND status != 'missing'
       GROUP BY category ORDER BY n DESC LIMIT ?`,
    )
    .all(limit) as { category: string }[];
  return rows.map((r) => r.category);
}

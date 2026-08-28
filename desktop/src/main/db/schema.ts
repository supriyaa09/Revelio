/**
 * SQLite schema for Revelio Desktop.
 *
 * One database file in the OS user-data directory, WAL mode. The design follows
 * the non-custodial principle: this store holds only *derived* data (extracted
 * text, metadata, the search index). The user's files are referenced by path and
 * content hash, never copied.
 *
 * The full-text index is a single FTS5 table over four weighted columns —
 * title, filename, keywords, body — kept in sync with the `files` table by
 * AFTER triggers, so a write to `files` is always searchable without a second
 * explicit indexing step.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  path             TEXT NOT NULL UNIQUE,
  label            TEXT,
  watch            INTEGER NOT NULL DEFAULT 1,
  ai_enabled       INTEGER NOT NULL DEFAULT 1,
  exclude_patterns TEXT NOT NULL DEFAULT '[]',
  last_indexed_at  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id       INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  path            TEXT NOT NULL UNIQUE,
  filename        TEXT NOT NULL,
  extension       TEXT,
  kind            TEXT,
  size            INTEGER,
  mtime           TEXT,
  ctime           TEXT,
  content_hash    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  error           TEXT,
  method          TEXT,
  page_count      INTEGER,
  char_count      INTEGER,
  title           TEXT,
  body            TEXT,
  summary         TEXT,
  keywords        TEXT,
  entities        TEXT,
  important_dates TEXT,
  category        TEXT,
  doc_date        TEXT,
  ai_model        TEXT,
  ai_status       TEXT NOT NULL DEFAULT 'none',
  ai_error        TEXT,
  indexed_at      TEXT,
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_folder   ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_status   ON files(status);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_kind     ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_mtime    ON files(mtime);
CREATE INDEX IF NOT EXISTS idx_files_hash     ON files(content_hash);

CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_start  INTEGER,
  page_end    INTEGER,
  content     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);

-- Single FTS index with weighted columns. External-content over files: the
-- rowid here IS files.id, so a match joins straight back with no subquery.
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  title, filename, keywords, body,
  content='files', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Keep files_fts in sync with files. These make search "free": any write to
-- files is reflected in the index within the same transaction.
CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, title, filename, keywords, body)
  VALUES (new.id, new.title, new.filename, new.keywords, new.body);
END;

CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, title, filename, keywords, body)
  VALUES ('delete', old.id, old.title, old.filename, old.keywords, old.body);
END;

CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF title, filename, keywords, body ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, title, filename, keywords, body)
  VALUES ('delete', old.id, old.title, old.filename, old.keywords, old.body);
  INSERT INTO files_fts(rowid, title, filename, keywords, body)
  VALUES (new.id, new.title, new.filename, new.keywords, new.body);
END;
`;

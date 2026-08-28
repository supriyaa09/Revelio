/**
 * Shared IPC contract for Revelio Desktop.
 *
 * This module is the single source of truth for everything that crosses the
 * main ↔ renderer boundary. The main process implements it, the preload bridge
 * exposes it, and the renderer consumes it — all three import these types, so a
 * change to the contract is a compile error everywhere it matters.
 *
 * Keep this file dependency-free: it is imported from all three bundles.
 */

// ── Enumerations ─────────────────────────────────────────────────────────────

/** File families the indexer knows how to extract text from. */
export type FileKind = 'pdf' | 'docx' | 'txt' | 'md' | 'image' | 'other';

/** Lifecycle of one file in the index. */
export type FileStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'missing';

/** Outcome of the (optional) AI enrichment pass. */
export type AiStatus = 'none' | 'pending' | 'ok' | 'skipped' | 'failed';

/** How the text layer was obtained. */
export type ExtractionMethod = 'text' | 'ocr' | 'mixed';

/** AI provider selection, mirrored from the web pipeline. */
export type AiProviderName = 'anthropic' | 'agentrouter';

// ── Records ──────────────────────────────────────────────────────────────────

export interface EntityRef {
  name: string;
  type: string;
}

export interface ImportantDate {
  label: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  is_deadline: boolean;
}

/** A connected root folder the user has asked the app to index. */
export interface FolderRecord {
  id: number;
  path: string;
  label: string | null;
  watch: boolean;
  ai_enabled: boolean;
  exclude_patterns: string[];
  last_indexed_at: string | null;
  created_at: string;
  /** Aggregates computed at read time, not stored. */
  file_count: number;
  ready_count: number;
  failed_count: number;
}

/** One indexed file. Derived data only — the file itself never moves. */
export interface FileRecord {
  id: number;
  folder_id: number | null;
  path: string;
  filename: string;
  extension: string | null;
  kind: FileKind | null;
  size: number | null;
  mtime: string | null;
  ctime: string | null;
  content_hash: string | null;
  status: FileStatus;
  error: string | null;
  method: ExtractionMethod | null;
  page_count: number | null;
  char_count: number | null;
  title: string | null;
  summary: string | null;
  keywords: string[];
  entities: EntityRef[];
  important_dates: ImportantDate[];
  category: string | null;
  doc_date: string | null;
  ai_model: string | null;
  ai_status: AiStatus;
  ai_error: string | null;
  indexed_at: string | null;
  updated_at: string | null;
}

export interface ChunkRecord {
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
}

/** A file plus its retrieval chunks, for the details view. */
export interface FileDetails extends FileRecord {
  chunks: ChunkRecord[];
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Structured filters extracted from a natural-language query. */
export interface SearchFilters {
  kind: FileKind | null;
  /** Raw extension override, e.g. `type:docx` → 'docx'. */
  extension: string | null;
  category: string | null;
  folderId: number | null;
  /** Substring/prefix match against the stored path (`in:` filter). */
  pathPrefix: string | null;
  /** ISO YYYY-MM-DD, inclusive. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Keyword/tag matches (`#tag` or `tag:x`). */
  tags: string[];
}

/** The parser's full understanding of a query. */
export interface ParsedQuery {
  raw: string;
  /** Free text for full-text search. */
  text: string;
  /** A quoted exact phrase, if one was given. */
  phrase: string | null;
  /** Individual terms split out of `text`. */
  terms: string[];
  filters: SearchFilters;
}

export interface SearchHit {
  file: FileRecord;
  /** Body snippet with \u0001/\u0002 marking matched spans. */
  snippet: string | null;
  /** Lower is better (bm25 + boosts). */
  score: number;
}

export interface FacetCount {
  name: string;
  count: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  tookMs: number;
  parsed: ParsedQuery;
  facets: {
    categories: FacetCount[];
    kinds: FacetCount[];
  };
}

// ── Indexing / progress ──────────────────────────────────────────────────────

export interface IndexProgress {
  active: boolean;
  queued: number;
  done: number;
  failed: number;
  total: number;
  /** Filename currently being processed, if any. */
  current: string | null;
}

// ── Dashboard stats ──────────────────────────────────────────────────────────

export interface Stats {
  files: number;
  ready: number;
  failed: number;
  pending: number;
  folders: number;
  totalChars: number;
  categories: FacetCount[];
  kinds: FacetCount[];
  recent: FileRecord[];
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  aiEnabled: boolean;
  ocrEnabled: boolean;
  provider: AiProviderName;
  /** Empty string means "fall back to environment variables". */
  apiKey: string;
  /** Empty string means "provider default model". */
  model: string;
  maxFileSizeMB: number;
  excludePatterns: string[];
}

// ── Events pushed from main → renderer ───────────────────────────────────────

export type MainEvent =
  | { type: 'index:progress'; progress: IndexProgress }
  | { type: 'index:finished' }
  | { type: 'files:changed' };

// ── The API surface exposed on window.api ────────────────────────────────────

export interface RevelioApi {
  // Folders
  listFolders(): Promise<FolderRecord[]>;
  addFolder(path: string): Promise<FolderRecord>;
  removeFolder(id: number): Promise<void>;
  reindexFolder(id: number): Promise<void>;
  setFolderWatch(id: number, watch: boolean): Promise<void>;
  setFolderAi(id: number, ai: boolean): Promise<void>;
  pickFolder(): Promise<string | null>;

  // Files
  getFile(id: number): Promise<FileDetails | null>;
  openFile(id: number): Promise<string | null>;
  revealFile(id: number): Promise<void>;
  reanalyzeFile(id: number): Promise<FileRecord | null>;
  retryFile(id: number): Promise<void>;

  // Search + stats
  search(raw: string): Promise<SearchResponse>;
  getStats(): Promise<Stats>;

  // Settings
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  // Events
  onEvent(cb: (event: MainEvent) => void): () => void;
}

/**
 * SQLite FTS5 query engine.
 *
 * The desktop counterpart of the web app's PostgreSQL FTS query builder. Same
 * ranking specification as `architecture.md`: fixed field weights
 * title > filename > keywords > body, plus a recency boost and an exact-phrase
 * boost applied after the query.
 *
 * `bm25()` returns more-negative values for better matches, so boosts are
 * subtracted and results sort ascending.
 */

import { getDb, mapFileRow, type FileRow } from '../db/db.ts';
import { parseSearchQuery } from './parse.ts';
import { normalizePath } from '../indexing/walk.ts';
import type { FacetCount, ParsedQuery, SearchHit, SearchResponse } from '@shared/types';

/** Field weights for bm25: title, filename, keywords, body. */
const BM25_WEIGHTS = '10.0, 5.0, 4.0, 1.0';

const PHRASE_IN_NAME_BOOST = 8;
const PHRASE_IN_BODY_BOOST = 4;
const RECENCY_BOOST = 0.15;
const RECENCY_DAYS = 90;

/** Wraps a term in FTS5 double quotes so reserved words and symbols are safe. */
function ftsQuote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Builds the MATCH expression: every term as a prefix query OR'd together,
 * plus the exact phrase if one was given. OR keeps recall high for natural
 * queries ("machine learning notes" should not demand all three words); bm25
 * pushes the best matches to the top.
 */
export function buildFtsMatch(parsed: ParsedQuery): string | null {
  const parts: string[] = [];
  for (const term of parsed.terms) {
    parts.push(`${ftsQuote(term)}*`);
  }
  if (parsed.phrase) {
    parts.push(ftsQuote(parsed.phrase));
  }
  return parts.length > 0 ? parts.join(' OR ') : null;
}

interface ResultRow extends FileRow {
  score: number | null;
  snip: string | null;
  /** Selected via `f.*` but not part of the mapped record. */
  body: string | null;
}

export function search(raw: string, limit = 50): SearchResponse {
  const started = performance.now();
  const parsed = parseSearchQuery(raw);
  const conn = getDb();

  // ── Filter clauses (applied to the files row, alias f) ────────────────────
  const clauses: string[] = ["f.status != 'missing'"];
  const params: (string | number)[] = [];
  const f = parsed.filters;

  if (f.kind) {
    clauses.push('f.kind = ?');
    params.push(f.kind);
  }
  if (f.extension) {
    clauses.push('f.extension = ?');
    params.push(f.extension);
  }
  if (f.category) {
    clauses.push('f.category = ? COLLATE NOCASE');
    params.push(f.category);
  }
  if (f.folderId) {
    clauses.push('f.folder_id = ?');
    params.push(f.folderId);
  }
  if (f.pathPrefix) {
    clauses.push("f.path LIKE '%' || ? || '%'");
    params.push(normalizePath(f.pathPrefix));
  }
  if (f.dateFrom) {
    clauses.push('date(f.mtime) >= date(?)');
    params.push(f.dateFrom);
  }
  if (f.dateTo) {
    clauses.push('date(f.mtime) <= date(?)');
    params.push(f.dateTo);
  }
  for (const tag of f.tags) {
    // keywords is a JSON array string; match the quoted element.
    clauses.push("f.keywords LIKE '%\"' || ? || '\"%'");
    params.push(tag.replace(/"/g, ''));
  }

  const where = clauses.join(' AND ');
  const match = buildFtsMatch(parsed);

  let hits: SearchHit[] = [];

  if (match) {
    const sql = `
      SELECT f.*, bm25(files_fts, ${BM25_WEIGHTS}) AS score,
             snippet(files_fts, 3, char(1), char(2), '…', 16) AS snip
      FROM files_fts
      JOIN files f ON f.id = files_fts.rowid
      WHERE files_fts MATCH ? AND ${where}
      ORDER BY score
      LIMIT ?`;

    let rows: ResultRow[] = [];
    try {
      rows = conn.prepare(sql).all(match, ...params, limit * 3) as ResultRow[];
    } catch (error) {
      // A pathological MATCH expression should degrade, not error out.
      console.error('[search] FTS query failed, falling back to LIKE:', error);
    }

    if (rows.length === 0) {
      // Lexical fallback keeps partial-recall behaviour honest when FTS
      // matches nothing (e.g. every term stopped out).
      const text = [parsed.phrase, parsed.text].filter(Boolean).join(' ').trim();
      if (text) {
        const likeSql = `
          SELECT f.*, NULL AS score, NULL AS snip
          FROM files f
          WHERE (f.title LIKE '%' || ? || '%' OR f.filename LIKE '%' || ? || '%' OR f.body LIKE '%' || ? || '%')
            AND ${where}
          ORDER BY f.mtime DESC
          LIMIT ?`;
        rows = conn.prepare(likeSql).all(text, text, text, ...params, limit * 3) as ResultRow[];
      }
    }

    const phraseLower = parsed.phrase?.toLowerCase() ?? null;
    const recencyCutoff = Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000;

    hits = rows.map((row) => {
      const file = mapFileRow(row);
      let score = row.score ?? 0;

      if (phraseLower) {
        const inName =
          (file.title ?? '').toLowerCase().includes(phraseLower) ||
          file.filename.toLowerCase().includes(phraseLower);
        const inBody = typeof row.body === 'string' && row.body.toLowerCase().includes(phraseLower);
        if (inName) score -= PHRASE_IN_NAME_BOOST;
        else if (inBody) score -= PHRASE_IN_BODY_BOOST;
      }

      if (file.mtime && Date.parse(file.mtime) >= recencyCutoff) {
        score -= RECENCY_BOOST;
      }

      return { file, snippet: row.snip ?? null, score };
    });

    hits.sort((a, b) => a.score - b.score);
    hits = hits.slice(0, limit);
  } else {
    // No free text: pure filter browsing (e.g. just `type:pdf`).
    const sql = `
      SELECT f.*, NULL AS score, NULL AS snip
      FROM files f
      WHERE ${where}
      ORDER BY f.mtime DESC
      LIMIT ?`;
    const rows = conn.prepare(sql).all(...params, limit) as ResultRow[];
    hits = rows.map((row) => ({ file: mapFileRow(row), snippet: null, score: 0 }));
  }

  // ── Facets over the whole library ─────────────────────────────────────────
  const categories = conn
    .prepare(
      `SELECT category AS name, COUNT(*) AS count FROM files
       WHERE category IS NOT NULL AND status != 'missing'
       GROUP BY category ORDER BY count DESC, name LIMIT 24`,
    )
    .all() as FacetCount[];

  const kinds = conn
    .prepare(
      `SELECT kind AS name, COUNT(*) AS count FROM files
       WHERE kind IS NOT NULL AND status != 'missing'
       GROUP BY kind ORDER BY count DESC`,
    )
    .all() as FacetCount[];

  return {
    hits,
    total: hits.length,
    tookMs: Math.max(1, Math.round(performance.now() - started)),
    parsed,
    facets: { categories, kinds },
  };
}

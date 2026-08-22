/**
 * Search query builder for Supabase.
 *
 * Executes a three-phase search: full-text search on `document_search` →
 * profile lookup → filtered documents query.  All queries go through the
 * user-scoped client, so RLS (`document_is_visible`) is enforced automatically.
 *
 * @module
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedSearch } from './parse';
import type { DocumentListItem } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchFilters extends ParsedSearch {
  /** Explicit category ID from dropdown (overrides any parsed category). */
  categoryId: string | null;
}

export interface SearchResult {
  docs: DocumentListItem[];
  error: string | null;
  /** Number of FTS matches (null when FTS was not used). */
  ftsHits: number | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * The SELECT clause matching the join pattern used by workspace and the
 * existing search page.  Kept in one place to avoid drift.
 */
const DOCUMENT_SELECT = [
  'id', 'title', 'description', 'owner_id', 'department_id', 'category_id',
  'category_source', 'category_confidence', 'workflow_status',
  'current_version_id', 'document_type', 'document_date', 'tags',
  'user_metadata', 'system_metadata', 'created_at', 'updated_at',
  'category:categories!documents_category_id_fkey (id, name, slug)',
  'department:departments!documents_department_id_fkey (id, name, slug)',
  'owner:profiles!documents_owner_id_fkey (id, full_name)',
  'current_version:document_versions!documents_current_version_fk (id, version_number, processing_status, original_filename, file_size, mime_type)',
].join(', ');

/** Escape special characters for LIKE / ILIKE patterns. */
function escapePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

// ── Query execution ──────────────────────────────────────────────────────────

/**
 * Executes a search against the Supabase database.
 *
 * **Phase 1** — If `text` is non-empty, query `document_search` with
 * PostgreSQL full-text search (`websearch_to_tsquery`) to get matching
 * document IDs.  The search vector already includes title (A), document type /
 * tags / category (B), AI summary (C) and extracted text (D).
 *
 * **Phase 2** — If `uploaderName` is set, query `profiles` with `ilike` on
 * `full_name` to resolve matching user IDs.  No matching profiles → empty
 * result immediately.
 *
 * **Phase 3** — Query `documents` with all filters applied, ordered by
 * recency, limited to 50.
 */
export async function executeSearch(
  supabase: SupabaseClient,
  filters: SearchFilters,
): Promise<SearchResult> {

  // ── Phase 1: Full-text search ───────────────────────────────────────────

  let ftsDocIds: string[] | null = null;
  let ftsHits: number | null = null;

  if (filters.text) {
    try {
      const { data, error } = await supabase
        .from('document_search')
        .select('document_id')
        .textSearch('search_vector', filters.text, {
          type: 'websearch',
          config: 'english',
        })
        .limit(200);

      if (!error && data && data.length > 0) {
        ftsDocIds = data.map((r) => r.document_id as string);
        ftsHits = ftsDocIds.length;
      }
    } catch {
      // FTS failed (table missing, bad query syntax, etc.) — fall through to
      // the ilike fallback in Phase 3.
    }
  }

  // ── Phase 2: Profile lookup ─────────────────────────────────────────────

  let ownerIds: string[] | null = null;

  if (filters.uploaderName) {
    const pattern = `%${escapePattern(filters.uploaderName)}%`;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id')
      .ilike('full_name', pattern)
      .limit(50);

    if (profiles && profiles.length > 0) {
      ownerIds = profiles.map((p) => p.id as string);
    } else {
      // No matching uploaders → no documents can match
      return { docs: [], error: null, ftsHits: 0 };
    }
  }

  // ── Phase 3: Documents query ────────────────────────────────────────────

  let query = supabase.from('documents').select(DOCUMENT_SELECT).limit(50);

  // Text filter: prefer FTS results, fall back to title/description ilike
  if (filters.text) {
    if (ftsDocIds && ftsDocIds.length > 0) {
      query = query.in('id', ftsDocIds);
    } else {
      const pattern = `%${escapePattern(filters.text)}%`;
      query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
    }
  }

  // Status filter
  if (filters.status) {
    query = query.eq('workflow_status', filters.status);
  }

  // Uploader filter
  if (ownerIds) {
    query = query.in('owner_id', ownerIds);
  }

  // Category filter (explicit dropdown)
  if (filters.categoryId) {
    query = query.eq('category_id', filters.categoryId);
  }

  // Document type filter
  if (filters.documentType) {
    const pattern = `%${escapePattern(filters.documentType)}%`;
    query = query.ilike('document_type', pattern);
  }

  // Tags filter (array containment — all listed tags must be present)
  if (filters.tags.length > 0) {
    query = query.contains('tags', filters.tags);
  }

  // Date range filter (on created_at)
  if (filters.dateFrom) {
    query = query.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters.dateTo) {
    query = query.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  return {
    docs: (data ?? []) as unknown as DocumentListItem[],
    error: error?.message ?? null,
    ftsHits,
  };
}

import Link from 'next/link';
import { Search as SearchIcon, FileText, Calendar, Tag, User } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { StatusBadge } from '@/components/badges';
import { EmptyState, formatDate, formatBytes } from '@/components/ui';
import { WORKFLOW_LABELS } from '@/lib/constants';
import type { WorkflowState } from '@/lib/types';
import { parseSearchQuery, describeFilters } from '@/lib/search/parse';
import { executeSearch, type SearchFilters } from '@/lib/search/query';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cat?: string }>;
}) {
  const { q = '', status = '', cat = '' } = await searchParams;
  await requireSession();
  const supabase = await createClient();

  // Load categories for dropdown
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, department_id')
    .eq('is_active', true)
    .order('sort_order');

  // ── Parse the search query ────────────────────────────────────────────
  const trimmed = q.trim();
  const parsed = parseSearchQuery(trimmed);

  // Explicit dropdown filters override parsed values
  const filters: SearchFilters = {
    ...parsed,
    status: (status as WorkflowState) || parsed.status,
    categoryId: cat || null,
  };

  const hasFilters = Boolean(
    trimmed || filters.status || filters.categoryId || filters.uploaderName ||
    filters.documentType || filters.tags.length || filters.dateFrom || filters.dateTo,
  );

  // ── Execute search ────────────────────────────────────────────────────
  let docs = filters.status || filters.categoryId || filters.uploaderName ||
    filters.documentType || filters.tags.length || filters.dateFrom ||
    filters.dateTo || filters.text
    ? (await executeSearch(supabase, filters))
    : { docs: [], error: null as string | null, ftsHits: null as number | null };

  // Build filter chips from parsed query
  const chips = describeFilters(parsed, WORKFLOW_LABELS);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-sm text-slate-500">
        Search with natural language. Try{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">approved documents</code>,{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">by Sohail</code>, or{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">after:2026-08-01 #budget</code>.
      </p>

      {/* ── Search form ─────────────────────────────────────────────────── */}
      <form className="card mt-5 space-y-3 p-4" method="get">
        <div className="flex gap-3">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              id="q"
              name="q"
              defaultValue={q}
              className="input pl-9"
              placeholder="Search documents…"
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary">
            <SearchIcon className="size-4" />
            Search
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          <select name="status" defaultValue={status} className="input w-auto text-sm" aria-label="Status">
            <option value="">Any status</option>
            {Object.entries(WORKFLOW_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select name="cat" defaultValue={cat} className="input w-auto text-sm" aria-label="Category">
            <option value="">Any folder</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </form>

      {/* ── Active filter chips ──────────────────────────────────────────── */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Detected:</span>
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200"
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <div className="mt-5">
        {docs.error ? (
          <div className="card p-6 text-sm text-red-700">Search failed: {docs.error}</div>
        ) : !hasFilters ? (
          <EmptyState
            icon={SearchIcon}
            title="Search your documents"
            description="Enter a term, filter by status or folder, or use smart syntax like status:approved, by Name, after:2026-01-01, #tag."
          />
        ) : docs.docs.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="No matches"
            description="Try a different term, or clear the filters."
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-500">
              {docs.docs.length} {docs.docs.length === 1 ? 'result' : 'results'}
              {docs.ftsHits !== null && docs.ftsHits !== docs.docs.length &&
                ` (${docs.ftsHits} content ${docs.ftsHits === 1 ? 'match' : 'matches'})`}
            </p>

            <ul className="space-y-3">
              {docs.docs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={`/documents/${doc.id}`}
                    className="card block p-4 transition hover:border-brand-300 hover:shadow"
                  >
                    {/* Row 1: Title + Status */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{doc.title}</span>
                      <StatusBadge state={doc.workflow_status} />
                    </div>

                    {/* Row 2: Description */}
                    {doc.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                        {doc.description}
                      </p>
                    )}

                    {/* Row 3: Metadata */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {doc.owner && (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3" />
                          {doc.owner.full_name}
                        </span>
                      )}
                      {doc.category && (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="size-3" />
                          {doc.category.name}
                        </span>
                      )}
                      {doc.document_type && (
                        <span className="capitalize">{doc.document_type}</span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDate(doc.updated_at)}
                      </span>
                      {doc.current_version && (
                        <span>
                          {doc.current_version.original_filename}
                          {doc.current_version.file_size > 0 &&
                            ` · ${formatBytes(doc.current_version.file_size)}`}
                        </span>
                      )}
                    </div>

                    {/* Row 4: Tags */}
                    {doc.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {doc.tags.slice(0, 8).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                          >
                            <Tag className="size-2.5" />
                            {tag}
                          </span>
                        ))}
                        {doc.tags.length > 8 && (
                          <span className="text-xs text-slate-400">
                            +{doc.tags.length - 8} more
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

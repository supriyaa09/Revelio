import Link from 'next/link';
import { Calendar, FileText, Search as SearchIcon, SlidersHorizontal, Sparkles, Tag, User } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { StatusBadge } from '@/components/badges';
import { EmptyState, ErrorNote, PageHeader, formatBytes, formatDate, stagger } from '@/components/ui';
import { WORKFLOW_LABELS } from '@/lib/constants';
import type { WorkflowState } from '@/lib/types';
import { parseSearchQuery, describeFilters } from '@/lib/search/parse';
import { executeSearch, type SearchFilters } from '@/lib/search/query';

const EXAMPLES = ['approved documents', 'by Sohail', 'after:2026-08-01 #budget'];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cat?: string }>;
}) {
  const { q = '', status = '', cat = '' } = await searchParams;
  const supabase = await createClient();

  const trimmed = q.trim();
  const parsed = parseSearchQuery(trimmed);

  const filters: SearchFilters = {
    ...parsed,
    status: (status as WorkflowState) || parsed.status,
    categoryId: cat || null,
  };

  const hasFilters = Boolean(
    trimmed || filters.status || filters.categoryId || filters.uploaderName ||
    filters.documentType || filters.tags.length || filters.dateFrom || filters.dateTo,
  );

  const willSearch = Boolean(
    filters.status || filters.categoryId || filters.uploaderName ||
    filters.documentType || filters.tags.length || filters.dateFrom ||
    filters.dateTo || filters.text,
  );

  const [, { data: categories }, docs] = await Promise.all([
    requireSession(),
    supabase
      .from('categories')
      .select('id, name, department_id')
      .eq('is_active', true)
      .order('sort_order'),
    willSearch
      ? executeSearch(supabase, filters)
      : Promise.resolve({ docs: [], error: null as string | null, ftsHits: null as number | null }),
  ]);

  const chips = describeFilters(parsed, WORKFLOW_LABELS);

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <PageHeader
        eyebrow="FULL-TEXT & METADATA"
        title="Search Repository"
        description="Search with natural language. Status, author, date ranges, and hashtags are automatically parsed."
      />

      {/* ── Search form ─────────────────────────────────────────────────── */}
      <form className="glass-card animate-rise overflow-hidden shadow-e2" method="get">
        <div className="flex items-center gap-3 px-4.5">
          <SearchIcon className="size-5 shrink-0 text-accent-ink" />
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="h-14 w-full bg-transparent text-[1rem] font-medium text-ink
                       placeholder:text-faint focus-visible:outline-none"
            placeholder="Search documents by text, tag, status, or author…"
            autoFocus
          />
          <button type="submit" className="btn-primary my-2 shrink-0 px-5 shadow-xs">
            Search
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/70 px-4.5 py-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-faint">
            <SlidersHorizontal className="size-3.5 shrink-0" />
            Filters:
          </div>
          <select
            name="status"
            defaultValue={status}
            className="input w-auto py-1.5 text-xs font-medium"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {Object.entries(WORKFLOW_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            name="cat"
            defaultValue={cat}
            className="input w-auto py-1.5 text-xs font-medium"
            aria-label="Category"
          >
            <option value="">Any folder</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {hasFilters && (
            <Link href="/search" className="ml-auto text-xs font-semibold text-accent-ink transition-colors hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      {/* ── Try-these examples ──────────────────────────────────────────── */}
      {!hasFilters && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-1 text-xs font-semibold text-faint">
            <Sparkles className="size-3 text-accent" />
            Try searching:
          </span>
          {EXAMPLES.map((ex, i) => (
            <Link
              key={ex}
              href={`/search?q=${encodeURIComponent(ex)}`}
              style={stagger(i)}
              className="fade-in chip border border-line bg-surface font-mono text-[11px] text-ink-2
                         transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-line
                         hover:bg-accent-soft hover:text-accent-ink shadow-xs"
            >
              {ex}
            </Link>
          ))}
        </div>
      )}

      {/* ── Active filter chips ──────────────────────────────────────────── */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-faint">Detected terms:</span>
          {chips.map((chip, i) => (
            <span
              key={chip.key}
              style={stagger(i)}
              className="chip fade-in bg-accent-soft font-semibold text-accent-ink ring-1 ring-inset ring-accent-line shadow-xs"
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <div>
        {docs.error ? (
          <ErrorNote>Search failed: {docs.error}</ErrorNote>
        ) : !hasFilters ? (
          <EmptyState
            icon={SearchIcon}
            title="Search your documents"
            description="Enter any keyword, filter by status or folder, or use smart syntax like status:approved, by Name, after:2026-01-01, #budget."
          />
        ) : docs.docs.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="No matching documents found"
            description="Try a different search query or clear the active status and category filters."
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted">
                Found <span className="font-bold tabular-nums text-ink">{docs.docs.length}</span>{' '}
                {docs.docs.length === 1 ? 'document' : 'documents'}
                {docs.ftsHits !== null && docs.ftsHits !== docs.docs.length &&
                  ` (${docs.ftsHits} full-text ${docs.ftsHits === 1 ? 'hit' : 'hits'})`}
              </p>
            </div>

            <ul className="card divide-y divide-line overflow-hidden shadow-e1">
              {docs.docs.map((doc, i) => (
                <li key={doc.id} className="rise-in" style={stagger(i)}>
                  <Link
                    href={`/documents/${doc.id}`}
                    className="group block px-4.5 py-4 transition-colors duration-200 hover:bg-surface-2/70"
                  >
                    {/* Row 1: Title + Status */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink transition-colors group-hover:text-accent-ink">
                        {doc.title}
                      </span>
                      <StatusBadge state={doc.workflow_status} />
                    </div>

                    {/* Row 2: Description */}
                    {doc.description && (
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-2">
                        {doc.description}
                      </p>
                    )}

                    {/* Row 3: Metadata */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {doc.owner && (
                        <span className="inline-flex items-center gap-1 font-medium text-ink-2">
                          <User className="size-3 text-faint" />
                          {doc.owner.full_name}
                        </span>
                      )}
                      {doc.category && (
                        <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-line">
                          <FileText className="size-3 text-accent" />
                          {doc.category.name}
                        </span>
                      )}
                      {doc.document_type && <span className="capitalize font-medium">{doc.document_type}</span>}
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3 text-faint" />
                        {formatDate(doc.updated_at)}
                      </span>
                      {doc.current_version && (
                        <span className="truncate font-mono text-[11px] text-faint">
                          {doc.current_version.original_filename}
                          {doc.current_version.file_size > 0 &&
                            ` · ${formatBytes(doc.current_version.file_size)}`}
                        </span>
                      )}
                    </div>

                    {/* Row 4: Tags */}
                    {doc.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {doc.tags.slice(0, 8).map((tag) => (
                          <span
                            key={tag}
                            className="chip gap-1 bg-surface-2 text-[11px] text-muted ring-1 ring-line
                                       transition-colors group-hover:bg-accent-soft group-hover:text-accent-ink group-hover:ring-accent-line"
                          >
                            <Tag className="size-2.5" />
                            {tag}
                          </span>
                        ))}
                        {doc.tags.length > 8 && (
                          <span className="chip text-[11px] text-faint">
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

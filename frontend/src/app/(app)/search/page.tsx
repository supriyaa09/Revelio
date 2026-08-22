import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { StatusBadge } from '@/components/badges';
import { EmptyState, formatDate } from '@/components/ui';
import type { DocumentListItem } from '@/lib/types';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cat?: string }>;
}) {
  const { q = '', status = '', cat = '' } = await searchParams;
  await requireSession();
  const supabase = await createClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, department_id')
    .eq('is_active', true)
    .order('sort_order');

  const trimmed = q.trim();
  let docs: DocumentListItem[] = [];
  let searchError: string | null = null;

  if (trimmed || status || cat) {
    let query = supabase
      .from('documents')
      .select(
        `id, title, description, owner_id, department_id, category_id, category_source,
         category_confidence, workflow_status, current_version_id, document_type,
         document_date, tags, user_metadata, system_metadata, created_at, updated_at,
         category:categories!documents_category_id_fkey (id, name, slug),
         department:departments!documents_department_id_fkey (id, name, slug),
         owner:profiles!documents_owner_id_fkey (id, full_name),
         current_version:document_versions!documents_current_version_fk
           (id, version_number, processing_status, original_filename, file_size, mime_type)`,
      )
      .limit(50);

    if (trimmed) {
      // Title/description match. Full-text search across extracted document text
      // becomes available once the extraction phase populates document_search.
      const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
      query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
    }
    if (status) query = query.eq('workflow_status', status);
    if (cat) query = query.eq('category_id', cat);

    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) searchError = error.message;
    docs = (data ?? []) as unknown as DocumentListItem[];
  }

  const hasQuery = Boolean(trimmed || status || cat);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-sm text-slate-500">
        Searches titles, descriptions and metadata. Content search over extracted text arrives with
        the extraction phase.
      </p>

      <form className="card mt-5 flex flex-wrap gap-3 p-4" method="get">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="input"
            placeholder="Search documents…"
          />
        </div>

        <select name="status" defaultValue={status} className="input w-auto" aria-label="Status">
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="faculty_review">Faculty review</option>
          <option value="hod_review">HOD review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="changes_requested">Changes requested</option>
        </select>

        <select name="cat" defaultValue={cat} className="input w-auto" aria-label="Category">
          <option value="">Any folder</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button type="submit" className="btn-primary">
          <SearchIcon className="size-4" />
          Search
        </button>
      </form>

      <div className="mt-5">
        {searchError ? (
          <div className="card p-6 text-sm text-red-700">Search failed: {searchError}</div>
        ) : !hasQuery ? (
          <EmptyState
            icon={SearchIcon}
            title="Search your documents"
            description="Enter a term, or filter by status and folder."
          />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="No matches"
            description="Try a different term, or clear the filters."
          />
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-500">
              {docs.length} {docs.length === 1 ? 'result' : 'results'}
            </p>
            <ul className="space-y-2">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={`/documents/${doc.id}`}
                    className="card block p-4 transition hover:border-brand-300 hover:shadow"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{doc.title}</span>
                      <StatusBadge state={doc.workflow_status} />
                    </div>
                    {doc.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{doc.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      {doc.category && <span>{doc.category.name}</span>}
                      <span>{doc.owner?.full_name}</span>
                      <span>{formatDate(doc.updated_at)}</span>
                    </div>
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

import Link from 'next/link';
import { FileText, FolderTree, Upload } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ProcessingBadge, StatusBadge } from '@/components/badges';
import { EmptyState, formatBytes, formatDate } from '@/components/ui';
import type { DocumentListItem } from '@/lib/types';

/** Document workspace: the automatically organized folder tree plus documents. */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; cat?: string }>;
}) {
  const { dept, cat } = await searchParams;
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: departments, error: deptError }, { data: categories, error: catError }] =
    await Promise.all([
      supabase.from('departments').select('id, name, slug, sort_order').order('sort_order'),
      supabase
        .from('categories')
        .select('id, department_id, name, slug, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
    ]);

  // Surface taxonomy failures. Previously these errors were discarded, so a
  // missing GRANT rendered as an empty folder tree indistinguishable from an
  // unseeded database — which hid the real cause of the upload failure.
  const taxonomyError = deptError ?? catError;
  if (taxonomyError) {
    console.error(
      `[workspace] taxonomy load failed: sqlstate=${taxonomyError.code ?? 'n/a'} ` +
        `message=${JSON.stringify(taxonomyError.message)}`,
    );
  }

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
    .order('updated_at', { ascending: false })
    .limit(50);

  if (cat) query = query.eq('category_id', cat);
  else if (dept) query = query.eq('department_id', dept);

  const { data: documents, error } = await query;

  const docs = (documents ?? []) as unknown as DocumentListItem[];
  const activeLabel =
    categories?.find((c) => c.id === cat)?.name ??
    departments?.find((d) => d.id === dept)?.name ??
    'All documents';

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
          <p className="mt-1 text-sm text-slate-500">
            Documents are filed automatically from their content and metadata.
          </p>
        </div>
        <Link href="/upload" className="btn-primary">
          <Upload className="size-4" />
          Upload document
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Folder tree — the controlled two-level taxonomy. */}
        <nav aria-label="Folders" className="card h-fit p-3">
          <Link
            href="/workspace"
            className={`block rounded-lg px-3 py-2 text-sm font-medium ${
              !dept && !cat ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            All documents
          </Link>

          {(departments ?? []).map((d) => (
            <div key={d.id} className="mt-2">
              <Link
                href={`/workspace?dept=${d.id}`}
                className={`block rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                  dept === d.id && !cat
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {d.name}
              </Link>
              <div className="mt-0.5 space-y-0.5 pl-2">
                {(categories ?? [])
                  .filter((c) => c.department_id === d.id)
                  .map((c) => (
                    <Link
                      key={c.id}
                      href={`/workspace?cat=${c.id}`}
                      className={`block rounded-lg px-3 py-1.5 text-sm ${
                        cat === c.id
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {c.name}
                    </Link>
                  ))}
              </div>
            </div>
          ))}

          {!departments?.length && (
            <p className="px-3 py-2 text-xs text-slate-500">
              {taxonomyError ? (
                <span className="text-red-700">
                  Could not load folders: {taxonomyError.message}
                </span>
              ) : (
                'No categories yet. Run supabase/seed/seed.sql to create the taxonomy.'
              )}
            </p>
          )}
        </nav>

        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="font-medium">{activeLabel}</h2>
            <span className="text-sm text-slate-500">
              {docs.length} {docs.length === 1 ? 'document' : 'documents'}
            </span>
          </div>

          {error ? (
            <div className="card p-6 text-sm text-red-700">
              Could not load documents: {error.message}
            </div>
          ) : docs.length === 0 ? (
            <EmptyState
              icon={FolderTree}
              title="Nothing here yet"
              description={
                dept || cat
                  ? 'No documents have been filed into this folder.'
                  : 'Upload your first document and it will be organized automatically.'
              }
              action={
                <Link href="/upload" className="btn-primary">
                  <Upload className="size-4" />
                  Upload document
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={`/documents/${doc.id}`}
                    className="card flex items-start gap-4 p-4 transition hover:border-brand-300 hover:shadow"
                  >
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                      <FileText className="size-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{doc.title}</span>
                        <StatusBadge state={doc.workflow_status} />
                        {doc.current_version && (
                          <ProcessingBadge state={doc.current_version.processing_status} />
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        {doc.department && <span>{doc.department.name}</span>}
                        {doc.category && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{doc.category.name}</span>
                          </>
                        )}
                        {doc.category_source === 'system' && doc.category_confidence != null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                            auto-filed · {Math.round(doc.category_confidence * 100)}%
                          </span>
                        )}
                        <span aria-hidden>·</span>
                        <span>{doc.owner?.full_name ?? 'Unknown'}</span>
                        <span aria-hidden>·</span>
                        <span>{formatDate(doc.updated_at)}</span>
                        {doc.current_version && (
                          <>
                            <span aria-hidden>·</span>
                            <span>v{doc.current_version.version_number}</span>
                            <span aria-hidden>·</span>
                            <span>{formatBytes(doc.current_version.file_size)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-slate-400">
            Signed in as {profile.full_name || 'user'} · you only see documents you own or are
            authorized to review.
          </p>
        </section>
      </div>
    </div>
  );
}

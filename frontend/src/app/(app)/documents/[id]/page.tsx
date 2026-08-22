import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download, FileText, History, MessageSquare, ShieldCheck } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SIGNED_URL_TTL, STORAGE_BUCKET, canReview } from '@/lib/constants';
import { ProcessingBadge, StatusBadge } from '@/components/badges';
import { formatBytes, formatDateTime } from '@/components/ui';
import { WorkflowActions } from '@/components/workflow-actions';
import { CommentForm } from '@/components/comment-form';
import { ProcessingStatus } from '@/components/processing-status';
import type { AuditEntry, DocumentInsights, DocumentVersion, ReviewEntry } from '@/lib/types';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await requireSession();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from('documents')
    .select(
      `id, title, description, owner_id, workflow_status, current_version_id,
       category_source, category_confidence, document_type, document_date, tags,
       system_metadata, created_at, updated_at,
       category:categories!documents_category_id_fkey (id, name),
       department:departments!documents_department_id_fkey (id, name),
       owner:profiles!documents_owner_id_fkey (id, full_name)`,
    )
    .eq('id', id)
    .maybeSingle();

  // RLS makes an unauthorized document indistinguishable from a missing one,
  // which is what we want — existence is not leaked.
  if (!doc) notFound();

  const [{ data: versions }, { data: comments }, { data: reviews }, { data: audit }, { data: insights }] =
    await Promise.all([
      supabase
        .from('document_versions')
        .select(
          `id, document_id, version_number, storage_path, original_filename, mime_type,
           file_size, uploaded_by, change_note, processing_status, processing_stage,
           processing_error, extraction_method, page_count, char_count, created_at, processed_at,
           uploader:profiles!document_versions_uploaded_by_fkey (id, full_name)`,
        )
        .eq('document_id', id)
        .order('version_number', { ascending: false }),
      supabase
        .from('document_comments')
        .select(`id, body, created_at, author:profiles!document_comments_author_id_fkey (id, full_name)`)
        .eq('document_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('document_reviews')
        .select(
          `id, document_id, reviewer_id, action, from_state, to_state, comment, created_at,
           reviewer:profiles!document_reviews_reviewer_id_fkey (id, full_name)`,
        )
        .eq('document_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_logs')
        .select(
          `id, actor_id, document_id, action, from_state, to_state, metadata, created_at,
           actor:profiles!audit_logs_actor_id_fkey (id, full_name)`,
        )
        .eq('document_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      // Insights belong to a VERSION, not a document. Querying by document_id
      // and taking the newest row would show v1's analysis as if it described
      // the current v2 — i.e. AI output attributed to content it never saw.
      doc.current_version_id
        ? supabase
            .from('document_insights')
            .select(
              'id, document_id, document_version_id, summary, key_points, entities, important_dates, model, generated_at',
            )
            .eq('document_version_id', doc.current_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const allVersions = (versions ?? []) as unknown as (DocumentVersion & {
    uploader: { id: string; full_name: string } | null;
  })[];
  const current = allVersions.find((v) => v.id === doc.current_version_id) ?? allVersions[0];

  // Short-lived signed URL — the bucket is private and never serves public URLs.
  let fileUrl: string | null = null;
  if (current) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(current.storage_path, SIGNED_URL_TTL);
    fileUrl = signed?.signedUrl ?? null;
  }

  const isOwner = doc.owner_id === profile.id;
  const classification = (doc.system_metadata as Record<string, any>)?.classification;
  const insight = (insights ?? null) as DocumentInsights | null;

  // Mirrors document_is_visible() in the database, which 0008 made the single
  // predicate behind can_process_version(). Written out rather than hardcoded to
  // `true`: reaching this line already implies visibility (RLS returned the row
  // using the same rule), but stating the rule keeps the client honest if the
  // policy ever changes, and keeps the button from promising something the
  // database would then refuse.
  const canProcess = isOwner || (canReview(profile.role) && doc.workflow_status !== 'draft');

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/workspace"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        Workspace
      </Link>

      {/* Header */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
            <StatusBadge state={doc.workflow_status} />
            {current && <ProcessingBadge state={current.processing_status} />}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {(doc.department as any)?.name && (doc.category as any)?.name
              ? `${(doc.department as any).name} / ${(doc.category as any).name}`
              : 'Unfiled'}{' '}
            · {(doc.owner as any)?.full_name ?? 'Unknown'} · updated {formatDateTime(doc.updated_at)}
          </p>
        </div>

        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noreferrer" className="btn-secondary">
            <Download className="size-4" />
            Download
          </a>
        )}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          {/* Metadata */}
          <section className="card p-5">
            <h2 className="font-medium">Metadata</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Document type" value={doc.document_type} />
              <Field label="Document date" value={doc.document_date} />
              <Field
                label="Folder"
                value={
                  (doc.category as any)?.name
                    ? `${(doc.department as any)?.name} / ${(doc.category as any).name}`
                    : null
                }
                badge={
                  doc.category_source === 'system'
                    ? 'System'
                    : doc.category_source === 'user'
                      ? 'User'
                      : 'AI'
                }
              />
              <Field label="Tags" value={doc.tags?.length ? doc.tags.join(', ') : null} />
              <Field label="Created" value={formatDateTime(doc.created_at)} />
              <Field label="Description" value={doc.description} />
            </dl>

            {classification?.method === 'keyword' && (
              <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <strong>Auto-filed</strong> by keyword match on{' '}
                {classification.basis === 'title_and_filename'
                  ? 'title and filename'
                  : 'document text'}
                {classification.matched_terms?.length
                  ? `: ${classification.matched_terms.join(', ')}`
                  : ''}
                {doc.category_confidence != null &&
                  ` · confidence ${Math.round(doc.category_confidence * 100)}%`}
              </p>
            )}
          </section>

          {/* Document intelligence — only real, persisted output is shown. */}
          <section className="card p-5">
            <h2 className="font-medium">Document intelligence</h2>

            {current?.processing_status === 'completed' ? (
              <>
                <p className="mt-2 text-xs text-slate-500">
                  {current.char_count.toLocaleString()} characters extracted
                  {current.page_count ? ` from ${current.page_count} page(s)` : ''}
                  {current.extraction_method
                    ? ` · method: ${
                        current.extraction_method === 'text'
                          ? 'direct text layer'
                          : current.extraction_method === 'ocr'
                            ? 'OCR'
                            : 'mixed (text + OCR)'
                      }`
                    : ''}
                </p>

                {current.char_count === 0 && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No readable text was found in this file, even after OCR. The document is stored
                    and searchable by title and metadata.
                  </p>
                )}

                {insight ? (
                  <div className="mt-4 space-y-4">
                    {insight.summary && (
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Summary
                          <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium normal-case text-violet-700">
                            AI
                          </span>
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-slate-700">
                          {insight.summary}
                        </p>
                      </div>
                    )}

                    {insight.key_points.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Key points
                        </h3>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                          {insight.key_points.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {insight.important_dates.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Important dates
                        </h3>
                        <ul className="mt-1 space-y-1 text-sm">
                          {insight.important_dates.map((d, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className="font-mono text-xs text-slate-500">{d.date}</span>
                              <span className="text-slate-700">{d.label}</span>
                              {d.is_deadline && (
                                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                                  deadline
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {insight.entities.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Entities
                        </h3>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {insight.entities.map((e, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                              title={e.type}
                            >
                              {e.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {insight.model && (
                      <p className="text-[11px] text-slate-400">
                        Generated by {insight.model} on {formatDateTime(insight.generated_at)}. AI
                        output is a suggestion and does not replace your own metadata.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    Text was extracted, but no AI analysis is stored for this version. This happens
                    when no <code className="text-xs">ANTHROPIC_API_KEY</code> is configured, or the
                    provider call failed. Nothing is shown in place of it.
                  </p>
                )}
              </>
            ) : current?.processing_status === 'failed' ? (
              <p className="mt-2 text-sm text-red-700">
                Processing failed: {current.processing_error ?? 'unknown error'}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                This version has not been processed yet. Use the Processing panel to extract text and
                analyze it.
              </p>
            )}
          </section>

          {/* Preview */}
          {fileUrl && current?.mime_type === 'application/pdf' && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-slate-200 px-5 py-3 font-medium">Preview</h2>
              <iframe src={fileUrl} title="Document preview" className="h-[600px] w-full" />
            </section>
          )}
          {fileUrl && current?.mime_type.startsWith('image/') && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-slate-200 px-5 py-3 font-medium">Preview</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl} alt={doc.title} className="max-h-[600px] w-full object-contain" />
            </section>
          )}

          {/* Comments */}
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-medium">
              <MessageSquare className="size-4 text-slate-400" />
              Comments
            </h2>
            <ul className="mt-3 space-y-3">
              {(comments ?? []).length === 0 && (
                <li className="text-sm text-slate-500">No comments yet.</li>
              )}
              {(comments ?? []).map((c: any) => (
                <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.author?.full_name ?? 'Unknown'}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(c.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <CommentForm documentId={doc.id} />
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {current && (
            <ProcessingStatus
              documentId={doc.id}
              versionId={current.id}
              initialStatus={current.processing_status}
              initialStage={current.processing_stage}
              initialError={current.processing_error}
              canProcess={canProcess}
            />
          )}

          <WorkflowActions
            documentId={doc.id}
            status={doc.workflow_status}
            isOwner={isOwner}
            role={profile.role}
            hasVersion={Boolean(doc.current_version_id)}
          />

          {/* Version history */}
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-medium">
              <History className="size-4 text-slate-400" />
              Versions
            </h2>
            <ol className="mt-3 space-y-3">
              {allVersions.map((v) => (
                <li key={v.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">v{v.version_number}</span>
                    {v.id === doc.current_version_id && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                        current
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    <div className="truncate">{v.original_filename}</div>
                    <div>
                      {formatBytes(v.file_size)} · {v.uploader?.full_name ?? 'Unknown'} ·{' '}
                      {formatDateTime(v.created_at)}
                    </div>
                    {v.change_note && <div className="mt-0.5 italic">“{v.change_note}”</div>}
                  </div>
                </li>
              ))}
              {allVersions.length === 0 && <li className="text-sm text-slate-500">No versions.</li>}
            </ol>
          </section>

          {/* Review decisions */}
          {(reviews ?? []).length > 0 && (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-slate-400" />
                Review history
              </h2>
              <ol className="mt-3 space-y-3">
                {((reviews ?? []) as unknown as (ReviewEntry & {
                  reviewer: { full_name: string } | null;
                })[]).map((r) => (
                  <li key={r.id} className="text-sm">
                    <div className="font-medium">{r.action.replace(/_/g, ' ')}</div>
                    <div className="text-xs text-slate-500">
                      {r.reviewer?.full_name ?? 'Unknown'} · {formatDateTime(r.created_at)}
                    </div>
                    {r.comment && (
                      <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                        {r.comment}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Audit trail — real rows, written by the database */}
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-medium">
              <FileText className="size-4 text-slate-400" />
              Audit history
            </h2>
            <ol className="mt-3 space-y-2">
              {((audit ?? []) as unknown as AuditEntry[]).map((a) => (
                <li key={a.id} className="text-xs">
                  <span className="font-medium text-slate-700">{a.action.replace(/_/g, ' ')}</span>
                  {a.from_state && a.to_state && (
                    <span className="text-slate-500">
                      {' '}
                      · {a.from_state} → {a.to_state}
                    </span>
                  )}
                  <div className="text-slate-500">
                    {(a as any).actor?.full_name ?? 'System'} · {formatDateTime(a.created_at)}
                  </div>
                </li>
              ))}
              {(audit ?? []).length === 0 && (
                <li className="text-sm text-slate-500">No audit events.</li>
              )}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  badge,
}: {
  label: string;
  value: string | null | undefined;
  badge?: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {badge && value && (
          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium normal-case text-slate-600">
            {badge}
          </span>
        )}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">
        {value || <span className="text-slate-400">Not set</span>}
      </dd>
    </div>
  );
}

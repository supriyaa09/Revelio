import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarClock,
  Download,
  FileText,
  History,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tags,
} from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SIGNED_URL_TTL, STORAGE_BUCKET, canReview } from '@/lib/constants';
import { ProcessingBadge, StatusBadge } from '@/components/badges';
import { Field, formatBytes, formatDateTime, stagger } from '@/components/ui';
import { WorkflowActions } from '@/components/workflow-actions';
import { CommentForm } from '@/components/comment-form';
import { ProcessingStatus } from '@/components/processing-status';
import { DocumentIntelligenceInteractive } from '@/components/document-intelligence-interactive';
import type { AuditEntry, DocumentInsights, DocumentVersion, ReviewEntry } from '@/lib/types';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ profile }, { data: doc }, { data: versions }, { data: comments }, { data: reviews }, { data: audit }] =
    await Promise.all([
      requireSession(),
      supabase
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
        .maybeSingle(),
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
    ]);

  if (!doc) notFound();

  const allVersions = (versions ?? []) as unknown as (DocumentVersion & {
    uploader: { id: string; full_name: string } | null;
  })[];
  const current = allVersions.find((v) => v.id === doc.current_version_id) ?? allVersions[0] ?? null;

  const [{ data: insights }, signedUrl] = await Promise.all([
    doc.current_version_id
      ? supabase
          .from('document_insights')
          .select(
            'id, document_id, document_version_id, summary, key_points, entities, important_dates, model, generated_at',
          )
          .eq('document_version_id', doc.current_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    current
      ? supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(current.storage_path, SIGNED_URL_TTL)
          .then(({ data }) => data?.signedUrl ?? null)
      : Promise.resolve(null),
  ]);

  const fileUrl: string | null = signedUrl;

  const isOwner = doc.owner_id === profile.id;
  const classification = (doc.system_metadata as Record<string, any>)?.classification;
  const insight = (insights ?? null) as DocumentInsights | null;

  const canProcess = isOwner || (canReview(profile.role) && doc.workflow_status !== 'draft');

  const folder =
    (doc.category as any)?.name && (doc.department as any)?.name
      ? `${(doc.department as any).name} / ${(doc.category as any).name}`
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <Link
        href="/workspace"
        className="group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted
                   transition-colors hover:text-ink"
      >
        <ArrowLeft
          className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1"
        />
        Back to Workspace
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 animate-rise">
          <div className="mb-2 flex items-center gap-2">
            <span className="chip bg-accent-soft text-xs font-bold text-accent-ink ring-1 ring-accent-line">
              {folder ?? 'Unfiled'}
            </span>
            <span className="text-xs text-faint">·</span>
            <span className="text-xs text-muted">Uploaded by {(doc.owner as any)?.full_name ?? 'Unknown'}</span>
          </div>
          <h1 className="display text-[2rem] font-bold leading-tight text-ink sm:text-[2.35rem]">
            {doc.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <StatusBadge state={doc.workflow_status} />
            {current && <ProcessingBadge state={current.processing_status} />}
            <span className="font-mono text-xs text-faint">
              Updated {formatDateTime(doc.updated_at)}
            </span>
          </div>
        </div>

        {fileUrl && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary group shrink-0 animate-rise shadow-e1 [animation-delay:80ms]"
          >
            <Download className="size-4 transition-transform duration-300 group-hover:translate-y-0.5" />
            Download Source
          </a>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* ── Metadata ──────────────────────────────────────────────────── */}
          <Panel icon={Tags} title="Document Metadata">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Document type" value={doc.document_type} />
              <Field label="Document date" value={doc.document_date} />
              <Field
                label="Folder"
                value={folder}
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
              <div className="mt-5 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-xs leading-relaxed text-ink-2 shadow-xs">
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  <Sparkles className="size-3.5 text-accent" />
                  Auto-filed by content taxonomy match:
                </div>
                <p className="mt-1 text-muted">
                  Matched based on{' '}
                  <strong className="text-ink">
                    {classification.basis === 'title_and_filename'
                      ? 'title & filename patterns'
                      : 'extracted text layers'}
                  </strong>
                  {classification.matched_terms?.length ? (
                    <>
                      {' '}with tokens:{' '}
                      {classification.matched_terms.map((t: string) => (
                        <span
                          key={t}
                          className="mr-1 inline-block rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px]
                                     text-accent-ink ring-1 ring-accent-line/50 shadow-2xs"
                        >
                          {t}
                        </span>
                      ))}
                    </>
                  ) : null}
                  {doc.category_confidence != null &&
                    ` · Confidence: ${Math.round(doc.category_confidence * 100)}%`}
                </p>
              </div>
            )}
          </Panel>

          {/* ── Document intelligence ───────────────────────────────────────── */}
          <Panel icon={Sparkles} title="AI Document Intelligence">
            <DocumentIntelligenceInteractive current={current} insight={insight} />
          </Panel>

          {/* ── Preview ───────────────────────────────────────────────────── */}
          {fileUrl && current?.mime_type === 'application/pdf' && (
            <section className="glass-card animate-rise overflow-hidden shadow-e2">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5 bg-surface-2/40">
                <h2 className="font-semibold text-ink">Document PDF Preview</h2>
                <span className="chip font-mono text-xs text-faint">Inline Viewer</span>
              </div>
              <iframe src={fileUrl} title="Document preview" className="h-[620px] w-full border-none" />
            </section>
          )}
          {fileUrl && current?.mime_type.startsWith('image/') && (
            <section className="glass-card animate-rise overflow-hidden shadow-e2">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5 bg-surface-2/40">
                <h2 className="font-semibold text-ink">Image Preview</h2>
                <span className="chip font-mono text-xs text-faint">Original Source</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fileUrl}
                alt={doc.title}
                className="max-h-[600px] w-full bg-surface-2/80 object-contain p-4"
              />
            </section>
          )}

          {/* ── Comments ──────────────────────────────────────────────────── */}
          <Panel icon={MessageSquare} title="Review Comments & Discussion" count={(comments ?? []).length}>
            <ul className="space-y-3.5">
              {(comments ?? []).length === 0 && (
                <li className="text-sm text-faint">No discussion notes on this document yet.</li>
              )}
              {(comments ?? []).map((c: any, i: number) => (
                <li key={c.id} className="rise-in flex gap-3" style={stagger(i)}>
                  <span
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl
                               bg-surface-2 font-mono text-xs font-bold text-accent-ink ring-1 ring-line shadow-xs"
                  >
                    {initials(c.author?.full_name)}
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-line bg-surface-2/70 px-4 py-3 shadow-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {c.author?.full_name ?? 'Unknown'}
                      </span>
                      <span className="font-mono text-[11px] text-faint">
                        {formatDateTime(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
                      {c.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 pt-3 border-t border-line">
              <CommentForm documentId={doc.id} />
            </div>
          </Panel>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
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
          <Panel icon={History} title="Version History" count={allVersions.length}>
            <ol className="space-y-3.5">
              {allVersions.map((v) => (
                <li key={v.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-ink">
                      v{v.version_number}
                    </span>
                    {v.id === doc.current_version_id && (
                      <span className="chip bg-ok-soft font-semibold text-[10px] text-ok ring-1 ring-ok-line">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs leading-relaxed text-muted">
                    <div className="truncate font-mono font-medium text-ink-2">{v.original_filename}</div>
                    <div>
                      {formatBytes(v.file_size)} · {v.uploader?.full_name ?? 'Unknown'} ·{' '}
                      {formatDateTime(v.created_at)}
                    </div>
                    {v.change_note && (
                      <div className="mt-1 rounded-md border-l-2 border-accent bg-surface-2 px-2 py-1 italic text-ink-2">
                        {v.change_note}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          {/* Review decisions */}
          {(reviews ?? []).length > 0 && (
            <Panel icon={ShieldCheck} title="Review Audit Log">
              <ol className="space-y-3.5">
                {((reviews ?? []) as unknown as (ReviewEntry & {
                  reviewer: { full_name: string } | null;
                })[]).map((r) => (
                  <li key={r.id} className="text-sm">
                    <div className="font-semibold capitalize text-ink">
                      {r.action.replace(/_/g, ' ')}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.reviewer?.full_name ?? 'Unknown'} · {formatDateTime(r.created_at)}
                    </div>
                    {r.comment && (
                      <p className="mt-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
                        {r.comment}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {/* Audit trail */}
          <Panel icon={ScrollText} title="Security & Event Trail">
            <ol className="relative space-y-3.5 border-l border-line pl-4">
              {((audit ?? []) as unknown as AuditEntry[]).map((a) => (
                <li key={a.id} className="relative text-xs">
                  <span
                    aria-hidden
                    className="absolute -left-[1.3125rem] top-1.5 size-2 rounded-full
                               bg-accent ring-2 ring-surface shadow-xs"
                  />
                  <span className="font-semibold capitalize text-ink">
                    {a.action.replace(/_/g, ' ')}
                  </span>
                  {a.from_state && a.to_state && (
                    <span className="text-muted font-mono text-[11px]">
                      {' '}
                      · {a.from_state} → {a.to_state}
                    </span>
                  )}
                  <div className="mt-0.5 text-muted">
                    {(a as any).actor?.full_name ?? 'System'} ·{' '}
                    <span className="font-mono text-[10px]">{formatDateTime(a.created_at)}</span>
                  </div>
                </li>
              ))}
              {(audit ?? []).length === 0 && <li className="text-sm text-faint">No audit events recorded.</li>}
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card animate-rise p-5 sm:p-6 shadow-e1">
      <h2 className="mb-4 flex items-center justify-between font-semibold text-ink">
        <span className="flex items-center gap-2.5">
          <Icon className="size-4 text-accent-ink" />
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="chip bg-surface-2 font-mono text-xs font-bold tabular-nums text-muted ring-1 ring-line">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center text-[10px] font-bold uppercase tracking-wider text-faint">
      {children}
    </h3>
  );
}

function initials(name: string | undefined): string {
  if (!name) return '?';
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  );
}

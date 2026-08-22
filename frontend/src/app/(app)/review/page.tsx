import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { canReview, decisionStatesForRole, REVIEW_QUEUE_STATES } from '@/lib/constants';
import { StatusBadge } from '@/components/badges';
import { EmptyState, formatDateTime } from '@/components/ui';
import type { DocumentListItem } from '@/lib/types';

/**
 * Faculty / HOD queue, partitioned by decision authority.
 *
 * Faculty act on `submitted` and `faculty_review`; escalated documents are
 * shown read-only so they can still be tracked. HOD additionally act on
 * `hod_review`, which is surfaced first.
 */
export default async function ReviewPage() {
  const { profile } = await requireSession();

  // Server-side gate. RLS would return nothing for a student anyway, but a
  // clean redirect beats an empty page.
  if (!canReview(profile.role)) redirect('/workspace');

  const supabase = await createClient();

  const { data, error } = await supabase
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
    .in('workflow_status', REVIEW_QUEUE_STATES)
    .order('updated_at', { ascending: true }) // oldest first: a real queue
    .limit(100);

  const docs = (data ?? []) as unknown as DocumentListItem[];
  const decidable = decisionStatesForRole(profile.role);

  const isHod = profile.role === 'hod';
  const notMine = (d: DocumentListItem) => d.owner_id !== profile.id;

  // Escalated work first for the HOD, since that is what only they can clear.
  const escalated = docs.filter((d) => d.workflow_status === 'hod_review' && notMine(d));
  const facultyTier = docs.filter(
    (d) =>
      (d.workflow_status === 'submitted' || d.workflow_status === 'faculty_review') && notMine(d),
  );
  const ownDocs = docs.filter((d) => d.owner_id === profile.id);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
      <p className="mt-1 text-sm text-slate-500">
        Oldest first. You cannot decide on your own submissions, whatever your role.
      </p>

      {error ? (
        <div className="card mt-6 p-6 text-sm text-red-700">
          Could not load queue: {error.message}
        </div>
      ) : docs.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Inbox}
            title="Queue is clear"
            description="Nothing is waiting for review right now."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {isHod ? (
            <>
              <QueueList
                title="Escalated to you"
                hint="Only the HOD can decide on these."
                docs={escalated}
              />
              <QueueList
                title="Faculty tier"
                hint="You may also act on these directly."
                docs={facultyTier}
              />
            </>
          ) : (
            <>
              <QueueList title="Awaiting your decision" docs={facultyTier} />
              <QueueList
                title="Escalated to HOD"
                hint="Read-only. Awaiting the HOD's decision."
                docs={escalated}
                muted
              />
            </>
          )}

          {ownDocs.length > 0 && (
            <QueueList
              title="Your own submissions"
              hint={
                isHod
                  ? 'Visible for tracking. A faculty member must decide on these.'
                  : 'Visible for tracking. Another reviewer, or the HOD, must decide on these.'
              }
              docs={ownDocs}
              muted
            />
          )}

          {decidable.length === 0 && (
            <p className="text-xs text-slate-400">
              Your role has no decision authority in this queue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function QueueList({
  title,
  hint,
  docs,
  muted = false,
}: {
  title: string;
  hint?: string;
  docs: DocumentListItem[];
  muted?: boolean;
}) {
  if (docs.length === 0) {
    return (
      <section>
        <h2 className="mb-2 font-medium">{title}</h2>
        <p className="card px-4 py-6 text-sm text-slate-500">Nothing here.</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="font-medium">
        {title} <span className="text-sm font-normal text-slate-500">({docs.length})</span>
      </h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}

      <ul className="mt-2 space-y-2">
        {docs.map((doc) => (
          <li key={doc.id}>
            <Link
              href={`/documents/${doc.id}`}
              className={`card flex items-center justify-between gap-4 p-4 transition hover:border-brand-300 hover:shadow ${
                muted ? 'opacity-70' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{doc.title}</span>
                  <StatusBadge state={doc.workflow_status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span>{doc.owner?.full_name ?? 'Unknown'}</span>
                  {doc.category && (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {doc.department?.name} / {doc.category.name}
                      </span>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  <span>Updated {formatDateTime(doc.updated_at)}</span>
                </div>
              </div>
              <span className="shrink-0 text-sm font-medium text-brand-600">Open →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

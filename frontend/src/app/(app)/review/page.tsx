import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Inbox, ShieldAlert, Sparkles } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { canReview, decisionStatesForRole, REVIEW_QUEUE_STATES } from '@/lib/constants';
import { StatusBadge } from '@/components/badges';
import { EmptyState, ErrorNote, PageHeader, formatRelative, stagger } from '@/components/ui';
import type { DocumentListItem } from '@/lib/types';

/**
 * Faculty / HOD queue, partitioned by decision authority.
 */
export default async function ReviewPage() {
  const supabase = await createClient();

  const [{ profile }, { data, error }] = await Promise.all([
    requireSession(),
    supabase
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
      .order('updated_at', { ascending: true }) // oldest first
      .limit(100),
  ]);

  if (!canReview(profile.role)) redirect('/workspace');

  const docs = (data ?? []) as unknown as DocumentListItem[];
  const decidable = decisionStatesForRole(profile.role);

  const isHod = profile.role === 'hod';
  const notMine = (d: DocumentListItem) => d.owner_id !== profile.id;

  const escalated = docs.filter((d) => d.workflow_status === 'hod_review' && notMine(d));
  const facultyTier = docs.filter(
    (d) =>
      (d.workflow_status === 'submitted' || d.workflow_status === 'faculty_review') && notMine(d),
  );
  const ownDocs = docs.filter((d) => d.owner_id === profile.id);

  const actionable = (isHod ? escalated.length + facultyTier.length : facultyTier.length);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow={actionable > 0 ? `${actionable} AWAITING YOUR DECISION` : 'QUEUE ALL CLEAR'}
        title="Review & Approval Queue"
        description="Chronological triage queue. Governance rules enforce separation of concerns across review tiers."
      />

      {error ? (
        <ErrorNote>Could not load queue: {error.message}</ErrorNote>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Review Queue is clear"
          description="There are no pending documents awaiting institutional decision right now."
        />
      ) : (
        <div className="space-y-8">
          {isHod ? (
            <>
              <QueueList
                title="Escalated to HOD"
                hint="Requires Head of Department final institutional sign-off."
                docs={escalated}
                tone="tier2"
                icon={ShieldAlert}
              />
              <QueueList
                title="Faculty Tier"
                hint="Faculty review tier. As HOD, you can also resolve these directly."
                docs={facultyTier}
                icon={Clock}
              />
            </>
          ) : (
            <>
              <QueueList
                title="Awaiting Your Decision"
                hint="Assigned for faculty evaluation and audit sign-off."
                docs={facultyTier}
                icon={Clock}
              />
              <QueueList
                title="Escalated to HOD"
                hint="Awaiting Head of Department executive sign-off."
                docs={escalated}
                muted
                icon={AlertCircle}
              />
            </>
          )}

          {ownDocs.length > 0 && (
            <QueueList
              title="Your Submissions in Queue"
              hint={
                isHod
                  ? 'Tracked here. Another faculty reviewer must decide on your submissions.'
                  : 'Tracked here. Assigned reviewers or HOD will decide on these.'
              }
              docs={ownDocs}
              muted
              icon={Inbox}
            />
          )}

          {decidable.length === 0 && (
            <p className="text-xs text-faint">Your current role does not have approval authority in this queue.</p>
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
  tone,
  icon: Icon,
}: {
  title: string;
  hint?: string;
  docs: DocumentListItem[];
  muted?: boolean;
  tone?: 'tier2';
  icon?: React.ElementType;
}) {
  return (
    <section className="animate-rise">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className={`grid size-7 place-items-center rounded-lg ${tone === 'tier2' ? 'bg-tier2-soft text-tier2' : 'bg-surface-2 text-muted'}`}>
              <Icon className="size-4" />
            </div>
          )}
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {docs.length > 0 && (
            <span
              className={`chip font-mono text-xs font-bold tabular-nums ${
                tone === 'tier2'
                  ? 'bg-tier2-soft text-tier2 ring-1 ring-inset ring-tier2-line shadow-xs'
                  : 'bg-surface-2 text-muted ring-1 ring-line'
              }`}
            >
              {docs.length}
            </span>
          )}
        </div>
        {muted && (
          <span className="chip bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-faint">
            Read-only tracking
          </span>
        )}
      </div>
      {hint && <p className="mb-3 text-xs text-muted leading-relaxed">{hint}</p>}

      {docs.length === 0 ? (
        <div className="card p-5 text-center text-sm text-faint border-dashed">
          No items in this triage deck.
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden shadow-e1">
          {docs.map((doc, i) => (
            <li key={doc.id} className="rise-in" style={stagger(i)}>
              <Link
                href={`/documents/${doc.id}`}
                className="group flex items-center justify-between gap-4 px-4.5 py-4
                           transition-all duration-200 hover:bg-surface-2/80"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`truncate font-semibold transition-colors group-hover:text-accent-ink ${muted ? 'text-ink-2' : 'text-ink'}`}
                    >
                      {doc.title}
                    </span>
                    <StatusBadge state={doc.workflow_status} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 text-xs text-muted">
                    <span className="font-medium text-ink-2">{doc.owner?.full_name ?? 'Unknown'}</span>
                    {doc.category && (
                      <>
                        <span aria-hidden className="size-1 rounded-full bg-line-2" />
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-line">
                          {doc.department?.name} / {doc.category.name}
                        </span>
                      </>
                    )}
                    <span aria-hidden className="size-1 rounded-full bg-line-2" />
                    <span>Submitted {formatRelative(doc.updated_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-accent-ink
                               shadow-xs transition-all duration-200 group-hover:border-accent-line group-hover:bg-accent-soft group-hover:translate-x-0.5"
                  >
                    Open Review
                    <ArrowRight
                      className="size-3.5 transition-transform duration-300
                                 group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

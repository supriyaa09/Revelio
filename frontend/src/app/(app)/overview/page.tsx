import Link from 'next/link';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FileStack,
  FolderTree,
  HardDrive,
  Inbox,
  ScanLine,
  Search,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CountUp, Greeting, KpiCard } from '@/components/metrics';
import { ProcessingBadge, StatusBadge } from '@/components/badges';
import { EmptyState, HeaderFact, formatBytes, formatRelative, stagger } from '@/components/ui';
import { REVIEW_QUEUE_STATES, canReview } from '@/lib/constants';
import { fileExtension } from '@/lib/explorer';
import type { DocumentListItem, ProcessingState } from '@/lib/types';

/** Ceiling on the scalar scans behind storage and pipeline counts. */
const SCAN_LIMIT = 2000;

/** Documents on the recent strip. Six fits without becoming a second list. */
const RECENT_LIMIT = 6;

/**
 * The overview.
 *
 * Every figure on this page is counted from the caller's own rows — RLS scopes
 * each query, so a student's "total documents" is their total and a HOD's is the
 * department's. Nothing here is illustrative, which is the point: a dashboard
 * that invents its numbers teaches the reader to distrust the ones that matter.
 */
export default async function OverviewPage() {
  const supabase = await createClient();

  const [
    { profile },
    total,
    pending,
    approved,
    drafts,
    insights,
    { data: versionRows },
    { data: recentRows },
  ] = await Promise.all([
    requireSession(),
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .in('workflow_status', REVIEW_QUEUE_STATES),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('workflow_status', 'approved'),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('workflow_status', 'draft'),
    supabase.from('document_insights').select('id', { count: 'exact', head: true }),
    // One scan serves storage, the upload count, and the extraction count —
    // three head-counts would be three round trips for the same rows.
    supabase.from('document_versions').select('file_size, processing_status').limit(SCAN_LIMIT),
    supabase
      .from('documents')
      .select(
        `id, title, workflow_status, category_source, category_confidence, updated_at,
         category:categories!documents_category_id_fkey (id, name, slug),
         department:departments!documents_department_id_fkey (id, name, slug),
         owner:profiles!documents_owner_id_fkey (id, full_name),
         current_version:document_versions!documents_current_version_fk
           (id, version_number, processing_status, original_filename, file_size, mime_type)`,
      )
      .order('updated_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ]);

  const versions = (versionRows ?? []) as { file_size: number; processing_status: ProcessingState }[];
  const storageBytes = versions.reduce((sum, v) => sum + (v.file_size ?? 0), 0);
  const extracted = versions.filter((v) => v.processing_status === 'completed').length;
  const inFlight = versions.filter(
    (v) => v.processing_status === 'pending' || v.processing_status === 'processing',
  ).length;

  const totalDocs = total.count ?? 0;
  const pendingDocs = pending.count ?? 0;
  const approvedDocs = approved.count ?? 0;
  const draftDocs = drafts.count ?? 0;
  const analyzed = insights.count ?? 0;

  const recent = (recentRows ?? []) as unknown as DocumentListItem[];
  const firstName = (profile.full_name || 'there').split(' ')[0] ?? 'there';
  const reviewer = canReview(profile.role);

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <span className="record-label flex items-center gap-1.5 text-accent-ink">
            <Sparkles className="size-3" />
            Reveal. Organize. Intelligently.
          </span>
          <h1 className="display mt-2.5 text-[1.75rem] leading-tight text-ink sm:text-4xl">
            <Greeting name={firstName} />
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Here is what is happening with your documents today.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/workspace" className="btn-secondary">
            <FolderTree className="size-4" />
            Workspace
          </Link>
          <Link href="/upload" className="btn-primary">
            <Upload className="size-4" />
            Upload document
          </Link>
        </div>
      </header>

      {/* ── Headline figures ─────────────────────────────────────────────── */}
      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          index={0}
          label="Total documents"
          value={totalDocs}
          icon={FileStack}
          tone="accent"
          href="/workspace"
          detail={draftDocs > 0 ? `${draftDocs} still in draft` : 'All submitted'}
        />
        <KpiCard
          index={1}
          label="Pending review"
          value={pendingDocs}
          icon={Clock3}
          tone="warn"
          href={reviewer ? '/review' : '/workspace'}
          detail={pendingDocs === 0 ? 'Queue is clear' : 'Awaiting a decision'}
        />
        <KpiCard
          index={2}
          label="Approved"
          value={approvedDocs}
          icon={CheckCircle2}
          tone="ok"
          detail={
            totalDocs > 0
              ? `${Math.round((approvedDocs / totalDocs) * 100)}% of the corpus`
              : 'Nothing approved yet'
          }
        />
        <KpiCard
          index={3}
          label="AI analyzed"
          value={analyzed}
          icon={BrainCircuit}
          tone="tier1"
          detail={inFlight > 0 ? `${inFlight} still processing` : 'Pipeline idle'}
        />
        <KpiCard
          index={4}
          label="Storage used"
          value={storageBytes}
          format={formatBytes}
          icon={HardDrive}
          tone="info"
          detail={`Across ${versions.length} version${versions.length === 1 ? '' : 's'}`}
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          {/* ── Pipeline ─────────────────────────────────────────────────── */}
          <section className="card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="display text-base text-ink">Document activity</h2>
              <span className="record-label">Whole corpus</span>
            </div>

            <Pipeline
              stages={[
                { label: 'Uploaded', count: versions.length, icon: Upload },
                { label: 'Text extracted', count: extracted, icon: ScanLine },
                { label: 'AI analyzed', count: analyzed, icon: BrainCircuit },
                { label: 'Under review', count: pendingDocs, icon: Inbox },
                { label: 'Approved', count: approvedDocs, icon: CheckCircle2 },
              ]}
            />
          </section>

          {/* ── Recent documents ─────────────────────────────────────────── */}
          <section className="card overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="display text-base text-ink">Recent documents</h2>
              <Link href="/workspace" className="link text-xs">
                View all
              </Link>
            </div>

            {recent.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  icon={Upload}
                  title="Nothing to reveal yet"
                  description="Upload your first document and let Revelio reveal what is inside."
                  action={
                    <Link href="/upload" className="btn-primary">
                      <Upload className="size-4" />
                      Upload document
                    </Link>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((doc, i) => {
                  const ext = fileExtension(doc.current_version?.original_filename);
                  return (
                    <li key={doc.id} className="rise-in" style={stagger(i)}>
                      <Link
                        href={`/documents/${doc.id}`}
                        className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
                      >
                        {/* A sheet, not a chip: the same vocabulary as the
                            explorer, at row scale. */}
                        <span
                          aria-hidden
                          className="relative grid h-8 w-6 shrink-0 place-items-center rounded-sm border
                                     border-line-2 bg-surface transition-transform duration-300
                                     group-hover:-translate-y-0.5"
                        >
                          <span className="absolute right-0 top-0 size-2 border-b border-l border-line-2 bg-surface-2" />
                          <span className="font-mono text-[7px] font-bold text-muted">
                            {ext || '—'}
                          </span>
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-ink transition-colors group-hover:text-accent-ink">
                              {doc.title}
                            </span>
                            <StatusBadge state={doc.workflow_status} />
                            {doc.current_version && (
                              <ProcessingBadge state={doc.current_version.processing_status} />
                            )}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                            {doc.category && <span className="truncate">{doc.category.name}</span>}
                            <span className="text-line-2">·</span>
                            <span className="truncate">{doc.owner?.full_name ?? 'Unknown'}</span>
                            <span className="text-line-2">·</span>
                            <span>{formatRelative(doc.updated_at)}</span>
                          </span>
                        </span>

                        <ArrowRight
                          className="size-4 shrink-0 -translate-x-1 text-faint opacity-0 transition-all
                                     group-hover:translate-x-0 group-hover:text-accent-ink group-hover:opacity-100"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Side rail ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Intelligence. The illustration is documents becoming data becoming
              insight — the product's actual claim, drawn once. */}
          <section className="card settle-in overflow-hidden">
            <div className="border-b border-line bg-accent-soft/60 px-5 py-4">
              <h2 className="display flex items-center gap-2 text-base text-ink">
                <Sparkles className="size-4 text-accent-ink" />
                Revelio Intelligence
              </h2>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                Every upload is read, extracted and analyzed so its contents become searchable.
              </p>
            </div>

            <div className="px-5 py-5">
              <IntelligenceLadder analyzed={analyzed} extracted={extracted} total={versions.length} />

              <Link href="/search" className="btn-secondary mt-5 w-full text-xs">
                <Search className="size-3.5" />
                Search extracted content
              </Link>
            </div>
          </section>

          {/* ── Quick actions ────────────────────────────────────────────── */}
          <section className="card p-4">
            <h2 className="record-label mb-3">Quick actions</h2>
            <div className="space-y-1.5">
              <QuickAction href="/upload" icon={Upload} label="Upload document" />
              <QuickAction href="/workspace" icon={Wand2} label="Organize automatically" />
              <QuickAction href="/search" icon={Search} label="Search everything" />
              {reviewer && (
                <QuickAction
                  href="/review"
                  icon={Inbox}
                  label="Open review queue"
                  badge={pendingDocs > 0 ? String(pendingDocs) : undefined}
                />
              )}
            </div>
          </section>

          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Signed in as {profile.full_name || 'user'}. Every figure above counts only the documents
            you own or are authorized to review.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The processing pipeline as a horizontal run of stages.
 *
 * Each stage's connector is filled in proportion to how much of the previous
 * stage made it through, so a stalled pipeline is visible as a half-drawn line
 * rather than as two numbers a reader has to divide in their head.
 */
function Pipeline({
  stages,
}: {
  stages: { label: string; count: number; icon: LucideIcon }[];
}) {
  const peak = Math.max(1, ...stages.map((s) => s.count));

  return (
    <ol className="mt-5 flex items-start gap-0 overflow-x-auto pb-1">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const previous = i === 0 ? stage.count : (stages[i - 1]?.count ?? stage.count);
        // Share of the upstream stage that reached this one, clamped: a stage can
        // legitimately exceed its predecessor (several versions, one document).
        const carried = previous === 0 ? 0 : Math.min(1, stage.count / previous);

        return (
          <li
            key={stage.label}
            className="fade-in flex min-w-[6.5rem] flex-1 flex-col items-center"
            style={stagger(i)}
          >
            <div className="flex w-full items-center">
              {/* Left half of the connector, owned by this stage so the icons
                  stay evenly spaced regardless of label width. */}
              <span
                aria-hidden
                className={`h-px flex-1 ${i === 0 ? 'bg-transparent' : 'bg-line'}`}
              />
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset ${
                  stage.count > 0
                    ? 'bg-accent-soft text-accent-ink ring-accent-line'
                    : 'bg-surface-2 text-faint ring-line'
                }`}
              >
                <Icon className="size-4" />
              </span>
              <span aria-hidden className="relative h-px flex-1">
                <span
                  className={`absolute inset-0 ${i === stages.length - 1 ? 'bg-transparent' : 'bg-line'}`}
                />
                {i < stages.length - 1 && (
                  <span
                    className="absolute inset-y-0 left-0 origin-left animate-grow-x bg-accent-line"
                    style={{ width: `${carried * 100}%`, animationDelay: `${i * 90}ms` }}
                  />
                )}
              </span>
            </div>

            <p className="mt-2.5 text-center text-[11px] font-medium leading-tight text-ink-2">
              {stage.label}
            </p>
            <p className="display mt-0.5 text-lg leading-none text-ink">
              <CountUp value={stage.count} />
            </p>
            {/* A hairline bar giving each stage its size relative to the largest,
                so the run reads as a shape and not only as five figures. */}
            <span aria-hidden className="mt-2 h-1 w-10 overflow-hidden rounded-full bg-surface-3">
              <span
                className="block h-full origin-left animate-grow-x rounded-full bg-accent"
                style={{ width: `${(stage.count / peak) * 100}%`, animationDelay: `${i * 90}ms` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Documents → data → insight, with the real counts at each rung. */
function IntelligenceLadder({
  analyzed,
  extracted,
  total,
}: {
  analyzed: number;
  extracted: number;
  total: number;
}) {
  const rungs = [
    { label: 'Documents', count: total, icon: FileStack },
    { label: 'Extracted text', count: extracted, icon: ScanLine },
    { label: 'Insights', count: analyzed, icon: Sparkles },
  ];

  return (
    <ol className="space-y-0">
      {rungs.map((rung, i) => {
        const Icon = rung.icon;
        return (
          <li key={rung.label}>
            <div className="flex items-center gap-3">
              <span
                className="grid size-7 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent-ink
                           ring-1 ring-inset ring-line"
              >
                <Icon className="size-3.5" />
              </span>
              <span className="flex-1 text-xs font-medium text-ink-2">{rung.label}</span>
              <span className="display text-base leading-none text-ink">
                <CountUp value={rung.count} />
              </span>
            </div>

            {/* The rung below is reached through this connector, drawn as a
                dotted feed rather than a solid rule — it is a flow, not a rule. */}
            {i < rungs.length - 1 && (
              <span
                aria-hidden
                className="ml-3.5 block h-4 w-px border-l border-dashed border-line-2"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-md px-2 py-2 text-xs font-medium text-ink-2
                 transition-all duration-200 hover:translate-x-0.5 hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-accent-ink" />
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="chip bg-warn-soft px-1.5 py-0 text-[10px] font-bold text-warn ring-1 ring-inset ring-warn-line">
          {badge}
        </span>
      )}
      <ArrowRight className="size-3 shrink-0 -translate-x-1 text-faint opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
    </Link>
  );
}

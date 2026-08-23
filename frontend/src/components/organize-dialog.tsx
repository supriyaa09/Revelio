'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  FolderTree,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { applyOrganize, previewOrganize } from '@/lib/actions/organize';
import {
  SKIP_LABELS,
  groupByTarget,
  type OrganizePreview,
  type OrganizeProposal,
} from '@/lib/organize';
import { ErrorNote, stagger } from '@/components/ui';

/** Documents per apply call. Matches the server's own chunk size. */
const APPLY_CHUNK = 8;

type Phase = 'scanning' | 'preview' | 'applying' | 'done';

export function OrganizeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Kept separate from `open` so the panel can play its exit animation before
  // unmounting, the same pattern the command palette uses.
  const [leaving, setLeaving] = useState(false);

  const [phase, setPhase] = useState<Phase>('scanning');
  const [preview, setPreview] = useState<OrganizePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ applied: number; failed: number } | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const scan = useCallback(async () => {
    setPhase('scanning');
    setError(null);
    setPreview(null);
    setExcluded(new Set());
    setProgress(0);
    setResult(null);
    setShowSkipped(false);

    const res = await previewOrganize();
    if (!res.ok) {
      setError(res.message);
      setPhase('preview');
      return;
    }
    setPreview(res.data);
    setPhase('preview');
  }, []);

  function start() {
    setOpen(true);
    void scan();
  }

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setOpen(false);
      setLeaving(false);
      // Anything applied changed the tree behind the dialog.
      if (result && result.applied > 0) router.refresh();
    }, 150);
  }, [result, router]);

  // Escape to dismiss, and a scroll lock so the page behind cannot move.
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      // Never let Escape abandon an in-flight batch: some documents would have
      // moved and the user would have no idea which.
      if (e.key === 'Escape' && phase !== 'applying') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, phase, close]);

  const proposals = preview?.proposals ?? [];
  const groups = useMemo(() => groupByTarget(proposals), [proposals]);
  const selected = proposals.filter((p) => !excluded.has(p.documentId));

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(items: OrganizeProposal[]) {
    const allIn = items.every((i) => !excluded.has(i.documentId));
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const i of items) {
        if (allIn) next.add(i.documentId);
        else next.delete(i.documentId);
      }
      return next;
    });
  }

  /**
   * Applies in chunks from the client so the progress bar reflects real work.
   * One action call for everything would be simpler but could only show an
   * indeterminate spinner, and this can take a few seconds over 50 documents.
   */
  async function apply() {
    const ids = selected.map((p) => p.documentId);
    if (ids.length === 0) return;

    setPhase('applying');
    setError(null);
    setProgress(0);

    let applied = 0;
    let failed = 0;

    for (let i = 0; i < ids.length; i += APPLY_CHUNK) {
      const chunk = ids.slice(i, i + APPLY_CHUNK);
      const res = await applyOrganize(chunk);

      if (res.ok) {
        applied += res.data.applied;
        failed += res.data.failed;
      } else {
        // Report the reason but keep going: later chunks are independent, and
        // stopping would leave the run half-done for no benefit.
        failed += chunk.length;
        setError(res.message);
      }
      setProgress(Math.min(ids.length, i + chunk.length));
    }

    setResult({ applied, failed });
    setPhase('done');
  }

  return (
    <>
      <button type="button" onClick={start} className="btn-secondary group">
        <Wand2 className="size-4 transition-transform duration-300 group-hover:-rotate-12" />
        Organize
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 py-[6vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Organize documents"
        >
          <div
            onClick={phase === 'applying' ? undefined : close}
            className={`absolute inset-0 bg-ink/50 transition-opacity duration-200
                        ${leaving ? 'opacity-0' : 'animate-[fade_0.2s_var(--ease-smooth)_both]'}`}
          />

          <div
            className={`relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden
                        rounded-2xl border border-line bg-surface shadow-e3
                        transition-all duration-150
                        ${
                          leaving
                            ? 'translate-y-1 scale-[0.98] opacity-0'
                            : 'animate-[pop_0.24s_var(--ease-spring)_both]'
                        }`}
          >
            {/* ── Header ────────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-ink">
                  <Sparkles className="size-4 text-accent" />
                  Organize documents
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Folders are matched from document text and filenames against category
                  keywords. Nothing moves until you apply.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={phase === 'applying'}
                aria-label="Close"
                className="group grid size-8 shrink-0 place-items-center rounded-lg text-muted
                           transition-colors hover:bg-surface-2 hover:text-ink
                           disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="size-4 transition-transform duration-300 group-hover:rotate-90" />
              </button>
            </div>

            {/* ── Body ──────────────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {phase === 'scanning' && <ScanningState />}

              {phase === 'preview' && error && <ErrorNote>{error}</ErrorNote>}

              {phase === 'preview' && !error && proposals.length === 0 && (
                <div className="py-10 text-center">
                  <div className="mx-auto grid size-12 place-items-center rounded-full bg-ok-soft">
                    <Check className="size-5 text-ok" />
                  </div>
                  <p className="mt-3 font-medium text-ink">Everything is already filed</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
                    {preview?.scanned
                      ? `Checked ${preview.scanned} document${preview.scanned === 1 ? '' : 's'} and found nothing that needs moving.`
                      : 'No documents need organizing right now.'}
                  </p>
                </div>
              )}

              {phase === 'preview' && !error && proposals.length > 0 && (
                <div className="space-y-5">
                  {groups.map((group, gi) => {
                    const allIn = group.items.every((i) => !excluded.has(i.documentId));
                    return (
                      <section key={group.label} className="rise-in" style={stagger(gi)}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            <FolderTree className="size-3.5 text-accent" />
                            {group.label}
                            <span className="chip bg-surface-2 tabular-nums text-muted">
                              {group.items.length}
                            </span>
                          </h3>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.items)}
                            className="text-xs text-muted transition-colors hover:text-ink"
                          >
                            {allIn ? 'Skip all' : 'Include all'}
                          </button>
                        </div>

                        <ul className="card divide-y divide-line overflow-hidden">
                          {group.items.map((p) => (
                            <ProposalRow
                              key={p.documentId}
                              proposal={p}
                              included={!excluded.has(p.documentId)}
                              onToggle={() => toggle(p.documentId)}
                            />
                          ))}
                        </ul>
                      </section>
                    );
                  })}

                  {preview && preview.skipped.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowSkipped((v) => !v)}
                        className="text-xs text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
                      >
                        {preview.skipped.length} document
                        {preview.skipped.length === 1 ? '' : 's'} left alone
                        {showSkipped ? ' — hide' : ' — why?'}
                      </button>

                      {showSkipped && (
                        <ul className="mt-2 space-y-1 rounded-xl bg-surface-2 px-3 py-2.5">
                          {preview.skipped.map((s) => (
                            <li
                              key={s.documentId}
                              className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                            >
                              <span className="truncate text-ink-2">{s.title}</span>
                              <span className="text-faint">{SKIP_LABELS[s.reason]}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {preview?.hasMore && (
                    <p className="text-xs leading-relaxed text-muted">
                      Only the {preview.scanned} most recently updated documents were scanned.
                      Run Organize again afterwards to continue.
                    </p>
                  )}
                </div>
              )}

              {phase === 'applying' && (
                <ApplyingState done={progress} total={selected.length} />
              )}

              {phase === 'done' && result && <DoneState {...result} error={error} />}
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3">
              <span className="text-xs text-muted">
                {phase === 'preview' && proposals.length > 0 && (
                  <>
                    <span className="font-semibold tabular-nums text-ink">{selected.length}</span>{' '}
                    of {proposals.length} selected
                  </>
                )}
                {phase === 'applying' && 'Filing documents…'}
                {phase === 'done' && 'Done'}
              </span>

              <div className="flex items-center gap-2">
                {phase === 'done' ? (
                  <>
                    <button type="button" onClick={scan} className="btn-ghost text-xs">
                      Scan again
                    </button>
                    <button type="button" onClick={close} className="btn-primary">
                      Close
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={close}
                      disabled={phase === 'applying'}
                      className="btn-ghost"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={apply}
                      disabled={phase !== 'preview' || selected.length === 0}
                      className="btn-primary"
                    >
                      {phase === 'applying' && <Loader2 className="size-4 animate-spin" />}
                      {selected.length > 0
                        ? `File ${selected.length} document${selected.length === 1 ? '' : 's'}`
                        : 'File documents'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** One proposed move. */
function ProposalRow({
  proposal,
  included,
  onToggle,
}: {
  proposal: OrganizeProposal;
  included: boolean;
  onToggle: () => void;
}) {
  const pct = Math.round(proposal.confidence * 100);
  const tone = pct >= 70 ? 'bg-ok' : pct >= 50 ? 'bg-accent' : 'bg-warn';

  return (
    <li>
      <label
        className={`flex cursor-pointer items-start gap-3 px-3.5 py-3 transition-colors
                    hover:bg-surface-2 ${included ? '' : 'opacity-50'}`}
      >
        <input
          type="checkbox"
          checked={included}
          onChange={onToggle}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{proposal.title}</div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className={proposal.fromLabel ? '' : 'italic'}>
              {proposal.fromLabel ?? 'Unfiled'}
            </span>
            <ArrowRight className="size-3 text-faint" />
            <span className="font-medium text-accent-ink">{proposal.toLabel}</span>
          </div>

          {proposal.matchedTerms.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {proposal.matchedTerms.map((t) => (
                <span
                  key={t}
                  className="chip bg-surface-2 font-mono text-[10px] text-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-xs tabular-nums text-muted">{pct}%</span>
          <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-3">
            <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
          </span>
          {/* States plainly whether this came from real document text or only
              the filename, so a weak guess is not mistaken for a strong one. */}
          <span className="text-[10px] text-faint">
            {proposal.basis === 'extracted_text' ? 'from text' : 'from name'}
          </span>
        </div>
      </label>
    </li>
  );
}

function ScanningState() {
  return (
    <div className="space-y-3 py-2">
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin text-accent" />
        Reading documents and matching keywords…
      </p>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-3.5">
          <div className="skeleton size-4 shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-3.5" style={{ width: `${62 - i * 7}%` }} />
            <div className="skeleton mt-2 h-3" style={{ width: `${44 - i * 5}%` }} />
          </div>
          <div className="skeleton h-3 w-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ApplyingState({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="py-10 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft">
        <FolderTree className="size-5 animate-pulse text-accent" />
      </div>
      <p className="mt-3 font-medium text-ink">
        Filing <span className="tabular-nums">{done}</span> of{' '}
        <span className="tabular-nums">{total}</span>
      </p>
      <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease-smooth)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DoneState({
  applied,
  failed,
  error,
}: {
  applied: number;
  failed: number;
  error: string | null;
}) {
  return (
    <div className="py-8 text-center">
      <div
        className={`mx-auto grid size-12 place-items-center rounded-full ${
          failed > 0 ? 'bg-warn-soft' : 'bg-ok-soft'
        }`}
      >
        <Check className={`size-5 ${failed > 0 ? 'text-warn' : 'text-ok'}`} />
      </div>

      <p className="mt-3 font-medium text-ink">
        {applied > 0
          ? `Filed ${applied} document${applied === 1 ? '' : 's'}`
          : 'Nothing was moved'}
      </p>

      {failed > 0 && (
        <p className="mt-1 text-sm text-warn">
          {failed} could not be filed{error ? `: ${error}` : '.'}
        </p>
      )}

      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
        Each move is recorded in the document&apos;s audit history and marked as an automatic,
        keyword-based filing — you can override any of them by hand.
      </p>
    </div>
  );
}

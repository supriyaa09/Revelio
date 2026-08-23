'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, Loader2, Send, Undo2, X } from 'lucide-react';
import { transitionDocument } from '@/lib/actions/documents';
import { ALLOWED_TRANSITIONS, canDecideAt, canReview, canRoute } from '@/lib/constants';
import { ErrorNote } from '@/components/ui';
import { Stamp } from '@/components/stamp';
import type { StampTone } from '@/components/stamp';
import type { AppRole, WorkflowState } from '@/lib/types';

interface Action {
  to: WorkflowState;
  label: string;
  icon: typeof Check;
  style: string;
  needsComment?: boolean;
}

const SOLID = {
  ok: 'btn w-full bg-ok text-surface shadow-e1 hover:opacity-95',
  warn: 'btn w-full bg-warn text-surface shadow-e1 hover:opacity-95',
  danger: 'btn w-full bg-danger text-surface shadow-e1 hover:opacity-95',
  tier2: 'btn w-full bg-tier2 text-surface shadow-e1 hover:opacity-95',
} as const;

/**
 * Decisions that get a physical seal, and what the seal says.
 *
 * Only the three terminal judgements are stamped. Stamping "submitted" or
 * "routed to HOD" would spend the gesture on a handoff and leave nothing left
 * for the moment that actually settles the document.
 */
const SEALS: Partial<Record<WorkflowState, { label: string; tone: StampTone; rotate: number }>> = {
  approved: { label: 'Approved', tone: 'approved', rotate: -9 },
  changes_requested: { label: 'Changes Required', tone: 'changes', rotate: 6 },
  rejected: { label: 'Rejected', tone: 'rejected', rotate: -5 },
};

/** How long the seal is held before the page reloads underneath it. */
const SEAL_HOLD = 1250;

export function WorkflowActions({
  documentId,
  status,
  isOwner,
  role,
  hasVersion,
}: {
  documentId: string;
  status: WorkflowState;
  isOwner: boolean;
  role: AppRole;
  hasVersion: boolean;
}) {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<WorkflowState | null>(null);
  const [sealed, setSealed] = useState<WorkflowState | null>(null);
  const [, startTransition] = useTransition();

  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function act(to: WorkflowState) {
    setError(null);
    setBusy(to);

    const result = await transitionDocument(documentId, to, comment);

    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setComment('');

    /*
     * The write has already landed. The pause that follows exists only so the
     * seal is legible before the refresh redraws the panel — so it is skipped
     * entirely for transitions that carry no seal.
     */
    if (SEALS[to]) {
      setSealed(to);
      timer.current = window.setTimeout(() => startTransition(() => router.refresh()), SEAL_HOLD);
    } else {
      startTransition(() => router.refresh());
    }
  }

  const possible = ALLOWED_TRANSITIONS[status];
  const mayDecide = canDecideAt(role, status) && !isOwner;
  const actions: Action[] = [];

  // Owner moves
  if (possible.includes('submitted') && isOwner) {
    actions.push({
      to: 'submitted',
      label: status === 'changes_requested' ? 'Resubmit for Review' : 'Submit for Review',
      icon: Send,
      style: 'btn-primary w-full shadow-e1',
    });
  }

  // Pickup and routing
  if (possible.includes('faculty_review') && canRoute(role)) {
    actions.push({
      to: 'faculty_review',
      label: 'Start Faculty Review',
      icon: Check,
      style: 'btn-primary w-full shadow-e1',
    });
  }
  if (possible.includes('hod_review') && canRoute(role)) {
    actions.push({
      to: 'hod_review',
      label: status === 'submitted' ? 'Escalate to HOD' : 'Route to HOD',
      icon: ArrowUpRight,
      style: SOLID.tier2,
    });
  }

  // Decisions
  if (possible.includes('approved') && mayDecide) {
    actions.push({ to: 'approved', label: 'Approve Document', icon: Check, style: SOLID.ok });
  }
  if (possible.includes('changes_requested') && mayDecide) {
    actions.push({
      to: 'changes_requested',
      label: 'Request Changes',
      icon: Undo2,
      style: SOLID.warn,
      needsComment: true,
    });
  }
  if (possible.includes('rejected') && mayDecide) {
    actions.push({
      to: 'rejected',
      label: 'Reject Submission',
      icon: X,
      style: SOLID.danger,
      needsComment: true,
    });
  }

  if (possible.includes('draft') && isOwner) {
    actions.push({
      to: 'draft',
      label: status === 'rejected' ? 'Return to Draft' : 'Withdraw Submission',
      icon: Undo2,
      style: 'btn-secondary w-full',
    });
  }

  const showComment = actions.some((a) => a.needsComment);
  const seal = sealed ? SEALS[sealed] : null;

  return (
    <section className="card relative animate-rise overflow-hidden p-5">
      <h2 className="display text-base font-semibold text-ink">Governance Actions</h2>

      {actions.length === 0 ? (
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          {emptyReason(status, role, isOwner)}
        </p>
      ) : (
        <>
          {isOwner && !hasVersion && (
            <Note tone="warn">Upload a source file before submitting for institutional review.</Note>
          )}

          {status === 'hod_review' && !isOwner && !mayDecide && (
            <Note tone="tier2">
              This document is escalated to HOD. Awaiting executive sign-off.
            </Note>
          )}

          {showComment && (
            <div className="mt-3.5 space-y-1.5">
              <label htmlFor="wf-comment" className="label font-semibold text-xs">
                Decision Notes & Feedback
              </label>
              <textarea
                id="wf-comment"
                rows={3}
                className="input resize-none text-xs"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Explain the review rationale or required adjustments..."
              />
            </div>
          )}

          <div className="mt-4 space-y-2">
            {actions.map(({ to, label, icon: Icon, style }, i) => (
              <button
                key={to}
                type="button"
                disabled={busy !== null}
                onClick={() => act(to)}
                style={{ '--i': i } as React.CSSProperties}
                className={`${style} rise-in font-semibold`}
              >
                {busy === to ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Icon className="size-4" />
                )}
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="mt-3.5">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/*
       * The seal. It covers the panel rather than sitting beside it, because a
       * decision that has been made should visibly close the panel that offered
       * it — the buttons underneath are no longer the live thing on screen.
       */}
      {seal && (
        <div
          className="absolute inset-0 grid animate-fade place-items-center"
          style={{ backgroundColor: 'var(--surface-glass)', animationDuration: '220ms' }}
        >
          {/* Scale lives on a wrapper: the stamp owns its own transform. */}
          <div className="scale-125">
            <Stamp label={seal.label} tone={seal.tone} rotate={seal.rotate} />
          </div>
        </div>
      )}
    </section>
  );
}

function Note({ tone, children }: { tone: 'warn' | 'tier2'; children: React.ReactNode }) {
  const styles =
    tone === 'warn'
      ? 'border-warn-line bg-warn-soft text-warn'
      : 'border-tier2-line bg-tier2-soft text-tier2';

  return (
    <p className={`mt-2.5 rounded-xl border px-3 py-2 text-xs leading-relaxed ${styles}`}>
      {children}
    </p>
  );
}

function emptyReason(status: WorkflowState, role: AppRole, isOwner: boolean): string {
  if (status === 'approved') {
    return 'This document is approved. Upload a new version to start another review cycle.';
  }
  if (isOwner && canReview(role)) {
    return 'You cannot decide on your own submission. Assigned faculty reviewers or HOD will act on it.';
  }
  if (status === 'hod_review' && !canDecideAt(role, status)) {
    return 'This document is escalated to HOD and is awaiting executive decision.';
  }
  if (!canReview(role) && !isOwner) {
    return 'You do not have review permissions for this document.';
  }
  return 'No actions available to you in this state.';
}

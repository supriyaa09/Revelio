'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, Loader2, Send, Undo2, X } from 'lucide-react';
import { transitionDocument } from '@/lib/actions/documents';
import { ALLOWED_TRANSITIONS, canDecideAt, canReview, canRoute } from '@/lib/constants';
import type { AppRole, WorkflowState } from '@/lib/types';

interface Action {
  to: WorkflowState;
  label: string;
  icon: typeof Check;
  style: string;
  needsComment?: boolean;
}

/**
 * Offers only the transitions this user could plausibly perform in this state.
 * A convenience layer: every rule is re-checked by transition_document(), so a
 * crafted request cannot bypass what is hidden here.
 */
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
  const [, startTransition] = useTransition();

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
    startTransition(() => router.refresh());
  }

  const possible = ALLOWED_TRANSITIONS[status];
  // A decision needs the right tier AND must not be on your own document.
  const mayDecide = canDecideAt(role, status) && !isOwner;
  const actions: Action[] = [];

  // ── Owner moves ───────────────────────────────────────────────────────────
  if (possible.includes('submitted') && isOwner) {
    actions.push({
      to: 'submitted',
      label: status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review',
      icon: Send,
      style: 'btn-primary w-full',
    });
  }

  // ── Pickup and routing. Reviewer tier only, owner permitted. ──────────────
  if (possible.includes('faculty_review') && canRoute(role)) {
    actions.push({
      to: 'faculty_review',
      label: 'Start faculty review',
      icon: Check,
      style: 'btn-primary w-full',
    });
  }
  if (possible.includes('hod_review') && canRoute(role)) {
    actions.push({
      to: 'hod_review',
      label: status === 'submitted' ? 'Escalate to HOD' : 'Route to HOD',
      icon: ArrowUpRight,
      style: 'btn w-full bg-violet-600 text-white hover:bg-violet-700',
    });
  }

  // ── Decisions ─────────────────────────────────────────────────────────────
  if (possible.includes('approved') && mayDecide) {
    actions.push({
      to: 'approved',
      label: 'Approve',
      icon: Check,
      style: 'btn w-full bg-emerald-600 text-white hover:bg-emerald-700',
    });
  }
  if (possible.includes('changes_requested') && mayDecide) {
    actions.push({
      to: 'changes_requested',
      label: 'Request changes',
      icon: Undo2,
      style: 'btn w-full bg-orange-500 text-white hover:bg-orange-600',
      needsComment: true,
    });
  }
  if (possible.includes('rejected') && mayDecide) {
    actions.push({
      to: 'rejected',
      label: 'Reject',
      icon: X,
      style: 'btn w-full bg-red-600 text-white hover:bg-red-700',
      needsComment: true,
    });
  }

  if (possible.includes('draft') && isOwner) {
    actions.push({
      to: 'draft',
      label: status === 'rejected' ? 'Return to draft' : 'Withdraw',
      icon: Undo2,
      style: 'btn-secondary w-full',
    });
  }

  const showComment = actions.some((a) => a.needsComment);

  return (
    <section className="card p-5">
      <h2 className="font-medium">Actions</h2>

      {actions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{emptyReason(status, role, isOwner)}</p>
      ) : (
        <>
          {isOwner && !hasVersion && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Upload a file before submitting for review.
            </p>
          )}

          {status === 'hod_review' && !isOwner && !mayDecide && (
            <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
              This document is escalated. Only the HOD can decide on it now.
            </p>
          )}

          {showComment && (
            <div className="mt-3 space-y-1.5">
              <label htmlFor="wf-comment" className="label text-xs">
                Comment
              </label>
              <textarea
                id="wf-comment"
                rows={3}
                className="input resize-none text-sm"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Explain what needs to change…"
              />
            </div>
          )}

          <div className="mt-3 space-y-2">
            {actions.map(({ to, label, icon: Icon, style }) => (
              <button
                key={to}
                type="button"
                disabled={busy !== null}
                onClick={() => act(to)}
                className={style}
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
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function emptyReason(status: WorkflowState, role: AppRole, isOwner: boolean): string {
  if (status === 'approved') {
    return 'This document is approved. Upload a new version to start another review cycle.';
  }
  if (isOwner && canReview(role)) {
    return 'You cannot decide on your own document. Another reviewer, or the HOD, must act on it.';
  }
  if (status === 'hod_review' && !canDecideAt(role, status)) {
    return 'This document is escalated to the HOD and is awaiting their decision.';
  }
  if (!canReview(role) && !isOwner) {
    return 'You do not have review permissions for this document.';
  }
  return 'No actions available to you in this state.';
}

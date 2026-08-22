'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Send, Undo2, X } from 'lucide-react';
import { transitionDocument } from '@/lib/actions/documents';
import { ALLOWED_TRANSITIONS, canApprove, canReview } from '@/lib/constants';
import type { AppRole, WorkflowState } from '@/lib/types';

/**
 * Renders only the transitions the current user could plausibly perform.
 * This is a convenience layer: every rule is re-checked in the database, so a
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

  // Owners submit and resubmit. Reviewers decide — but never on their own doc.
  const canDecide = canReview(role) && !isOwner;
  const actions: { to: WorkflowState; label: string; icon: typeof Check; style: string }[] = [];

  if (possible.includes('submitted') && isOwner) {
    actions.push({
      to: 'submitted',
      label: status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review',
      icon: Send,
      style: 'btn-primary w-full',
    });
  }
  if (possible.includes('under_review') && canDecide) {
    actions.push({ to: 'under_review', label: 'Start review', icon: Check, style: 'btn-primary w-full' });
  }
  if (possible.includes('approved') && canDecide && canApprove(role)) {
    actions.push({
      to: 'approved',
      label: 'Approve',
      icon: Check,
      style: 'btn w-full bg-emerald-600 text-white hover:bg-emerald-700',
    });
  }
  if (possible.includes('changes_requested') && canDecide) {
    actions.push({
      to: 'changes_requested',
      label: 'Request changes',
      icon: Undo2,
      style: 'btn w-full bg-orange-500 text-white hover:bg-orange-600',
    });
  }
  if (possible.includes('rejected') && canDecide) {
    actions.push({
      to: 'rejected',
      label: 'Reject',
      icon: X,
      style: 'btn w-full bg-red-600 text-white hover:bg-red-700',
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

  const needsComment = ['rejected', 'changes_requested'];

  return (
    <section className="card p-5">
      <h2 className="font-medium">Actions</h2>

      {actions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          {status === 'approved'
            ? 'This document is approved. Upload a new version to start another review cycle.'
            : canReview(role) && isOwner
              ? 'You cannot review your own document. Another reviewer must decide.'
              : 'No actions available to you in this state.'}
        </p>
      ) : (
        <>
          {isOwner && !hasVersion && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Upload a file before submitting for review.
            </p>
          )}

          {actions.some((a) => needsComment.includes(a.to)) && (
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
                {busy === to ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
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

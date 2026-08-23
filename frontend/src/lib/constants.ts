import type { AppRole, ProcessingState, WorkflowState } from './types';

/** Hard limits, mirrored in the database CHECK constraints and bucket config. */
export const MAX_FILE_BYTES = 26_214_400; // 25 MB
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const STORAGE_BUCKET = 'documents';

/** Seconds a signed download URL stays valid. */
export const SIGNED_URL_TTL = 300;

export const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  faculty_review: 'Faculty review',
  hod_review: 'HOD review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
};

/**
 * Tailwind classes per state. Kept here so badges stay consistent everywhere.
 *
 * These reference the semantic tokens in globals.css rather than Tailwind's
 * stock palette, which is what lets one definition serve both themes. Note that
 * no state uses the amber brand accent: a status badge must never be mistaken
 * for a brand element. The two review tiers deliberately run violet → fuchsia
 * so escalation reads as a temperature change in the queue.
 */
export const WORKFLOW_STYLES: Record<WorkflowState, string> = {
  draft: 'bg-neutral-soft text-muted ring-neutral-line',
  submitted: 'bg-info-soft text-info ring-info-line',
  faculty_review: 'bg-tier1-soft text-tier1 ring-tier1-line',
  hod_review: 'bg-tier2-soft text-tier2 ring-tier2-line',
  approved: 'bg-ok-soft text-ok ring-ok-line',
  rejected: 'bg-danger-soft text-danger ring-danger-line',
  changes_requested: 'bg-warn-soft text-warn ring-warn-line',
};

export const PROCESSING_LABELS: Record<ProcessingState, string> = {
  pending: 'Queued',
  processing: 'Processing',
  completed: 'Processed',
  failed: 'Failed',
};

export const ROLE_LABELS: Record<AppRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  hod: 'HOD',
};

/**
 * Mirrors is_valid_transition() in 0002_security.sql. UI convenience
 * only — the database remains the enforcement point.
 *
 * Workflow is process-dependent: faculty may approve directly, or route to the
 * HOD. Nothing forces a document through Student → Faculty → HOD.
 */
export const ALLOWED_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  draft: ['submitted'],
  submitted: ['faculty_review', 'hod_review', 'draft'],
  faculty_review: ['approved', 'rejected', 'changes_requested', 'hod_review'],
  hod_review: ['approved', 'rejected', 'changes_requested'],
  approved: [],
  rejected: ['draft'],
  changes_requested: ['submitted'],
};

/** Faculty and HOD form the reviewer tier. Students never review. */
export function canReview(role: AppRole): boolean {
  return role === 'faculty' || role === 'hod';
}

export function isHod(role: AppRole): boolean {
  return role === 'hod';
}

/**
 * Approval authority is state-dependent, not role-dependent: faculty can decide
 * at faculty_review, but only the HOD can decide once a document is escalated.
 */
export function canDecideAt(role: AppRole, state: WorkflowState): boolean {
  if (state === 'hod_review') return isHod(role);
  return canReview(role);
}

/**
 * Routing and pickup require the reviewer tier but — unlike a decision — are
 * permitted on your own document. Faculty escalating their own submission is
 * legitimate; faculty approving it is not.
 */
export function canRoute(role: AppRole): boolean {
  return canReview(role);
}

/** States that appear in the review queue. */
export const REVIEW_QUEUE_STATES: WorkflowState[] = [
  'submitted',
  'faculty_review',
  'hod_review',
];

/** Queue states this role has decision authority over. */
export function decisionStatesForRole(role: AppRole): WorkflowState[] {
  if (role === 'hod') return ['submitted', 'faculty_review', 'hod_review'];
  if (role === 'faculty') return ['submitted', 'faculty_review'];
  return [];
}

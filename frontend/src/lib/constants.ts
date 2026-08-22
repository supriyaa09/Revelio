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

/** Tailwind classes per state. Kept here so badges stay consistent everywhere. */
export const WORKFLOW_STYLES: Record<WorkflowState, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  submitted: 'bg-blue-50 text-blue-700 ring-blue-200',
  faculty_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  hod_review: 'bg-violet-50 text-violet-700 ring-violet-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  changes_requested: 'bg-orange-50 text-orange-700 ring-orange-200',
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

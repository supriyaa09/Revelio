import clsx from 'clsx';
import {
  PROCESSING_LABELS,
  WORKFLOW_LABELS,
  WORKFLOW_STYLES,
} from '@/lib/constants';
import type { ProcessingState, WorkflowState } from '@/lib/types';

export function StatusBadge({ state }: { state: WorkflowState }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        WORKFLOW_STYLES[state],
      )}
    >
      {WORKFLOW_LABELS[state]}
    </span>
  );
}

const PROCESSING_STYLES: Record<ProcessingState, string> = {
  pending: 'bg-slate-100 text-slate-600',
  processing: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
};

export function ProcessingBadge({ state }: { state: ProcessingState }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        PROCESSING_STYLES[state],
      )}
    >
      {state === 'processing' && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {PROCESSING_LABELS[state]}
    </span>
  );
}

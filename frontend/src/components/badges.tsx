import clsx from 'clsx';
import { PROCESSING_LABELS, WORKFLOW_LABELS, WORKFLOW_STYLES } from '@/lib/constants';
import type { ProcessingState, WorkflowState } from '@/lib/types';

export function StatusBadge({ state }: { state: WorkflowState }) {
  const isPending = state === 'submitted' || state === 'faculty_review' || state === 'hod_review';
  const isApproved = state === 'approved';

  return (
    <span
      className={clsx(
        'chip ring-1 ring-inset shadow-xs font-semibold',
        WORKFLOW_STYLES[state],
        isPending && 'animate-pulse',
      )}
    >
      {isApproved && (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {isPending && (
        <span className="relative flex size-2 items-center justify-center">
          <span className="absolute size-2 rounded-full bg-current opacity-75 animate-ping" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {WORKFLOW_LABELS[state]}
    </span>
  );
}

const PROCESSING_STYLES: Record<ProcessingState, string> = {
  pending: 'bg-neutral-soft text-muted ring-1 ring-line',
  processing: 'bg-info-soft text-info ring-1 ring-info-line shadow-xs',
  completed: 'bg-ok-soft text-ok ring-1 ring-ok-line shadow-xs',
  failed: 'bg-danger-soft text-danger ring-1 ring-danger-line shadow-xs',
};

export function ProcessingBadge({ state }: { state: ProcessingState }) {
  return (
    <span className={clsx('chip font-semibold', PROCESSING_STYLES[state])}>
      {state === 'processing' && (
        <span className="relative flex size-2 items-center justify-center" aria-hidden>
          <span className="absolute size-2.5 rounded-full bg-current opacity-75 animate-ping" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {state === 'completed' && (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {PROCESSING_LABELS[state]}
    </span>
  );
}

/**
 * Confidence readout for auto-filed documents. Shows the percentage and an animated glowing bar.
 */
export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? 'bg-ok shadow-ok' : pct >= 45 ? 'bg-warn shadow-warn' : 'bg-faint';

  return (
    <span className="inline-flex items-center gap-1.5" title={`Classifier confidence: ${pct}%`}>
      <span className="text-[11px] font-medium text-muted">auto-filed</span>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-3 ring-1 ring-inset ring-line">
        <span
          className={clsx('block h-full rounded-full origin-left animate-grow-x transition-all duration-500', tone)}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-2">{pct}%</span>
    </span>
  );
}

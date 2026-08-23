'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { ProcessingState } from '@/lib/types';

type Stage = 'uploaded' | 'extracting' | 'analyzing' | 'indexing' | 'ready' | 'failed';

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'uploaded', label: 'Uploaded & Verified' },
  { stage: 'extracting', label: 'Extracting OCR / Text' },
  { stage: 'analyzing', label: 'AI Synthesis' },
  { stage: 'indexing', label: 'Taxonomy Indexing' },
  { stage: 'ready', label: 'Repository Ready' },
];

interface Props {
  documentId: string;
  versionId: string;
  initialStatus: ProcessingState;
  initialStage: Stage | null;
  initialError: string | null;
  canProcess: boolean;
}

const autoStarted = new Set<string>();

export function ProcessingStatus({
  documentId,
  versionId,
  initialStatus,
  initialStage,
  initialError,
  canProcess,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<ProcessingState>(initialStatus);
  const [stage, setStage] = useState<Stage>(initialStage ?? (initialStatus === 'completed' ? 'ready' : 'uploaded'));
  const [error, setError] = useState<string | null>(initialError);
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (status !== 'processing' && status !== 'pending') {
      stopPolling();
      return;
    }
    if (pollRef.current) return;

    const supabase = createClient();
    pollRef.current = setInterval(async () => {
      if (document.hidden) return;

      const { data } = await supabase
        .from('document_versions')
        .select('processing_status, processing_stage, processing_error')
        .eq('id', versionId)
        .maybeSingle();

      if (!data) return;
      setStatus(data.processing_status as ProcessingState);
      setStage((data.processing_stage as Stage) ?? 'uploaded');
      setError(data.processing_error ?? null);

      if (data.processing_status === 'completed' || data.processing_status === 'failed') {
        stopPolling();
        startTransition(() => router.refresh());
      }
    }, 2000);

    return stopPolling;
  }, [status, versionId, router, stopPolling]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setStatus('processing');
    setStage('extracting');

    try {
      const res = await fetch(`/api/documents/${documentId}/process`, { method: 'POST' });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setStatus('failed');
        setStage('failed');
        setError(body?.error?.message ?? body?.error ?? `Processing failed (${res.status})`);
      }
    } catch (e) {
      setStatus('failed');
      setStage('failed');
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRunning(false);
      startTransition(() => router.refresh());
    }
  }, [documentId, router]);

  useEffect(() => {
    if (!canProcess) return;
    if (status !== 'pending') return;
    if (autoStarted.has(versionId)) return;
    autoStarted.add(versionId);
    setAuto(true);
    void run();
  }, [canProcess, status, versionId, run]);

  const activeIndex = stage === 'failed' ? -1 : STEPS.findIndex((s) => s.stage === stage);
  const busy = running || status === 'processing';

  const progress =
    status === 'completed' ? 1 : activeIndex <= 0 ? 0 : activeIndex / (STEPS.length - 1);

  return (
    <section className="glass-card animate-rise p-5 shadow-e1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <Sparkles
            className={`size-4 ${busy ? 'animate-pulse text-accent-ink' : 'text-accent'}`}
          />
          Pipeline Status
        </h2>
        {canProcess && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="btn-secondary group px-3 py-1.5 text-xs font-semibold shadow-xs"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin text-accent" />
            ) : (
              <RefreshCw
                className="size-3.5 transition-transform duration-500 group-hover:rotate-180"
              />
            )}
            {status === 'completed' ? 'Reprocess' : status === 'failed' ? 'Retry' : 'Process'}
          </button>
        )}
      </div>

      {/* Timeline with animated liquid progress rail */}
      <ol className="relative mt-4.5 space-y-3.5">
        <span
          aria-hidden
          className="absolute left-[0.75rem] top-2.5 h-[calc(100%-1.5rem)] w-[2px]
                     rounded-full bg-line"
        />
        <span
          aria-hidden
          className={`absolute left-[0.75rem] top-2.5 w-[2px] origin-top rounded-full shadow-glow
                      transition-[height] duration-700 ease-[var(--ease-smooth)]
                      ${status === 'failed' ? 'bg-danger' : 'bg-accent'}`}
          style={{ height: `calc((100% - 1.5rem) * ${status === 'failed' ? 1 : progress})` }}
        />

        {STEPS.map((step, i) => {
          const done = status === 'completed' || (activeIndex >= 0 && i < activeIndex);
          const current = activeIndex === i && status !== 'completed';

          return (
            <li key={step.stage} className="relative flex items-center gap-3.5 text-sm">
              <span className="relative grid size-6.5 shrink-0 place-items-center">
                {current && busy && (
                  <span
                    aria-hidden
                    className="absolute size-7 rounded-full bg-accent/40 animate-halo"
                  />
                )}
                <span
                  className={`relative grid size-6 place-items-center rounded-full text-[10px]
                              font-bold transition-all duration-500 ease-[var(--ease-spring)]
                              ${
                                done
                                  ? 'bg-accent text-accent-on shadow-xs'
                                  : current
                                    ? 'scale-110 bg-surface text-accent-ink ring-2 ring-accent'
                                    : 'bg-surface-2 text-faint ring-1 ring-line'
                              }`}
                >
                  {done ? (
                    <Check className="size-3.5 animate-pop" strokeWidth={3} />
                  ) : current ? (
                    <Loader2 className="size-3 animate-spin text-accent-ink" />
                  ) : (
                    i + 1
                  )}
                </span>
              </span>
              <span
                className={`transition-colors duration-300 ${
                  current ? 'font-semibold text-ink' : done ? 'font-medium text-ink-2' : 'text-faint'
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {status === 'failed' && (
        <div className="animate-pop mt-4 rounded-xl border border-danger-line bg-danger-soft px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
            <AlertTriangle className="size-4" />
            Extraction Error
          </p>
          <p className="mt-1 break-words font-mono text-xs leading-relaxed text-danger">
            {error ?? 'Unknown processing error.'}
          </p>
          <p className="mt-2 text-xs text-danger/80">
            Source file is safely stored. Press Retry to rerun the extraction worker.
          </p>
        </div>
      )}

      {busy && (
        <p className="animate-fade mt-3.5 rounded-lg bg-surface-2 p-2.5 text-xs leading-relaxed text-muted border border-line">
          {auto
            ? 'Extraction initialized automatically. Running text layers & neural OCR...'
            : 'Processing document pipeline...'}
        </p>
      )}

      {status === 'pending' && !busy && (
        <p className="mt-3.5 text-xs leading-relaxed text-muted">
          {canProcess
            ? 'Document queued. Press Process to run text extraction & AI synthesis.'
            : 'Pending extraction. Authorized reviewers or owner can initiate.'}
        </p>
      )}
    </section>
  );
}

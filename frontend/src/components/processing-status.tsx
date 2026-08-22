'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { ProcessingState } from '@/lib/types';

type Stage = 'uploaded' | 'extracting' | 'analyzing' | 'indexing' | 'ready' | 'failed';

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'uploaded', label: 'Uploaded' },
  { stage: 'extracting', label: 'Extracting text' },
  { stage: 'analyzing', label: 'Analyzing' },
  { stage: 'indexing', label: 'Indexing' },
  { stage: 'ready', label: 'Ready' },
];

interface Props {
  documentId: string;
  versionId: string;
  initialStatus: ProcessingState;
  initialStage: Stage | null;
  initialError: string | null;
  canProcess: boolean;
}

/**
 * Shows the real pipeline state, read from document_versions. Nothing here is
 * simulated: the stage comes from the database, and a failure shows the actual
 * recorded error rather than a placeholder.
 */
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
  const [, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll while work is in flight. The pipeline writes each stage as it goes, so
  // this reflects genuine progress rather than a timed animation.
  useEffect(() => {
    if (status !== 'processing' && status !== 'pending') {
      stopPolling();
      return;
    }
    if (pollRef.current) return;

    const supabase = createClient();
    pollRef.current = setInterval(async () => {
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

  async function run() {
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
  }

  const activeIndex = stage === 'failed' ? -1 : STEPS.findIndex((s) => s.stage === stage);
  const busy = running || status === 'processing';

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4 text-slate-400" />
          Processing
        </h2>
        {canProcess && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {status === 'completed' ? 'Reprocess' : status === 'failed' ? 'Retry' : 'Process'}
          </button>
        )}
      </div>

      <ol className="mt-4 space-y-2">
        {STEPS.map((step, i) => {
          const done = status === 'completed' || (activeIndex >= 0 && i < activeIndex);
          const current = activeIndex === i && status !== 'completed';
          return (
            <li key={step.stage} className="flex items-center gap-2.5 text-sm">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                  done
                    ? 'bg-emerald-100 text-emerald-700'
                    : current
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <Check className="size-3" /> : current ? <Loader2 className="size-3 animate-spin" /> : i + 1}
              </span>
              <span className={done || current ? 'text-slate-900' : 'text-slate-400'}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {status === 'failed' && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <AlertTriangle className="size-4" />
            Processing failed
          </p>
          {/* The real recorded reason, not a generic message. */}
          <p className="mt-1 break-words font-mono text-xs text-red-700">
            {error ?? 'No reason recorded.'}
          </p>
          <p className="mt-1.5 text-xs text-red-700">
            The uploaded file and all versions are intact. You can retry.
          </p>
        </div>
      )}

      {status === 'pending' && !busy && (
        <p className="mt-3 text-xs text-slate-500">
          Not processed yet. {canProcess ? 'Press Process to extract text and analyze.' : ''}
        </p>
      )}
    </section>
  );
}

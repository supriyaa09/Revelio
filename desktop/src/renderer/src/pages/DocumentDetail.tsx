/**
 * Document details: everything Revelio knows about one file — AI insights,
 * extraction metadata, and the chunked text body — plus actions that operate
 * on the real file (open, reveal) without ever moving it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  FolderSearch,
  RefreshCw,
  Sparkles,
  Tag,
} from 'lucide-react';
import type { FileDetails } from '@shared/types';
import { Badge, Button, Card, ErrorState, Kbd, SectionTitle, Spinner } from '../components/ui';
import { KindIcon } from '../components/FileRow';
import { errorMessage } from '../lib/errors';
import { formatBytes, formatDate, timeAgo } from '../lib/format';
import type { View } from '../lib/nav';

export function DocumentDetail({
  id,
  from,
  onNavigate,
}: {
  id: number;
  from: View;
  onNavigate: (view: View) => void;
}) {
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    window.api
      .getFile(id)
      .then(setDetails)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  useEffect(load, [load]);

  // Esc returns to wherever this page was opened from.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onNavigate(from);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [from, onNavigate]);

  if (!details) {
    return error ? (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorState message={error} onRetry={load} />
      </div>
    ) : (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const d = details;

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 fade-up">
      <button
        onClick={() => onNavigate(from)}
        className="mb-4 flex cursor-pointer items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Back to results
        <Kbd>Esc</Kbd>
      </button>

      {/* Header */}
      <header className="mb-6 flex items-start gap-3">
        <div className="mt-1 text-muted">
          <KindIcon kind={d.kind} className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
            {d.title ?? d.filename}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {d.kind && <Badge>{d.kind}</Badge>}
            {d.category && <Badge tone="accent">{d.category}</Badge>}
            {d.status === 'ready' && <Badge tone="ok">indexed</Badge>}
            {d.status === 'failed' && <Badge tone="danger">failed</Badge>}
            {d.status === 'processing' && <Badge tone="warn">processing</Badge>}
            {d.status === 'pending' && <Badge>queued</Badge>}
            {d.method && <Badge tone="info">{d.method}</Badge>}
            {d.page_count ? <Badge>{d.page_count} pages</Badge> : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="primary"
            disabled={busy !== null}
            onClick={() =>
              void window.api.openFile(d.id).then((err) => setOpenError(err))
            }
          >
            <ExternalLink className="size-4" />
            Open
          </Button>
          <Button onClick={() => void window.api.revealFile(d.id)}>
            <FolderSearch className="size-4" />
            Reveal
          </Button>
          {d.status === 'ready' && (
            <Button
              disabled={busy !== null}
              onClick={() => void act('analyze', () => window.api.reanalyzeFile(d.id))}
            >
              {busy === 'analyze' ? <Spinner className="size-3.5" /> : <Sparkles className="size-4" />}
              Re-analyze
            </Button>
          )}
          {d.status === 'failed' && (
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => void act('retry', () => window.api.retryFile(d.id))}
            >
              <RefreshCw className="size-4" />
              Retry
            </Button>
          )}
        </div>
      </header>

      {openError && (
        <Card className="mb-4 border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
          Could not open the file: {openError}
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
          Could not refresh this document: {error}
        </Card>
      )}

      {d.status === 'failed' && d.error && (
        <Card className="mb-4 border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
          Processing failed: {d.error}
        </Card>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Left: insights */}
        <div className="col-span-2 flex flex-col gap-6">
          {d.summary && (
            <section>
              <SectionTitle>Summary</SectionTitle>
              <Card className="selectable px-4 py-3 text-[13px] leading-6 text-ink-2">
                {d.summary}
              </Card>
            </section>
          )}

          {d.keywords.length > 0 && (
            <section>
              <SectionTitle>Keywords</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {d.keywords.map((k) => (
                  <button
                    key={k}
                    onClick={() => onNavigate({ name: 'search', query: k })}
                    className="cursor-pointer rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft"
                  >
                    <Tag className="mr-1 inline size-3 text-faint" />
                    {k}
                  </button>
                ))}
              </div>
            </section>
          )}

          {d.important_dates.length > 0 && (
            <section>
              <SectionTitle>Important dates</SectionTitle>
              <Card className="divide-y divide-line">
                {d.important_dates.map((date, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <CalendarDays className="size-4 shrink-0 text-muted" />
                    <span className="flex-1 text-ink-2">{date.label}</span>
                    <span className="tabular-nums text-muted">{formatDate(date.date)}</span>
                    {date.is_deadline && <Badge tone="warn">deadline</Badge>}
                  </div>
                ))}
              </Card>
            </section>
          )}

          {d.entities.length > 0 && (
            <section>
              <SectionTitle>Entities</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {d.entities.map((e, i) => (
                  <Badge key={i} tone="info">
                    {e.name}
                    <span className="opacity-60">· {e.type}</span>
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle>
              Text {d.char_count ? `· ${Math.round(d.char_count / 1000)}k chars` : ''}
            </SectionTitle>
            {d.chunks.length === 0 ? (
              <Card className="px-4 py-6 text-center text-[13px] text-muted">
                No extracted text for this file.
              </Card>
            ) : (
              <Card className="max-h-96 overflow-y-auto p-4">
                {d.chunks.map((chunk) => (
                  <div key={chunk.chunk_index} className="mb-4 last:mb-0">
                    {chunk.page_start !== null && (
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                        {chunk.page_start === chunk.page_end
                          ? `Page ${chunk.page_start}`
                          : `Pages ${chunk.page_start}–${chunk.page_end}`}
                      </div>
                    )}
                    <p className="selectable whitespace-pre-wrap text-[12px] leading-5 text-ink-2">
                      {chunk.content}
                    </p>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>

        {/* Right: metadata */}
        <div>
          <SectionTitle>File</SectionTitle>
          <Card className="divide-y divide-line text-[12px]">
            <MetaRow label="Filename" value={d.filename} />
            <MetaRow label="Path" value={d.path} mono />
            <MetaRow label="Size" value={formatBytes(d.size)} />
            <MetaRow label="Modified" value={`${formatDate(d.mtime)} (${timeAgo(d.mtime)})`} />
            <MetaRow label="Indexed" value={timeAgo(d.indexed_at)} />
            {d.content_hash && <MetaRow label="SHA-256" value={d.content_hash.slice(0, 16) + '…'} mono />}
          </Card>

          <SectionTitle
            right={
              d.ai_model ? (
                <Badge>{d.ai_model === 'revelio-local' ? 'analyzed locally' : d.ai_model}</Badge>
              ) : undefined
            }
          >
            <span className="mt-6 inline-block">AI analysis</span>
          </SectionTitle>
          <Card className="divide-y divide-line text-[12px]">
            <MetaRow
              label="Status"
              value={
                d.ai_status === 'ok'
                  ? 'complete'
                  : d.ai_status === 'pending'
                    ? 'running…'
                    : d.ai_status === 'skipped'
                      ? `skipped (${d.ai_error ?? 'n/a'})`
                      : d.ai_status === 'failed'
                        ? 'failed'
                        : 'not run'
              }
            />
            {d.doc_date && <MetaRow label="Document date" value={formatDate(d.doc_date)} />}
            {d.ai_error && d.ai_status === 'failed' && (
              <MetaRow label="Error" value={d.ai_error} />
            )}
            {d.ai_status !== 'ok' && d.ai_status !== 'pending' && (
              <div className="px-4 py-2.5 text-[11px] leading-4 text-faint">
                {d.ai_status === 'skipped' && d.ai_error === 'NO_TEXT'
                  ? 'Not enough extractable text in this file to analyze.'
                  : d.ai_status === 'skipped' && d.ai_error === 'AI_DISABLED'
                    ? 'Analysis is turned off — enable it in Settings.'
                    : 'Summaries, keywords, and auto-categorization are generated on this machine when the file is indexed. Use Re-analyze to run it now.'}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2">
      <span className="shrink-0 text-faint">{label}</span>
      <span
        className={`selectable min-w-0 break-all text-right text-ink-2 ${mono ? 'font-mono text-[11px]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

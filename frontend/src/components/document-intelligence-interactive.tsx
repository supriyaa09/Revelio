'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  CalendarClock,
  Clock,
  Hash,
  ScanLine,
  Sparkles,
  Tag,
} from 'lucide-react';
import { CopyButton } from '@/components/interactive-clipboard';
import { formatDateTime, stagger } from '@/components/ui';
import type { DocumentInsights, DocumentVersion } from '@/lib/types';

/** How long the analysis line takes to travel the panel. Matches `scan-down`. */
const SCAN_MS = 1800;

type Phase = 'sealed' | 'scanning' | 'revealed';

export function DocumentIntelligenceInteractive({
  current,
  insight,
}: {
  current: DocumentVersion | null;
  insight: DocumentInsights | null;
}) {
  /*
   * Nothing to reveal means nothing to gate: a document with no insight opens
   * straight into whatever it does have, rather than offering a button that
   * would uncover an empty panel.
   */
  const [phase, setPhase] = useState<Phase>(insight ? 'sealed' : 'revealed');

  if (!current || current.processing_status !== 'completed') {
    return null;
  }

  // Approximate reading time at 200 words per minute, five characters per word.
  const wordCount = Math.max(1, Math.round(current.char_count / 5));
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200));

  function reveal() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('revealed');
      return;
    }
    setPhase('scanning');
    window.setTimeout(() => setPhase('revealed'), SCAN_MS);
  }

  return (
    <div className="space-y-5">
      {/* ── What extraction found ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2/60 p-2.5 text-xs text-muted">
        <span className="flex items-center gap-1.5 font-mono">
          <Hash className="size-3.5 text-accent-ink" />
          <span className="font-semibold text-ink">{current.char_count.toLocaleString()}</span>
          chars
        </span>
        <span className="text-line-2">|</span>
        <span className="flex items-center gap-1.5 font-mono">
          <Clock className="size-3.5" />~{readingMinutes} min read
        </span>
        {current.page_count ? (
          <>
            <span className="text-line-2">|</span>
            <span className="flex items-center gap-1.5">
              <BookOpen className="size-3.5" />
              {current.page_count} page{current.page_count === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
        {current.extraction_method && (
          <>
            <span className="text-line-2">|</span>
            <span className="chip bg-surface px-1.5 py-0.5 text-[10px] text-ink-2 ring-1 ring-line">
              {current.extraction_method === 'text'
                ? 'Digital text layer'
                : current.extraction_method === 'ocr'
                  ? 'OCR'
                  : 'Hybrid'}
            </span>
          </>
        )}
      </div>

      {current.char_count === 0 && (
        <p className="rounded-md border border-warn-line bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
          No readable text extracted. Document remains indexed by title and user metadata.
        </p>
      )}

      {!insight ? (
        <p className="text-xs leading-relaxed text-muted">
          Text extracted successfully. No AI insight has been generated for this version.
        </p>
      ) : (
        <div className="relative">
          {/*
           * The findings, held behind ink that has not dried. Blurred rather
           * than hidden so the reader can see there is something there — a
           * button over an empty box promises nothing.
           */}
          <div
            className={
              phase === 'revealed'
                ? ''
                : 'select-none blur-[3px] transition-all duration-700 ease-[var(--ease-paper)]'
            }
            style={phase === 'revealed' ? undefined : { opacity: phase === 'scanning' ? 0.55 : 0.3 }}
            /* `inert` rather than only aria-hidden: the findings contain links,
               and a hidden subtree with tabbable children is a keyboard trap. */
            inert={phase !== 'revealed'}
          >
            <InsightBody insight={insight} revealed={phase === 'revealed'} />
          </div>

          {/* ── The analysis line ───────────────────────────────────────── */}
          {phase === 'scanning' && (
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <span
                className="animate-scan-once absolute inset-x-0 h-16"
                style={{
                  background:
                    'linear-gradient(to bottom, transparent, var(--accent-glow) 55%, var(--accent-line) 92%, transparent)',
                }}
              />
            </div>
          )}

          {/* ── The invitation ──────────────────────────────────────────── */}
          {phase !== 'revealed' && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <button
                  type="button"
                  onClick={reveal}
                  disabled={phase === 'scanning'}
                  className="btn-primary px-5 py-2.5 text-xs font-bold uppercase shadow-e2"
                  style={{ letterSpacing: '0.16em' }}
                >
                  {phase === 'scanning' ? (
                    <ScanLine className="size-4 animate-pulse" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {phase === 'scanning' ? 'Analyzing…' : 'Reveal insights'}
                </button>
                <p className="max-w-[16rem] text-[11px] leading-relaxed text-muted">
                  {phase === 'scanning'
                    ? 'Reading the extracted text for dates, entities and obligations.'
                    : `${insight.key_points.length} findings, ${insight.entities.length} entities and ${insight.important_dates.length} dates were extracted from this version.`}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The findings themselves.
 *
 * `revealed` only drives the entrance stagger — the content is identical either
 * way, so the gate above can render it blurred without a second code path.
 */
function InsightBody({
  insight,
  revealed,
}: {
  insight: DocumentInsights;
  revealed: boolean;
}) {
  /* Each section arrives one beat after the last, in reading order. */
  const enter = revealed ? 'rise-in' : '';

  return (
    <div className="space-y-5">
      {insight.summary && (
        <section className={`rounded-md border border-line bg-surface p-4 ${enter}`} style={stagger(0)}>
          <div className="flex items-center justify-between gap-2 pb-2">
            <h3 className="record-label flex items-center gap-1.5 text-accent-ink">
              <Sparkles className="size-3" />
              AI summary
            </h3>
            <CopyButton text={insight.summary} label="Summary" />
          </div>
          <p className="text-sm leading-relaxed text-ink-2">{insight.summary}</p>
        </section>
      )}

      {insight.key_points.length > 0 && (
        <section className={enter} style={stagger(3)}>
          <div className="flex items-center justify-between pb-2">
            <h3 className="record-label">Key information ({insight.key_points.length})</h3>
            <CopyButton
              text={insight.key_points.map((p, i) => `${i + 1}. ${p}`).join('\n')}
              label="All points"
            />
          </div>
          <ul className="space-y-2">
            {insight.key_points.map((point, i) => (
              <li
                key={i}
                className="group flex items-start justify-between gap-3 rounded-md border border-line
                           bg-surface p-3 text-xs leading-relaxed text-ink-2 transition-colors hover:bg-surface-2"
              >
                <span className="flex items-start gap-2.5">
                  {/* Numbered the way an annotation marker is numbered, so a
                      finding can be referred to out loud. */}
                  <span
                    className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-accent-soft
                               font-mono text-[9px] font-bold text-accent-ink ring-1 ring-inset ring-accent-line"
                  >
                    {i + 1}
                  </span>
                  <span>{point}</span>
                </span>
                <CopyButton
                  text={point}
                  label=""
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {insight.important_dates.length > 0 && (
        <section className={enter} style={stagger(6)}>
          <h3 className="record-label pb-2">Milestones &amp; dates</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {insight.important_dates.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface p-2.5 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CalendarClock className="size-3.5 shrink-0 text-accent-ink" />
                  <span className="font-mono text-xs font-semibold text-ink">{d.date}</span>
                  <span className="truncate text-muted">{d.label}</span>
                </span>
                {d.is_deadline && (
                  <span className="chip bg-warn-soft text-[10px] font-bold text-warn ring-1 ring-inset ring-warn-line">
                    Deadline
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {insight.entities.length > 0 && (
        <section className={enter} style={stagger(9)}>
          <h3 className="record-label pb-2">Identified entities · click to search</h3>
          <div className="flex flex-wrap gap-1.5">
            {insight.entities.map((e, i) => (
              <Link
                key={i}
                href={`/search?q=${encodeURIComponent(e.name)}`}
                title={`Search for "${e.name}" (${e.type})`}
                className="chip border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2
                           transition-all hover:border-accent-line hover:bg-accent-soft hover:text-accent-ink"
              >
                <Tag className="size-2.5 text-faint" />
                {e.name}
                <span className="text-[10px] text-faint">({e.type})</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {insight.model && (
        <p className="border-t border-line pt-2.5 text-[11px] text-faint">
          Generated by <span className="font-mono">{insight.model}</span> on{' '}
          {formatDateTime(insight.generated_at)}
        </p>
      )}
    </div>
  );
}

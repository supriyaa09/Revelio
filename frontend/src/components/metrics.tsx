'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

/*
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The counters need to reset to zero before the browser paints, otherwise the
 * server's final figure flashes for a frame before the count-up starts. React
 * warns about layout effects during SSR, hence the swap rather than a guard.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Count-up duration. Long enough to read as counting, short enough to ignore. */
const COUNT_MS = 900;

/**
 * A number that counts up to its value on first paint.
 *
 * Renders the true figure during SSR so a crawler — or a reader with JavaScript
 * off — sees the fact rather than a zero.
 */
export function CountUp({
  value,
  format = (n) => n.toLocaleString(),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const frame = useRef<number | null>(null);

  useIsoLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || value === 0) {
      setShown(value);
      return;
    }

    setShown(0);
    // Anchored to the first animation frame rather than to `Date.now()` at
    // effect time, so a slow hydration does not skip the animation entirely.
    let start: number | null = null;

    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / COUNT_MS);
      // Ease-out cubic: fast off the mark, settling into the final figure.
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame.current = window.requestAnimationFrame(step);
    };

    frame.current = window.requestAnimationFrame(step);
    return () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, [value]);

  return (
    <span className={clsx('tabular-nums', className)} suppressHydrationWarning>
      {format(shown)}
    </span>
  );
}

export type MetricTone = 'accent' | 'ok' | 'warn' | 'info' | 'tier1' | 'tier2';

const TONES: Record<MetricTone, string> = {
  accent: 'text-accent-ink bg-accent-soft ring-accent-line',
  ok: 'text-ok bg-ok-soft ring-ok-line',
  warn: 'text-warn bg-warn-soft ring-warn-line',
  info: 'text-info bg-info-soft ring-info-line',
  tier1: 'text-tier1 bg-tier1-soft ring-tier1-line',
  tier2: 'text-tier2 bg-tier2-soft ring-tier2-line',
};

/**
 * One headline figure.
 *
 * Becomes a link when `href` is given, because a number a reader wants to act on
 * should be the thing they click — not a number beside a button.
 */
export function KpiCard({
  label,
  value,
  format,
  detail,
  icon: Icon,
  tone = 'accent',
  href,
  index = 0,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  detail?: string;
  icon: LucideIcon;
  tone?: MetricTone;
  href?: string;
  index?: number;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="record-label">{label}</p>
        <span
          className={clsx(
            'grid size-7 shrink-0 place-items-center rounded-sm ring-1 ring-inset',
            TONES[tone],
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>

      <p className="display mt-3 text-3xl leading-none text-ink">
        <CountUp value={value} format={format} />
      </p>
      {detail && <p className="mt-2 text-[11px] leading-tight text-muted">{detail}</p>}
    </>
  );

  const shell = clsx(
    'card settle-in block p-4 transition-all duration-200',
    href && 'hover:-translate-y-0.5 hover:border-line-2 hover:shadow-e2',
  );

  return href ? (
    <Link href={href} className={shell} style={{ '--i': index } as React.CSSProperties}>
      {body}
    </Link>
  ) : (
    <div className={shell} style={{ '--i': index } as React.CSSProperties}>
      {body}
    </div>
  );
}

/**
 * Time-of-day greeting.
 *
 * The clock has to be the reader's, not the server's — a deployment in another
 * timezone would otherwise wish everyone good morning at dinner. The name is
 * rendered on both sides so nothing reflows; only the salutation arrives late.
 */
export function Greeting({ name }: { name: string }) {
  const [salutation, setSalutation] = useState<string | null>(null);

  useEffect(() => {
    const h = new Date().getHours();
    setSalutation(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  return (
    <>
      {salutation && <span className="animate-fade">{salutation}, </span>}
      {name}
    </>
  );
}

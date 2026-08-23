'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { formatBytes } from './ui';

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

export type NumberFormat = 'number' | 'bytes';

/**
 * Formatters are resolved here from a name rather than accepted as a prop,
 * because a function cannot cross the server/client boundary — a Server
 * Component can only hand this component plain data. Callers name a format;
 * this module owns the mapping.
 */
const FORMATTERS: Record<NumberFormat, (n: number) => string> = {
  number: (n) => n.toLocaleString(),
  bytes: formatBytes,
};

/**
 * A number that counts up to its value on first paint.
 *
 * Renders the true figure during SSR so a crawler — or a reader with JavaScript
 * off — sees the fact rather than a zero.
 */
export function CountUp({
  value,
  format = 'number',
  className,
}: {
  value: number;
  format?: NumberFormat;
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
      {FORMATTERS[format](shown)}
    </span>
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

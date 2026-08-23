'use client';

import { useEffect, useMemo, useState } from 'react';
import { RevelioIcon } from '@/components/logo';

/** Once per browser session. Judges see it; nobody sits through it twice. */
const SEEN_KEY = 'revelio.intro.seen';

/*
 * The scraps that converge into the mark: document corners, rules of body text,
 * dots, and metadata ticks. Positions are deterministic rather than random so
 * the sequence composes the same way every time — and so the server and client
 * render identical markup.
 *
 * `x`/`y` are the starting offset from centre in rem; `r` the starting tilt;
 * `d` the delay in ms; `w`/`h` the shape in rem.
 */
const FRAGMENTS = [
  { x: -18, y: -9, r: -24, d: 0, w: 2.4, h: 0.2, kind: 'rule' },
  { x: 16, y: -12, r: 31, d: 60, w: 1.6, h: 0.2, kind: 'rule' },
  { x: -22, y: 6, r: 12, d: 120, w: 3, h: 0.2, kind: 'rule' },
  { x: 21, y: 8, r: -18, d: 180, w: 2, h: 0.2, kind: 'rule' },
  { x: -9, y: -16, r: 44, d: 240, w: 1.2, h: 0.2, kind: 'rule' },
  { x: 8, y: 15, r: -37, d: 300, w: 2.6, h: 0.2, kind: 'rule' },
  { x: -26, y: -3, r: 8, d: 90, w: 1.1, h: 1.4, kind: 'corner' },
  { x: 24, y: -6, r: -14, d: 210, w: 0.9, h: 1.2, kind: 'corner' },
  { x: -13, y: 13, r: 26, d: 330, w: 1.3, h: 1.6, kind: 'corner' },
  { x: 13, y: -18, r: -9, d: 150, w: 1, h: 1.3, kind: 'corner' },
  { x: -6, y: 18, r: 0, d: 270, w: 0.3, h: 0.3, kind: 'dot' },
  { x: 19, y: 2, r: 0, d: 30, w: 0.35, h: 0.35, kind: 'dot' },
  { x: -20, y: -13, r: 0, d: 360, w: 0.28, h: 0.28, kind: 'dot' },
  { x: 5, y: -21, r: 0, d: 390, w: 0.32, h: 0.32, kind: 'dot' },
] as const;

/**
 * The Revelio opening: scraps of paper drift in, converge, and become the mark,
 * which then settles and inks its wordmark.
 *
 * Built on CSS keyframes rather than a motion library — the whole sequence is
 * declarative and time-based, so a runtime animation engine would add a
 * dependency and a hydration cost to do less.
 */
export function LogoReveal({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    // A user who has asked for less motion gets the destination, not the trip.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(onDone, reduced ? 120 : 3000);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-100 grid place-items-center overflow-hidden bg-paper"
      role="status"
      aria-label="Revelio is starting"
    >
      {/* ── Scene 01 — fragments ─────────────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
        {FRAGMENTS.map((f, i) => (
          <span
            key={i}
            className="converge-in absolute"
            style={{
              ['--tx' as string]: `${f.x}rem`,
              ['--ty' as string]: `${f.y}rem`,
              ['--r' as string]: `${f.r}deg`,
              ['--d' as string]: f.d,
              width: `${f.w}rem`,
              height: `${f.h}rem`,
              backgroundColor:
                f.kind === 'corner' ? 'var(--surface)' : f.kind === 'dot' ? 'var(--accent-line)' : 'var(--line-2)',
              border: f.kind === 'corner' ? '1px solid var(--line-2)' : undefined,
              borderRadius: f.kind === 'dot' ? '999px' : f.kind === 'rule' ? '999px' : '2px',
              // The corners carry a real dog-ear, so even at 1rem they read as
              // pieces of a document rather than as confetti.
              clipPath:
                f.kind === 'corner' ? 'polygon(0 0, 65% 0, 100% 32%, 100% 100%, 0 100%)' : undefined,
            }}
          />
        ))}
      </div>

      {/* ── Scene 02 — the mark forms ────────────────────────────────────── */}
      {/* Delays go inline: `animate-*` sets the `animation` shorthand, which
          would reset a delay declared in a competing class. */}
      <div className="relative flex flex-col items-center">
        <RevelioIcon className="size-24 animate-settle" style={{ animationDelay: '900ms' }} />

        {/* ── Scene 03 — wordmark and promise ───────────────────────────── */}
        <h1
          className="display mt-7 animate-ink text-4xl font-semibold text-ink sm:text-5xl"
          style={{ letterSpacing: '0.28em', textIndent: '0.28em', animationDelay: '1500ms' }}
        >
          REVELIO
        </h1>
        <p
          className="mt-4 animate-fade text-[10px] font-bold uppercase text-muted"
          style={{ letterSpacing: '0.34em', textIndent: '0.34em', animationDelay: '2050ms' }}
        >
          Reveal. Organize. Intelligently.
        </p>

        {/* A hairline drawing itself under the lockup, as a rule is ruled. */}
        <span
          aria-hidden
          className="mt-6 h-px w-40 origin-left animate-grow-x bg-line-2"
          style={{ animationDelay: '2300ms' }}
        />
      </div>

      <button
        type="button"
        onClick={onDone}
        className="absolute bottom-8 right-8 animate-fade text-[10px] font-bold uppercase
                   tracking-[0.2em] text-faint transition-colors hover:text-ink"
        style={{ animationDelay: '1200ms' }}
      >
        Skip
      </button>
    </div>
  );
}

/**
 * Wraps a screen so the intro plays before it, once per session.
 *
 * The children are always mounted underneath — the overlay covers them rather
 * than replacing them, so the form behind is already hydrated and focusable the
 * instant the curtain lifts.
 */
export function IntroGate({ children }: { children: React.ReactNode }) {
  // `null` means "not yet decided": sessionStorage is unavailable during SSR, so
  // rendering the overlay before that check would flash it for returning users.
  const [showIntro, setShowIntro] = useState<boolean | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Private-mode browsers throw on sessionStorage. Play the intro; it is
      // three seconds, not a broken page.
    }
    setShowIntro(!seen);
  }, []);

  const dismiss = useMemo(
    () => () => {
      try {
        window.sessionStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* see above */
      }
      setShowIntro(false);
    },
    [],
  );

  return (
    <>
      {children}
      {showIntro === true && <LogoReveal onDone={dismiss} />}
    </>
  );
}

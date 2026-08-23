'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createPortal } from 'react-dom';
import { ErrorNote } from '@/components/ui';
import { Stamp } from '@/components/stamp';

/**
 * The four beats of authentication, in order.
 *
 * Modelled as a state machine rather than a pile of booleans because the button
 * label, the field lock, the stamp, and the navigation all read from it — and
 * because "verified but not yet granted" is a real state the user sees.
 */
type Phase = 'idle' | 'verifying' | 'verified' | 'granted';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Verify & Access',
  verifying: 'Verifying identity…',
  verified: 'Identity verified',
  granted: 'Access granted',
};

/** How long each post-success beat is held, in ms. Long enough to read. */
const HOLD_VERIFIED = 620;
const HOLD_GRANTED = 1100;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [, startTransition] = useTransition();

  /*
   * The record's own identifier. Filled after mount: it depends on today's date,
   * and computing it during render would make the server's HTML disagree with
   * the client's on the first paint of a statically-rendered page.
   */
  const [documentId, setDocumentId] = useState<string | null>(null);
  useEffect(() => {
    const now = new Date();
    const stamp = `${now.getMonth() + 1}`.padStart(2, '0') + `${now.getDate()}`.padStart(2, '0');
    setDocumentId(`RV-${now.getFullYear()}-${stamp}`);
  }, []);

  // Timers scheduled during the success sequence, cleared if the component goes
  // away first — otherwise a fast unmount leaves a setState pointed at nothing.
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  // Institution recognition derived from the email domain.
  const recognizedInstitution = (() => {
    if (!email.includes('@')) return null;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    if (domain.includes('sreenidhi') || domain.includes('snist')) {
      return 'Sreenidhi Institute of Science & Technology';
    }
    if (domain.includes('.edu') || domain.includes('.ac.')) return 'Recognized institutional campus';
    return 'Institutional organization';
  })();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase('verifying');

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setPhase('idle');
      setError(authError.message);
      return;
    }

    // Credentials are already good at this point; the remaining beats are the
    // seal being applied, not work being done. They are deliberately short.
    const next = params.get('next') || '/workspace';
    setPhase('verified');
    timers.current.push(
      window.setTimeout(() => setPhase('granted'), HOLD_VERIFIED),
      window.setTimeout(() => {
        startTransition(() => {
          router.push(next);
          router.refresh();
        });
      }, HOLD_VERIFIED + HOLD_GRANTED),
    );
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword('password123');
  }

  const busy = phase !== 'idle';
  /** Grows as the field fills — the "subtle verification line" under password. */
  const strength = Math.min(1, password.length / 12);

  return (
    <form onSubmit={onSubmit} className="relative">
      {/* ── Record heading ──────────────────────────────────────────────── */}
      <header className="border-b border-line pb-5 text-center">
        <span aria-hidden className="mx-auto mb-4 block h-px w-16 bg-accent-line" />
        <h1
          className="display text-xl font-semibold text-ink sm:text-2xl"
          style={{ letterSpacing: '0.1em' }}
        >
          REVELIO ACCESS DOCUMENT
        </h1>
        <p className="record-label mt-2">Institutional Access Record</p>

        <dl className="mt-4 flex items-center justify-center gap-x-6 gap-y-1 text-[10px]">
          <div className="flex items-center gap-1.5">
            <dt className="record-label">Document ID</dt>
            <dd className="font-mono font-semibold tabular-nums text-ink-2">
              {documentId ?? '—'}
            </dd>
          </div>
          <div className="hidden items-center gap-1.5 sm:flex">
            <dt className="record-label">Classification</dt>
            <dd className="font-mono font-semibold text-ink-2">RESTRICTED</dd>
          </div>
        </dl>
      </header>

      {/* ── Ruled fields ────────────────────────────────────────────────── */}
      <div className="space-y-6 py-7">
        <div>
          <label htmlFor="email" className="record-label">
            Institutional Email / ID
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            disabled={busy}
            className="input-ruled mt-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@institution.edu"
          />
          {recognizedInstitution && (
            <p className="mt-2 flex animate-fade items-center gap-1.5 text-[11px] font-medium text-ok">
              <CheckCircle2 className="size-3.5 shrink-0" />
              Institution recognized · {recognizedInstitution}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="record-label">
              Password
            </label>
            <button
              type="button"
              onClick={() =>
                setError('Contact your institutional administrator to reset your password.')
              }
              className="text-[10px] font-medium text-muted transition-colors hover:text-accent-ink"
            >
              Forgot password?
            </button>
          </div>

          <div className="relative mt-1.5 flex items-center">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              disabled={busy}
              className="input-ruled pr-8"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 text-muted transition-colors hover:text-ink"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {/* The verification line: it draws itself along the rule as the field
              fills, so the form acknowledges input without judging it. */}
          <span aria-hidden className="mt-px block h-[1.5px] w-full overflow-hidden">
            <span
              className="block h-full origin-left bg-accent transition-transform duration-300 ease-[var(--ease-paper)]"
              style={{ transform: `scaleX(${strength})` }}
            />
          </span>
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] text-muted">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="size-3.5 rounded-sm border-line-2 text-accent focus:ring-accent"
            />
            <span>Remember me</span>
          </label>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-ok" />
            Single sign-on ready
          </span>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
      </div>

      {/* ── Authorisation ───────────────────────────────────────────────── */}
      <div className="border-t border-line pt-6">
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full py-3 text-xs font-bold uppercase"
          style={{ letterSpacing: '0.16em' }}
        >
          {phase === 'verifying' && <Loader2 className="size-4 animate-spin" />}
          {phase === 'verified' && <CheckCircle2 className="size-4" />}
          {PHASE_LABEL[phase]}
          {phase === 'idle' && <ArrowRight className="size-4" />}
        </button>

        <div className="relative flex items-center justify-center py-5">
          <span className="w-full border-t border-line" />
          <span className="record-label absolute bg-surface px-3">Demo access</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fillDemo('faculty@revelio.edu')}
            className="btn-secondary py-1.5 text-[11px]"
          >
            <span className="size-1.5 rounded-full bg-tier1" />
            Faculty
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fillDemo('student@revelio.edu')}
            className="btn-secondary py-1.5 text-[11px]"
          >
            <span className="size-1.5 rounded-full bg-ok" />
            Student
          </button>
        </div>

        <p className="record-label mt-6 text-center text-[9px]">
          Secure · Encrypted · Verified
        </p>
      </div>

      {/* ── The seal ────────────────────────────────────────────────────── */}
      {phase === 'granted' && (
        <div className="pointer-events-none absolute -right-2 bottom-16 sm:-right-6">
          <Stamp label="Access Approved" tone="seal" sublabel={documentId ?? undefined} rotate={-11} />
        </div>
      )}

      {/* The unfold to the workspace begins here: an ivory veil closes over the
          record so the dashboard can open out of it on the next route. */}
      {phase === 'granted' && <AccessVeil />}
    </form>
  );
}

/**
 * A full-screen ivory wash that fades up once access is granted.
 *
 * Rendered into `document.body` rather than into the form so the sheet's own
 * `overflow` and stacking context cannot clip it — the veil has to cover the
 * whole viewport for the workspace to appear to unfold out of the document.
 */
function AccessVeil() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  if (!host) return null;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-90 animate-fade bg-paper"
      style={{ animationDuration: '900ms', animationDelay: '380ms' }}
    />,
    host,
  );
}

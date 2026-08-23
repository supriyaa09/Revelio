'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { GraduationCap, Layers, Lock, Shield, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { IntroGate } from '@/components/logo-reveal';
import { ThemeToggle } from '@/components/theme-toggle';

const ROLES = [
  {
    id: 'student',
    title: 'Student',
    tagline: 'Submit documents, track requests and approvals.',
    icon: GraduationCap,
    badgeClass: 'bg-ok-soft text-ok ring-ok-line',
    features: ['Upload documents', 'Track requests', 'View approvals'],
  },
  {
    id: 'faculty',
    title: 'Faculty',
    tagline: 'Review, comment and route documents onward.',
    icon: UserCheck,
    badgeClass: 'bg-tier1-soft text-tier1 ring-tier1-line',
    features: ['Review documents', 'Comment', 'Route to HOD'],
  },
  {
    id: 'hod',
    title: 'HOD / Dean',
    tagline: 'Hold final sign-off and see the whole audit trail.',
    icon: Shield,
    badgeClass: 'bg-tier2-soft text-tier2 ring-tier2-line',
    features: ['Approve or reject', 'Audit trails', 'Departmental view'],
  },
];

const ASSURANCES = [
  { icon: ShieldCheck, label: 'Secure', detail: 'Row-level access control' },
  { icon: Sparkles, label: 'Smart', detail: 'OCR and AI extraction' },
  { icon: Layers, label: 'Auditable', detail: 'Every action recorded' },
  { icon: Lock, label: 'Compliant', detail: 'Institutional standards' },
];

/*
 * Ambient scraps on the desk behind the record. Positions are literals so the
 * composition is designed rather than random — and so SSR and the client agree.
 */
const SCRAPS: {
  top: string;
  left?: string;
  right?: string;
  w: string;
  h: string;
  r: number;
  d: string;
}[] = [
  { top: '12%', left: '8%', w: '3.5rem', h: '4.5rem', r: -9, d: '0s' },
  { top: '68%', left: '5%', w: '2.75rem', h: '3.5rem', r: 7, d: '1.4s' },
  { top: '22%', right: '7%', w: '3rem', h: '4rem', r: 11, d: '2.6s' },
  { top: '72%', right: '11%', w: '2.25rem', h: '3rem', r: -6, d: '3.8s' },
];

/**
 * The authentication surface.
 *
 * The record itself is the only thing in the optical centre — everything else
 * (what the roles mean, what the platform guarantees) sits deliberately below
 * the fold of attention, because a person arriving here came to sign in.
 */
export function AuthShell({
  children,
  isSignup = false,
}: {
  children: React.ReactNode;
  isSignup?: boolean;
}) {
  const [selectedRole, setSelectedRole] = useState('student');

  return (
    <IntroGate>
      <div className="relative min-h-screen overflow-hidden bg-paper text-ink">
        {/* Desk scraps. Hidden below lg: on a phone they crowd the record. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
          {SCRAPS.map((s, i) => (
            <span
              key={i}
              className="absolute animate-drift rounded-sm border border-line bg-surface opacity-60 shadow-e1"
              style={{
                top: s.top,
                left: s.left,
                right: s.right,
                width: s.w,
                height: s.h,
                transform: `rotate(${s.r}deg)`,
                animationDelay: s.d,
              }}
            />
          ))}
        </div>

        <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-6 sm:px-8">
          {/* ── Masthead ─────────────────────────────────────────────────── */}
          <header className="flex items-center justify-between">
            <Link href="/" className="transition-opacity hover:opacity-80">
              <Logo size="sm" />
            </Link>
            <div className="flex items-center gap-2">
              <span className="record-label hidden sm:block">English (US)</span>
              <ThemeToggle />
            </div>
          </header>

          {/* ── The record ───────────────────────────────────────────────── */}
          <main className="flex flex-1 flex-col items-center justify-center py-10">
            <div className="paper unfold-in w-full max-w-lg px-6 py-8 sm:px-10 sm:py-10">
              {children}
            </div>

            {/* ── Access levels ──────────────────────────────────────────── */}
            <section className="mt-12 w-full max-w-lg">
              <div className="flex items-baseline justify-between">
                <h2 className="record-label">Access levels</h2>
                <span className="text-[10px] text-faint">Assigned by your institution</span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {ROLES.map((r, i) => {
                  const Icon = r.icon;
                  const active = selectedRole === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRole(r.id)}
                      aria-pressed={active}
                      style={{ '--i': i } as React.CSSProperties}
                      className={`settle-in flex flex-col rounded-md border p-3 text-left transition-all duration-200 ${
                        active
                          ? 'border-accent-line bg-accent-soft shadow-e1'
                          : 'border-line bg-surface/70 hover:border-line-2 hover:bg-surface'
                      }`}
                    >
                      <span
                        className={`mb-2.5 grid size-7 place-items-center rounded-md ring-1 ring-inset ${r.badgeClass}`}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="text-xs font-semibold text-ink">{r.title}</span>
                      <span className="mt-1 text-[11px] leading-snug text-muted">{r.tagline}</span>

                      {/* Only the open card lists its capabilities — three lists
                          at once is a wall, and the point of the row is choice. */}
                      {active && (
                        <span className="mt-2.5 block space-y-1 border-t border-accent-line/60 pt-2">
                          {r.features.map((f) => (
                            <span
                              key={f}
                              className="fade-in block text-[10px] font-medium text-ink-2"
                            >
                              · {f}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── Assurances ─────────────────────────────────────────────── */}
            <section className="mt-6 grid w-full max-w-lg grid-cols-2 gap-x-5 gap-y-3 border-t border-line pt-5 sm:grid-cols-4">
              {ASSURANCES.map(({ icon: Icon, label, detail }) => (
                <div key={label} className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-accent-ink" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-ink">{label}</div>
                    <div className="text-[10px] leading-tight text-muted">{detail}</div>
                  </div>
                </div>
              ))}
            </section>
          </main>

          {/* ── Colophon ─────────────────────────────────────────────────── */}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11px] text-muted">
            <span>
              {isSignup ? 'Already have an account? ' : 'New to Revelio? '}
              <Link href={isSignup ? '/login' : '/signup'} className="link">
                {isSignup ? 'Sign in' : 'Request access'}
              </Link>
            </span>
            <span className="flex items-center gap-3 text-[10px]">
              <Link href="/privacy" className="transition-colors hover:text-ink">
                Privacy
              </Link>
              <span className="text-line-2">·</span>
              <Link href="/terms" className="transition-colors hover:text-ink">
                Terms
              </Link>
            </span>
          </footer>
        </div>
      </div>
    </IntroGate>
  );
}

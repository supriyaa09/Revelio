'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, Loader2, Mail, MailCheck, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ErrorNote } from '@/components/ui';

export function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setCreating(true);
    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (authError) {
      setCreating(false);
      setError(authError.message);
      return;
    }

    if (!data.session) {
      setCreating(false);
      setNotice('Check your inbox to confirm your email, then sign in.');
      return;
    }

    startTransition(() => {
      router.push('/workspace');
      router.refresh();
    });
  }

  const busy = pending || creating;
  const strong = password.length >= 8;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-ink">Create account</h2>
        <p className="mt-1 text-xs text-muted">Join your institutional Revelio workspace</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="fullName" className="label text-xs font-semibold text-ink-2">
          Full name
        </label>
        <input
          id="fullName"
          required
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. S. Sohail Ahmed"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="label text-xs font-semibold text-ink-2">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@university.edu"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="label text-xs font-semibold text-ink-2">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Create a strong password"
        />
        {/* Animated strength indicator */}
        <div className="flex items-center gap-2 pt-1">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3 ring-1 ring-inset ring-line">
            <span
              className={`block h-full rounded-full transition-all duration-300 ${
                strong ? 'bg-ok' : 'bg-warn'
              }`}
              style={{ width: `${Math.min(100, (password.length / 8) * 100)}%` }}
            />
          </span>
          <span className={`text-[11px] font-medium ${strong ? 'text-ok' : 'text-muted'}`}>
            {strong ? 'Secure length' : 'At least 8 characters'}
          </span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <p className="flex items-start gap-2 rounded-xl border border-info-line bg-info-soft px-3.5 py-2.5 text-xs leading-relaxed text-info">
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          {notice}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="btn w-full bg-accent text-accent-on py-2.5 font-semibold shadow-xs hover:bg-accent-hover active:scale-[0.99] transition-all"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {busy ? 'Creating account…' : 'Create Revelio Account'}
        {!busy && <ArrowRight className="size-4" />}
      </button>

      <p className="text-[11px] leading-relaxed text-muted pt-1">
        New accounts are provisioned with the <strong className="font-semibold text-ink">Student</strong> role.
        Faculty and HOD elevated permissions are governed by department administrators.
      </p>
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    const supabase = createClient();
    // full_name is passed as user metadata and read by the handle_new_user
    // trigger. Role is never accepted from the client — it defaults to staff.
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (authError) {
      setError(authError.message);
      return;
    }

    if (!data.session) {
      setNotice('Check your inbox to confirm your email, then sign in.');
      return;
    }

    startTransition(() => {
      router.push('/workspace');
      router.refresh();
    });
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-600 text-white">
            <FileText className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div className="space-y-1.5">
            <label htmlFor="fullName" className="label">
              Full name
            </label>
            <input
              id="fullName"
              required
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Asha Menon"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="label">
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
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="label">
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
            />
            <p className="text-xs text-slate-500">At least 8 characters.</p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{notice}</p>
          )}

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Create account
          </button>

          <p className="text-xs text-slate-500">
            New accounts start with the <strong>Staff</strong> role. An administrator assigns
            reviewer or approver roles.
          </p>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already registered?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

import { Suspense } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-600 text-white">
            <FileText className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in to Revelio</h1>
            <p className="mt-1 text-sm text-slate-500">Institutional document intelligence</p>
          </div>
        </div>

        {/* useSearchParams() in LoginForm requires a Suspense boundary. */}
        <Suspense fallback={<div className="card h-64 animate-pulse bg-white" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-4 text-center text-sm text-slate-500">
          No account?{' '}
          <Link href="/signup" className="font-medium text-brand-600 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}

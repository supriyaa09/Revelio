import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

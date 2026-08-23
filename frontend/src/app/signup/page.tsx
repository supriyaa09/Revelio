import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from '@/components/signup-form';

export default function SignupPage() {
  return (
    <AuthShell isSignup>
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
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}

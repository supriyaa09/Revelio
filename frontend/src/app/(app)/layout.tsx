import { requireSession } from '@/lib/auth';
import { AppSidebar } from '@/components/app-sidebar';
import { UserMenu } from '@/components/user-menu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Redirects to /login when unauthenticated, so every child can assume a user.
  const { profile, email } = await requireSession();

  return (
    <div className="flex min-h-screen">
      <AppSidebar role={profile.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
          <div className="text-sm text-slate-500">Institutional document workspace</div>
          <UserMenu fullName={profile.full_name} email={email} role={profile.role} />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

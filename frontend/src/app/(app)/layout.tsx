import { requireSession } from '@/lib/auth';
import { AppSidebar, MobileNav } from '@/components/app-sidebar';
import { UserMenu } from '@/components/user-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { CommandPalette } from '@/components/command-palette';
import { PageTransition } from '@/components/page-transition';
import { KeyboardShortcutsModal } from '@/components/keyboard-shortcuts-modal';
import { Logo } from '@/components/logo';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, email } = await requireSession();

  return (
    <div className="flex min-h-screen bg-paper">
      <AppSidebar role={profile.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line
                     bg-surface/80 px-4 backdrop-blur-md sm:px-6 shadow-xs"
        >
          {/* Wordmark on mobile */}
          <span className="flex items-center gap-2 md:hidden">
            <Logo size="sm" showSubtitle={false} />
          </span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <CommandPalette role={profile.role} />
            <KeyboardShortcutsModal />
            <ThemeToggle />
            <span className="mx-0.5 hidden h-4 w-px bg-line sm:block" />
            <UserMenu fullName={profile.full_name} email={email} role={profile.role} />
          </div>
        </header>

        <main className="relative flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <PageTransition>{children}</PageTransition>
        </main>

        <MobileNav role={profile.role} />
      </div>
    </div>
  );
}

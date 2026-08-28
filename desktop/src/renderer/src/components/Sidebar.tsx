/**
 * App shell sidebar: the one dark surface. Navigation, live indexing status,
 * theme toggle.
 */

import { FolderOpen, LayoutDashboard, Moon, Search, Settings, Sparkles, Sun, Tags } from 'lucide-react';
import clsx from 'clsx';
import type { IndexProgress } from '@shared/types';
import type { View } from '../lib/nav';
import { Kbd } from './ui';

const NAV_ITEMS: { key: View['name']; label: string; icon: typeof Search; view: View }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, view: { name: 'dashboard' } },
  { key: 'search', label: 'Search', icon: Search, view: { name: 'search' } },
  { key: 'categories', label: 'Categories', icon: Tags, view: { name: 'categories' } },
  { key: 'folders', label: 'Folders', icon: FolderOpen, view: { name: 'folders' } },
  { key: 'settings', label: 'Settings', icon: Settings, view: { name: 'settings' } },
];

export function Sidebar({
  view,
  onNavigate,
  progress,
  dark,
  onToggleDark,
}: {
  view: View;
  onNavigate: (view: View) => void;
  progress: IndexProgress | null;
  dark: boolean;
  onToggleDark: () => void;
}) {
  const activeKey = view.name === 'document' ? 'search' : view.name;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-nav-line bg-nav text-nav-ink">
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <Sparkles className="size-4 text-accent-line" />
        <span className="text-[15px] font-semibold tracking-tight">Revelio</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map(({ key, label, icon: Icon, view: target }) => (
          <button
            key={key}
            onClick={() => onNavigate(target)}
            className={clsx(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-75 cursor-pointer',
              activeKey === key
                ? 'bg-nav-active text-nav-ink font-medium'
                : 'text-nav-muted hover:bg-nav-active/50 hover:text-nav-ink',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 text-left">{label}</span>
            {key === 'search' && <Kbd>⌘K</Kbd>}
          </button>
        ))}
      </nav>

      <div className="mt-auto px-4 pb-4">
        {progress?.active && (
          <div className="mb-3 rounded-md border border-nav-line bg-nav-active/40 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-nav-muted">
              <span className="truncate">
                {progress.current ? `Indexing ${progress.current}` : 'Indexing…'}
              </span>
              <span className="ml-2 shrink-0 tabular-nums">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-nav-line">
              <div
                className="h-full rounded-full bg-accent-line transition-[width] duration-300"
                style={{
                  width: `${progress.total > 0 ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        <button
          onClick={onToggleDark}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-nav-muted transition-colors hover:bg-nav-active/50 hover:text-nav-ink cursor-pointer"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </aside>
  );
}

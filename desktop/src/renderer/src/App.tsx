/**
 * App shell: sidebar + state-based routing. No router — one window, six views.
 *
 * Owns the cross-cutting state every page reads from:
 * - live indexing progress (main → renderer events),
 * - the data-version counter that tells pages when to refetch,
 * - dark mode (class on <html>, persisted to localStorage),
 * - the ⌘K / Ctrl+K shortcut that jumps to search from anywhere.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IndexProgress } from '@shared/types';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { SearchPage } from './pages/Search';
import { DocumentDetail } from './pages/DocumentDetail';
import { Categories } from './pages/Categories';
import { Folders } from './pages/Folders';
import { SettingsPage } from './pages/Settings';
import type { View } from './lib/nav';

const DARK_KEY = 'revelio-dark';

export default function App() {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [dark, setDark] = useState(() => localStorage.getItem(DARK_KEY) === '1');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Main-process events: progress ticker + "data changed, refetch" pings.
  useEffect(() => {
    return window.api.onEvent((event) => {
      if (event.type === 'index:progress') {
        setProgress(event.progress);
      } else if (event.type === 'index:finished') {
        setProgress(null);
        setDataVersion((v) => v + 1);
      } else if (event.type === 'files:changed') {
        setDataVersion((v) => v + 1);
      }
    });
  }, []);

  // Dark mode: `.dark` class on <html> drives the CSS custom-variant tokens.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(DARK_KEY, dark ? '1' : '0');
  }, [dark]);

  const focusSearch = () => {
    // Wait a frame so SearchPage has mounted and attached the ref.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const navigate = useCallback((next: View) => {
    setView(next);
    if (next.name === 'search') focusSearch();
  }, []);

  // ⌘K / Ctrl+K: jump to search without losing an in-progress query.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setView((v) => (v.name === 'search' ? v : { name: 'search' }));
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink">
      <Sidebar
        view={view}
        onNavigate={navigate}
        progress={progress}
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
      />

      <main className="min-w-0 flex-1">
        {view.name === 'dashboard' && (
          <Dashboard dataVersion={dataVersion} progress={progress} onNavigate={navigate} />
        )}
        {view.name === 'search' && (
          <SearchPage
            key={view.query ?? ''}
            initialQuery={view.query}
            onNavigate={navigate}
            inputRef={searchInputRef}
          />
        )}
        {view.name === 'document' && (
          <DocumentDetail id={view.id} from={view.from} onNavigate={navigate} />
        )}
        {view.name === 'categories' && (
          <Categories dataVersion={dataVersion} onNavigate={navigate} />
        )}
        {view.name === 'folders' && <Folders dataVersion={dataVersion} />}
        {view.name === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

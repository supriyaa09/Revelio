'use client';

import { useEffect, useState } from 'react';
import { Command, HelpCircle, Keyboard, X } from 'lucide-react';

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const el = document.activeElement;
        const typing =
          el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setOpen((prev) => !prev);
        }
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const shortcuts = [
    { key: '⌘ + K', desc: 'Open command palette & quick jump' },
    { key: '/', desc: 'Quick focus search field' },
    { key: '?', desc: 'Toggle keyboard shortcuts reference' },
    { key: 'ESC', desc: 'Dismiss active dialogs & menus' },
    { key: '↑ / ↓', desc: 'Navigate search & list results' },
    { key: 'Enter', desc: 'Open highlighted document' },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (?)"
        className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Keyboard className="size-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard Shortcuts"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0 bg-ink/50 transition-opacity"
            onClick={() => setOpen(false)}
          />

          <div className="relative w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-e3 animate-pop">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2 font-semibold text-sm text-ink">
                <Command className="size-4 text-accent" />
                Keyboard Shortcuts
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {shortcuts.map(({ key, desc }) => (
                <div key={key} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-muted">{desc}</span>
                  <kbd className="rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-semibold text-ink">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-line pt-3 text-center text-[11px] text-faint">
              Press <kbd className="font-mono rounded border border-line px-1">?</kbd> anywhere to toggle this panel.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

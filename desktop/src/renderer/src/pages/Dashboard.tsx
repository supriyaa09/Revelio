/**
 * Dashboard: library pulse at a glance — counts, live indexing progress,
 * recent files, and the category shelf.
 */

import { useEffect, useState } from 'react';
import { FolderOpen, FolderSearch, Search } from 'lucide-react';
import type { IndexProgress, Stats } from '@shared/types';
import { Badge, Button, Card, EmptyState, ErrorState, ProgressBar, SectionTitle } from '../components/ui';
import { FileRow } from '../components/FileRow';
import { errorMessage } from '../lib/errors';
import type { View } from '../lib/nav';

export function Dashboard({
  dataVersion,
  progress,
  onNavigate,
}: {
  dataVersion: number;
  progress: IndexProgress | null;
  onNavigate: (view: View) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    window.api
      .getStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, reloadKey]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  if (!stats) return null;

  if (stats.folders === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<FolderSearch className="size-10" />}
          title="Connect a folder to begin"
          hint="Revelio indexes your documents where they live — nothing is uploaded, nothing moves. Pick your Documents, Downloads, or college notes and start searching."
          action={
            <Button variant="primary" onClick={() => onNavigate({ name: 'folders' })}>
              <FolderOpen className="size-4" />
              Connect folder
            </Button>
          }
        />
      </div>
    );
  }

  const indexing = progress?.active ?? false;
  const pct =
    progress && progress.total > 0 ? (progress.done + progress.failed) / progress.total : 0;

  return (
    <div className="h-full overflow-y-auto p-8 fade-up">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          Your local library, indexed and searchable.
        </p>
      </header>

      {indexing && progress && (
        <Card className="mb-6 p-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium text-ink">
              Indexing{progress.current ? ` — ${progress.current}` : '…'}
            </span>
            <span className="tabular-nums text-muted">
              {progress.done + progress.failed} of {progress.total}
              {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
            </span>
          </div>
          <ProgressBar value={pct} className="mt-2" />
        </Card>
      )}

      <div className="mb-8 grid grid-cols-4 gap-3">
        <Kpi label="Files" value={stats.files} />
        <Kpi label="Indexed" value={stats.ready} />
        <Kpi label="Categories" value={stats.categories.length} />
        <Kpi label="Folders" value={stats.folders} />
      </div>

      {stats.categories.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Categories</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {stats.categories.slice(0, 14).map((c) => (
              <button
                key={c.name}
                onClick={() => onNavigate({ name: 'search', query: `category:"${c.name}"` })}
                className="cursor-pointer rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft"
              >
                {c.name} <span className="text-faint">{c.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          right={
            <Button variant="ghost" onClick={() => onNavigate({ name: 'search' })}>
              <Search className="size-3.5" />
              Search all
            </Button>
          }
        >
          Recent
        </SectionTitle>
        <Card className="p-1.5">
          {stats.recent.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-muted">
              Nothing indexed yet — files will appear here as they are processed.
            </div>
          ) : (
            stats.recent.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onClick={() => onNavigate({ name: 'document', id: file.id, from: { name: 'dashboard' } })}
              />
            ))
          )}
        </Card>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
    </Card>
  );
}

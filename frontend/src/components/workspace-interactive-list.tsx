'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  FileText,
  Filter,
  Grid,
  List,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { ConfidenceMeter, ProcessingBadge, StatusBadge } from '@/components/badges';
import { EmptyState, formatBytes, formatRelative } from '@/components/ui';
import type { DocumentListItem } from '@/lib/types';

export function WorkspaceInteractiveList({
  initialDocs,
  activeLabel,
}: {
  initialDocs: DocumentListItem[];
  activeLabel: string;
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'size'>('updated');

  const filteredDocs = useMemo(() => {
    let result = [...initialDocs];

    // Text filter
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.category?.name.toLowerCase().includes(q) ||
          d.owner?.full_name?.toLowerCase().includes(q) ||
          d.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((d) => d.workflow_status === statusFilter);
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'size') {
        const sizeA = a.current_version?.file_size ?? 0;
        const sizeB = b.current_version?.file_size ?? 0;
        return sizeB - sizeA;
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return result;
  }, [initialDocs, filterQuery, statusFilter, sortBy]);

  return (
    <div className="space-y-3.5">
      {/* ── Interactive Toolbar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2.5 shadow-xs">
        <div className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 ring-1 ring-line">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={`Filter ${initialDocs.length} items in ${activeLabel}…`}
            className="w-full bg-transparent text-xs text-ink placeholder:text-faint focus:outline-none"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              className="text-[10px] font-semibold text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Status Quick Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-2 focus:outline-none"
            aria-label="Filter status"
          >
            <option value="all">All States</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="faculty_review">Faculty Review</option>
            <option value="hod_review">HOD Review</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes Requested</option>
            <option value="rejected">Rejected</option>
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-2 focus:outline-none"
            aria-label="Sort documents"
          >
            <option value="updated">Latest Activity</option>
            <option value="title">Title (A-Z)</option>
            <option value="size">File Size</option>
          </select>

          {/* View Toggle */}
          <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="Table list view"
              className={`rounded-md p-1 transition-colors ${
                viewMode === 'list' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'
              }`}
            >
              <List className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Grid card view"
              className={`rounded-md p-1 transition-colors ${
                viewMode === 'grid' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'
              }`}
            >
              <Grid className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Document Container ─────────────────────────────────────────── */}
      {filteredDocs.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="No matching documents"
          description={
            filterQuery || statusFilter !== 'all'
              ? 'No files matched your live filter criteria.'
              : 'This folder is empty.'
          }
          action={
            <Link href="/upload" className="btn-primary">
              <Upload className="size-4" />
              Upload document
            </Link>
          }
        />
      ) : viewMode === 'list' ? (
        <ul className="card divide-y divide-line overflow-hidden shadow-xs">
          {filteredDocs.map((doc, i) => (
            <li key={doc.id} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
              <Link
                href={`/documents/${doc.id}`}
                className="group flex items-start gap-3.5 px-4 py-3.5 transition-colors hover:bg-surface-2"
              >
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent-ink">
                  <FileText className="size-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink transition-colors group-hover:text-accent-ink">
                      {doc.title}
                    </span>
                    <StatusBadge state={doc.workflow_status} />
                    {doc.current_version && (
                      <ProcessingBadge state={doc.current_version.processing_status} />
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    {doc.department && <span>{doc.department.name}</span>}
                    {doc.category && (
                      <>
                        <span aria-hidden className="size-1 rounded-full bg-line-2" />
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
                          {doc.category.name}
                        </span>
                      </>
                    )}
                    {doc.category_source === 'system' && doc.category_confidence != null && (
                      <>
                        <span aria-hidden className="size-1 rounded-full bg-line-2" />
                        <ConfidenceMeter value={doc.category_confidence} />
                      </>
                    )}
                    <span aria-hidden className="size-1 rounded-full bg-line-2" />
                    <span>{doc.owner?.full_name ?? 'Unknown'}</span>
                    <span aria-hidden className="size-1 rounded-full bg-line-2" />
                    <span>{formatRelative(doc.updated_at)}</span>
                    {doc.current_version && (
                      <>
                        <span aria-hidden className="size-1 rounded-full bg-line-2" />
                        <span className="font-mono text-[11px]">
                          v{doc.current_version.version_number} · {formatBytes(doc.current_version.file_size)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <ChevronRight className="mt-2.5 size-4 shrink-0 text-faint opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-accent-ink group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        /* Grid Card View */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredDocs.map((doc, i) => (
            <Link
              key={doc.id}
              href={`/documents/${doc.id}`}
              style={{ '--i': i } as React.CSSProperties}
              className="card group flex flex-col justify-between p-4 transition-all hover:border-line-2 hover:bg-surface-2 hover:shadow-e2"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-muted group-hover:bg-accent-soft group-hover:text-accent-ink">
                      <FileText className="size-4" />
                    </span>
                    <StatusBadge state={doc.workflow_status} />
                  </div>
                  {doc.current_version && (
                    <ProcessingBadge state={doc.current_version.processing_status} />
                  )}
                </div>

                <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-ink group-hover:text-accent-ink">
                  {doc.title}
                </h3>

                {doc.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{doc.description}</p>
                )}
              </div>

              <div className="mt-4 border-t border-line pt-2.5 text-xs text-muted flex items-center justify-between">
                <span>{doc.owner?.full_name ?? 'Unknown'}</span>
                <span className="font-mono text-[11px] text-faint">
                  {doc.current_version ? formatBytes(doc.current_version.file_size) : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

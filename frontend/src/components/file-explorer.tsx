'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CornerLeftUp,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Grid2x2,
  Inbox,
  Library,
  List,
  MonitorPlay,
  Search,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ConfidenceMeter, ProcessingBadge, StatusBadge } from '@/components/badges';
import { EmptyState, formatBytes, formatDateTime, formatRelative, stagger } from '@/components/ui';
import { fileExtension, fileKind, itemCount } from '@/lib/explorer';
import type { Crumb, ExplorerFolder, FileKind, FolderKind } from '@/lib/explorer';
import type { DocumentListItem } from '@/lib/types';

/** Persisted so the view survives navigation between folders and reloads. */
const VIEW_KEY = 'revelio.explorer.view';

type ViewMode = 'grid' | 'details';
type SortKey = 'name' | 'modified' | 'size' | 'type';

/**
 * Icon and palette per file family.
 *
 * Split into four slots rather than one class string because the tile needs a
 * saturated spine while the details row needs a wash — one blob of classes
 * cannot serve both without the spine coming out pale.
 */
const FILE_STYLES: Record<
  FileKind,
  { icon: LucideIcon; ink: string; spine: string; wash: string; edge: string }
> = {
  pdf: { icon: FileText, ink: 'text-danger', spine: 'bg-danger', wash: 'bg-danger-soft', edge: 'ring-danger-line' },
  doc: { icon: FileText, ink: 'text-info', spine: 'bg-info', wash: 'bg-info-soft', edge: 'ring-info-line' },
  sheet: { icon: FileSpreadsheet, ink: 'text-ok', spine: 'bg-ok', wash: 'bg-ok-soft', edge: 'ring-ok-line' },
  slide: { icon: MonitorPlay, ink: 'text-tier2', spine: 'bg-tier2', wash: 'bg-tier2-soft', edge: 'ring-tier2-line' },
  image: { icon: FileImage, ink: 'text-tier1', spine: 'bg-tier1', wash: 'bg-tier1-soft', edge: 'ring-tier1-line' },
  text: { icon: FileText, ink: 'text-muted', spine: 'bg-muted', wash: 'bg-surface-2', edge: 'ring-line' },
  archive: { icon: FileArchive, ink: 'text-warn', spine: 'bg-warn', wash: 'bg-warn-soft', edge: 'ring-warn-line' },
  other: { icon: FileIcon, ink: 'text-muted', spine: 'bg-muted', wash: 'bg-surface-2', edge: 'ring-line' },
};

const FOLDER_ICONS: Record<FolderKind, LucideIcon> = {
  department: Library,
  category: Folder,
  year: CalendarDays,
};

/**
 * The workspace file explorer: a location bar, a toolbar, then folders followed
 * by loose files.
 *
 * Folders and files arrive already resolved for the current level — this
 * component owns only what the server cannot know: which view the user prefers,
 * how they want it sorted, and what they have typed into the live filter.
 */
export function FileExplorer({
  crumbs,
  folders,
  files,
  parentHref,
  filesLabel = 'Files',
  emptyTitle,
  emptyDescription,
  footnote,
  flatHref,
  flatCount,
  isFlat,
}: {
  crumbs: Crumb[];
  folders: ExplorerFolder[];
  files: DocumentListItem[];
  /** One level up. Absent at the root, where the Up button is disabled. */
  parentHref: string | null;
  /** Heading over the loose files — "Unfiled files" at the root, say. */
  filesLabel?: string;
  emptyTitle: string;
  emptyDescription: string;
  footnote?: React.ReactNode;
  /** Link to the "every document below here, flattened" view of this folder. */
  flatHref?: string;
  flatCount?: number;
  isFlat?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>('grid');
  const [sort, setSort] = useState<SortKey>('name');
  const [filter, setFilter] = useState('');

  // Read after mount, not during render: localStorage does not exist on the
  // server, and seeding state from it directly would hydrate-mismatch.
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === 'grid' || saved === 'details') setView(saved);
  }, []);

  const chooseView = (next: ViewMode) => {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  };

  const needle = filter.trim().toLowerCase();

  const shownFolders = useMemo(() => {
    const list = needle ? folders.filter((f) => f.name.toLowerCase().includes(needle)) : folders;
    // Folders never sort by size or date — they have neither. Explorer collapses
    // those to a name sort too.
    return [...list].sort((a, b) =>
      sort === 'size' ? b.count - a.count : a.name.localeCompare(b.name),
    );
  }, [folders, needle, sort]);

  const shownFiles = useMemo(() => {
    let list = files;
    if (needle) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(needle) ||
          d.category?.name.toLowerCase().includes(needle) ||
          d.owner?.full_name?.toLowerCase().includes(needle) ||
          d.current_version?.original_filename.toLowerCase().includes(needle) ||
          d.tags?.some((t) => t.toLowerCase().includes(needle)),
      );
    }

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'size':
          return (b.current_version?.file_size ?? 0) - (a.current_version?.file_size ?? 0);
        case 'type':
          return (
            fileKind(a.current_version?.mime_type, a.current_version?.original_filename).localeCompare(
              fileKind(b.current_version?.mime_type, b.current_version?.original_filename),
            ) || a.title.localeCompare(b.title)
          );
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });
  }, [files, needle, sort]);

  const total = folders.length + files.length;
  const shownTotal = shownFolders.length + shownFiles.length;
  const filteredOut = needle.length > 0 && shownTotal < total;

  return (
    <div className="card overflow-hidden">
      {/* ── Location bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/60 px-2.5 py-2">
        <button
          type="button"
          onClick={() => router.back()}
          title="Back"
          aria-label="Back"
          className="btn-ghost size-7 shrink-0 rounded-md p-0"
        >
          <ArrowLeft className="size-4" />
        </button>

        {parentHref ? (
          <Link
            href={parentHref}
            title="Up one level"
            aria-label="Up one level"
            className="btn-ghost size-7 shrink-0 rounded-md p-0"
          >
            <CornerLeftUp className="size-4" />
          </Link>
        ) : (
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md text-line-2"
          >
            <CornerLeftUp className="size-4" />
          </span>
        )}

        {/* The address field. Segments are links, exactly like a real path bar. */}
        <nav
          aria-label="Location"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border
                     border-line bg-surface px-2 py-1"
        >
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={crumb.href + i} className="flex min-w-0 shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />}
                {last ? (
                  <span aria-current="page" className="truncate px-1 text-xs font-semibold text-ink">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="truncate rounded px-1 py-0.5 text-xs text-muted transition-colors
                               hover:bg-surface-2 hover:text-ink"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        {/* Filter box. Scoped to the open folder, which is why it is here and
            not confused with the global search page. */}
        <div
          className="hidden min-w-0 items-center gap-1.5 rounded-lg border border-line bg-surface
                     px-2 py-1 sm:flex sm:w-40 lg:w-52"
        >
          <Search className="size-3.5 shrink-0 text-faint" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this folder"
            aria-label="Filter this folder"
            className="w-full bg-transparent text-xs text-ink placeholder:text-faint focus:outline-none"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              className="shrink-0 text-[10px] font-semibold text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs text-muted">
          <span className="tabular-nums">{itemCount(shownTotal)}</span>
          {folders.length > 0 && (
            <span className="text-faint">
              {' · '}
              {shownFolders.length} folder{shownFolders.length === 1 ? '' : 's'}
              {', '}
              {shownFiles.length} file{shownFiles.length === 1 ? '' : 's'}
            </span>
          )}
          {filteredOut && <span className="text-faint"> · filtered from {total}</span>}
        </p>

        <div className="flex items-center gap-2">
          {flatHref && !isFlat && flatCount ? (
            <Link
              href={flatHref}
              className="text-xs font-medium text-accent-ink transition-colors hover:underline"
            >
              Show all {flatCount} files
            </Link>
          ) : null}

          <label className="sr-only" htmlFor="explorer-sort">
            Sort by
          </label>
          <select
            id="explorer-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-2
                       focus:outline-none"
          >
            <option value="name">Name</option>
            <option value="modified">Date modified</option>
            <option value="type">Type</option>
            <option value="size">Size</option>
          </select>

          <div className="flex rounded-lg border border-line bg-surface-2 p-0.5" role="group">
            <button
              type="button"
              onClick={() => chooseView('grid')}
              aria-pressed={view === 'grid'}
              title="Large icons"
              className={clsx(
                'rounded-md p-1 transition-colors',
                view === 'grid' ? 'bg-surface text-ink shadow-e1' : 'text-muted hover:text-ink',
              )}
            >
              <Grid2x2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => chooseView('details')}
              aria-pressed={view === 'details'}
              title="Details"
              className={clsx(
                'rounded-md p-1 transition-colors',
                view === 'details' ? 'bg-surface text-ink shadow-e1' : 'text-muted hover:text-ink',
              )}
            >
              <List className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Contents ─────────────────────────────────────────────────────── */}
      {shownTotal === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={needle ? Search : Inbox}
            title={needle ? 'Nothing matches that filter' : emptyTitle}
            description={
              needle
                ? `No folder or file in this location matches “${filter.trim()}”.`
                : emptyDescription
            }
            action={
              needle ? (
                <button type="button" onClick={() => setFilter('')} className="btn-secondary">
                  Clear filter
                </button>
              ) : (
                <Link href="/upload" className="btn-primary">
                  <Upload className="size-4" />
                  Upload document
                </Link>
              )
            }
          />
        </div>
      ) : view === 'grid' ? (
        <div className="p-3">
          {shownFolders.length > 0 && (
            <Group label="Folders" count={shownFolders.length}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                {shownFolders.map((folder, i) => (
                  <FolderTile key={folder.key} folder={folder} index={i} />
                ))}
              </div>
            </Group>
          )}

          {shownFiles.length > 0 && (
            <Group
              label={filesLabel}
              count={shownFiles.length}
              spaced={shownFolders.length > 0}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                {shownFiles.map((doc, i) => (
                  <FileTile key={doc.id} doc={doc} index={i} />
                ))}
              </div>
            </Group>
          )}
        </div>
      ) : (
        <DetailsView folders={shownFolders} files={shownFiles} />
      )}

      {footnote && (
        <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-faint">
          {footnote}
        </p>
      )}
    </div>
  );
}

/** Section heading above a run of tiles, in the manner of Explorer's groups. */
function Group({
  label,
  count,
  spaced,
  children,
}: {
  label: string;
  count: number;
  spaced?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={spaced ? 'mt-4' : undefined}>
      <h3
        className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase
                   tracking-[0.1em] text-faint"
      >
        {label}
        <span className="tabular-nums text-line-2">({count})</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * A folder in large-icon view.
 *
 * Drawn as a stack of sheets rather than a folder glyph: on hover the pages
 * separate, which is the whole idea — a category is a pile of documents you
 * could pick up, not an abstract container.
 */
function FolderTile({ folder, index }: { folder: ExplorerFolder; index: number }) {
  const Icon = FOLDER_ICONS[folder.kind];
  const empty = folder.count === 0;

  return (
    <Link
      href={folder.href}
      style={stagger(index)}
      className="group settle-in flex flex-col items-center gap-2 rounded-lg border border-transparent
                 px-2 py-3 text-center transition-colors duration-200 hover:border-line
                 hover:bg-surface-2/60 focus-visible:border-line"
    >
      <span className="relative block h-14 w-11">
        {/* The sheets underneath. An empty folder gets none — there is nothing
            in there to stack. */}
        {!empty && (
          <>
            <span
              aria-hidden
              className="absolute inset-0 -rotate-[4deg] rounded-sm border border-line bg-surface-2
                         transition-transform duration-300 ease-[var(--ease-paper)]
                         group-hover:-translate-x-1.5 group-hover:-rotate-[11deg]"
            />
            <span
              aria-hidden
              className="absolute inset-0 rotate-[3deg] rounded-sm border border-line bg-surface-2
                         transition-transform duration-300 ease-[var(--ease-paper)]
                         group-hover:translate-x-1.5 group-hover:rotate-[9deg]"
            />
          </>
        )}

        {/* The top sheet. */}
        <span
          className={clsx(
            'absolute inset-0 grid place-items-center rounded-sm border shadow-e1',
            'transition-transform duration-300 ease-[var(--ease-paper)] group-hover:-translate-y-1',
            empty ? 'border-line bg-surface-2' : 'border-line-2 bg-surface',
          )}
        >
          {/* Turned corner, and two rules of body copy behind the glyph. */}
          <span
            aria-hidden
            className="absolute right-0 top-0 size-3 border-b border-l border-line-2 bg-surface-2"
          />
          <span aria-hidden className="absolute inset-x-2 bottom-3 h-px bg-line" />
          <span aria-hidden className="absolute inset-x-2 bottom-5 h-px bg-line" />
          <Icon
            className={clsx('relative -mt-1 size-4', empty ? 'text-faint' : 'text-accent-ink')}
          />
        </span>
      </span>

      <span className="line-clamp-2 w-full text-xs font-medium leading-snug text-ink">
        {folder.name}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] tabular-nums text-faint">
        {folder.hint ?? itemCount(folder.count)}
      </span>
    </Link>
  );
}

/** A document in large-icon view: one sheet, spined and labelled by file type. */
function FileTile({ doc, index }: { doc: DocumentListItem; index: number }) {
  const kind = fileKind(doc.current_version?.mime_type, doc.current_version?.original_filename);
  const { icon: Icon, ink, spine } = FILE_STYLES[kind];
  const ext = fileExtension(doc.current_version?.original_filename);

  return (
    <Link
      href={`/documents/${doc.id}`}
      style={stagger(index)}
      title={doc.current_version?.original_filename ?? doc.title}
      className="group settle-in flex flex-col items-center gap-2 rounded-lg border border-transparent
                 px-2 py-3 text-center transition-colors duration-200 hover:border-line
                 hover:bg-surface-2/60 focus-visible:border-line"
    >
      <span className="relative block h-14 w-11">
        <span
          className="absolute inset-0 grid place-items-center rounded-sm border border-line-2
                     bg-surface shadow-e1 transition-transform duration-300 ease-[var(--ease-paper)]
                     group-hover:-translate-y-1 group-hover:rotate-[-2deg]"
        >
          <span
            aria-hidden
            className="absolute right-0 top-0 size-3 border-b border-l border-line-2 bg-surface-2"
          />
          {/* A coloured spine down the left edge carries the file family, so the
              sheet stays a sheet instead of becoming a tinted square. */}
          <span aria-hidden className={clsx('absolute inset-y-0 left-0 w-1 rounded-l-sm', spine)} />
          <Icon className={clsx('relative size-4', ink)} />
        </span>

        {ext && (
          <span
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-surface px-1
                       font-mono text-[9px] font-bold text-muted ring-1 ring-line"
          >
            {ext}
          </span>
        )}
      </span>

      <span className="mt-0.5 line-clamp-2 w-full text-xs font-medium leading-snug text-ink">
        {doc.title}
      </span>

      <span className="flex flex-col items-center gap-1.5">
        <StatusBadge state={doc.workflow_status} />
        <span className="text-[10px] tabular-nums text-faint">
          {doc.current_version ? formatBytes(doc.current_version.file_size) : '—'}
        </span>
      </span>
    </Link>
  );
}

/**
 * Details view: the columnar listing. Rendered as a grid rather than a table so
 * the row can be a single link — a whole-row hit target is what makes a listing
 * feel like a file manager instead of a page of hyperlinks.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_5.5rem] items-center gap-3 px-3';

function DetailsView({ folders, files }: { folders: ExplorerFolder[]; files: DocumentListItem[] }) {
  return (
    <div>
      <div
        className={clsx(
          COLUMNS,
          'sticky top-0 z-1 border-b border-line bg-surface-2/80 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint backdrop-blur',
        )}
      >
        <span>Name</span>
        <span className="hidden sm:block">Status</span>
        <span className="hidden sm:block">Modified</span>
        <span className="text-right">Size</span>
      </div>

      <ul className="divide-y divide-line">
        {folders.map((folder, i) => {
          const Icon = FOLDER_ICONS[folder.kind];
          return (
            <li key={folder.key} className="rise-in" style={stagger(i)}>
              <Link
                href={folder.href}
                className={clsx(COLUMNS, 'group py-2 transition-colors hover:bg-accent-soft')}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft
                               text-accent-ink ring-1 ring-inset ring-accent-line"
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{folder.name}</span>
                </span>
                <span className="hidden text-xs text-muted sm:block">
                  {folder.kind === 'department'
                    ? 'Department'
                    : folder.kind === 'year'
                      ? 'Year folder'
                      : 'Category'}
                </span>
                <span className="hidden text-xs tabular-nums text-muted sm:block">
                  {folder.hint ?? itemCount(folder.count)}
                </span>
                <span className="flex items-center justify-end gap-1 text-right text-xs text-faint">
                  <ChevronRight
                    className="size-3.5 -translate-x-1 opacity-0 transition-all
                               group-hover:translate-x-0 group-hover:text-accent-ink group-hover:opacity-100"
                  />
                </span>
              </Link>
            </li>
          );
        })}

        {files.map((doc, i) => {
          const kind = fileKind(
            doc.current_version?.mime_type,
            doc.current_version?.original_filename,
          );
          const { icon: Icon, ink, wash, edge } = FILE_STYLES[kind];
          const ext = fileExtension(doc.current_version?.original_filename);

          return (
            <li key={doc.id} className="rise-in" style={stagger(folders.length + i)}>
              <Link
                href={`/documents/${doc.id}`}
                className={clsx(COLUMNS, 'group py-2 transition-colors hover:bg-surface-2')}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={clsx(
                      'grid size-7 shrink-0 place-items-center rounded-sm ring-1 ring-inset',
                      ink,
                      wash,
                      edge,
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink transition-colors group-hover:text-accent-ink">
                      {doc.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                      {ext && <span className="font-mono font-semibold">{ext}</span>}
                      {doc.category && <span className="truncate">{doc.category.name}</span>}
                      {doc.category_source === 'system' && doc.category_confidence != null && (
                        <ConfidenceMeter value={doc.category_confidence} />
                      )}
                      <span className="truncate">{doc.owner?.full_name ?? 'Unknown'}</span>
                    </span>
                  </span>
                </span>

                <span className="hidden min-w-0 flex-wrap items-center gap-1.5 sm:flex">
                  <StatusBadge state={doc.workflow_status} />
                  {doc.current_version && (
                    <ProcessingBadge state={doc.current_version.processing_status} />
                  )}
                </span>

                <span
                  className="hidden text-xs text-muted sm:block"
                  title={formatDateTime(doc.updated_at)}
                >
                  {formatRelative(doc.updated_at)}
                </span>

                <span className="text-right font-mono text-xs tabular-nums text-muted">
                  {doc.current_version ? formatBytes(doc.current_version.file_size) : '—'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

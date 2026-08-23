import Link from 'next/link';
import { CalendarDays, ChevronRight, Folder, HardDrive, Inbox, Library, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { FileExplorer } from '@/components/file-explorer';
import { OrganizeDialog } from '@/components/organize-dialog';
import { ErrorNote, PageHeader, stagger } from '@/components/ui';
import { effectiveYear } from '@/lib/organize';
import { itemCount, workspaceHref } from '@/lib/explorer';
import type { Crumb, ExplorerFolder } from '@/lib/explorer';
import type { DocumentListItem } from '@/lib/types';

/** Rows pulled for the folder counts. Scalars only — no joins, no text. */
interface IndexRow {
  category_id: string | null;
  department_id: string | null;
  document_date: string | null;
  created_at: string;
}

/** Upper bound on the counting query. Well above any hackathon corpus. */
const INDEX_LIMIT = 2000;

/** Files listed in one folder. Hitting it is surfaced rather than swallowed. */
const LIST_LIMIT = 200;

/** The document columns the explorer needs, joins flattened. */
const LIST_SELECT = `id, title, description, owner_id, department_id, category_id, category_source,
   category_confidence, workflow_status, current_version_id, document_type,
   document_date, tags, user_metadata, system_metadata, created_at, updated_at,
   category:categories!documents_category_id_fkey (id, name, slug),
   department:departments!documents_department_id_fkey (id, name, slug),
   owner:profiles!documents_owner_id_fkey (id, full_name),
   current_version:document_versions!documents_current_version_fk
     (id, version_number, processing_status, original_filename, file_size, mime_type)`;

/**
 * The workspace, presented as a file explorer.
 *
 * The taxonomy is the directory tree: departments are top-level folders,
 * categories are their subfolders, and a derived year level sits under any
 * category that spans more than one year. Documents are the files. Anything the
 * classifier could not place has no folder to live in, so it sits loose at the
 * root — the same way an unsorted download does.
 *
 * `flat=1` on any level opts out of the subfolders and lists everything beneath
 * it at once, which is the escape hatch for "I know it is in here somewhere".
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    dept?: string;
    cat?: string;
    year?: string;
    unfiled?: string;
    flat?: string;
  }>;
}) {
  const { dept, cat, year, unfiled, flat } = await searchParams;
  const supabase = await createClient();

  const showUnfiled = unfiled === '1';
  const isFlat = flat === '1';
  // Only a four-digit year is honoured; anything else is ignored rather than
  // interpolated into a filter.
  const activeYear = year && /^\d{4}$/.test(year) ? year : null;

  /*
   * Which level are we in, and does it list files at all?
   *
   * A folder that has subfolders lists no loose files — its documents live in
   * those subfolders, and showing them in both places would double every count
   * the user can see. The exceptions are the root, where unfiled documents have
   * nowhere deeper to go, and any `flat=1` view, which the user asked for
   * explicitly.
   */
  const level: 'unfiled' | 'year' | 'category' | 'department' | 'root' = showUnfiled
    ? 'unfiled'
    : cat && activeYear
      ? 'year'
      : cat
        ? 'category'
        : dept
          ? 'department'
          : 'root';

  /*
   * The file query for this level. Built up front so it can join the same round
   * trip as the taxonomy; `null` means the level shows folders only and we skip
   * the query rather than fetching rows nobody renders.
   *
   * Typed structurally rather than as a PostgrestFilterBuilder so the branches —
   * which differ in how many filters they have chained — collapse to one type.
   */
  type ListResult = { data: unknown[] | null; error: { message: string } | null };
  const filesQuery: PromiseLike<ListResult> | null = (() => {
    const base = () =>
      supabase.from('documents').select(LIST_SELECT).order('updated_at', { ascending: false }).limit(LIST_LIMIT);

    switch (level) {
      case 'unfiled':
        return base().is('category_id', null);
      case 'root':
        // Loose at the root: filed into no folder at all.
        return isFlat ? base() : base().is('category_id', null);
      case 'department':
        return isFlat
          ? base().eq('department_id', dept!).not('category_id', 'is', null)
          : null;
      case 'category':
        // Year subfolders only appear when the category spans more than one, so
        // whether this level lists files is not known until the counts are in.
        return base().eq('category_id', cat!);
      case 'year': {
        /*
         * Year is a derived level, not a column: a document files under the date
         * it carries, or its upload date when it has none. Both halves must be
         * expressed in one filter, hence the or(and(), and()) — PostgREST ANDs
         * this with the category filter. `effectiveYear()` implements the same
         * rule for the folder counts, so a document can never appear under one
         * year in the tree and a different one in the listing.
         */
        const from = `${activeYear}-01-01`;
        const to = `${activeYear}-12-31`;
        return base()
          .eq('category_id', cat!)
          .or(
            `and(document_date.gte.${from},document_date.lte.${to}),` +
              `and(document_date.is.null,created_at.gte.${from}T00:00:00Z,created_at.lte.${to}T23:59:59Z)`,
          );
      }
    }
  })();

  /*
   * One round trip. None of these depend on each other: the file filter comes
   * from searchParams and the taxonomy is global.
   *
   * Firing the data queries before the session resolves is safe: middleware has
   * already rejected unauthenticated requests, and RLS scopes every row to the
   * caller regardless of what this component believes about them.
   */
  const [
    { profile },
    { data: departments, error: deptError },
    { data: categories, error: catError },
    filesResult,
    { data: index },
  ] = await Promise.all([
    requireSession(),
    supabase.from('departments').select('id, name, slug, sort_order').order('sort_order'),
    supabase
      .from('categories')
      .select('id, department_id, name, slug, sort_order')
      .eq('is_active', true)
      .order('sort_order'),
    // Promise.all passes a plain `null` straight through, so a folders-only
    // level costs no round trip at all.
    filesQuery,
    // Counting index. Deliberately unfiltered and column-thin so folder counts
    // describe the whole corpus rather than whichever page the listing shows.
    supabase
      .from('documents')
      .select('category_id, department_id, document_date, created_at')
      .limit(INDEX_LIMIT),
  ]);

  const listError = filesResult?.error ?? null;

  // Surface taxonomy failures. Previously these errors were discarded, so a
  // missing GRANT rendered as an empty folder tree indistinguishable from an
  // unseeded database — which hid the real cause of the upload failure.
  const taxonomyError = deptError ?? catError;
  if (taxonomyError) {
    console.error(
      `[workspace] taxonomy load failed: sqlstate=${taxonomyError.code ?? 'n/a'} ` +
        `message=${JSON.stringify(taxonomyError.message)}`,
    );
  }

  const allDepartments = departments ?? [];
  const allCategories = categories ?? [];

  // ── Derived counts ────────────────────────────────────────────────────────
  const rows = (index ?? []) as unknown as IndexRow[];
  /** Documents filed into a category belonging to this department. */
  const byDepartment = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const yearsByCategory = new Map<string, Map<number, number>>();
  let unfiledCount = 0;

  // A category's department is authoritative from the taxonomy, not from the
  // document row: a stale department_id on a re-filed document would otherwise
  // make the department count disagree with the sum of its categories.
  const departmentOfCategory = new Map(allCategories.map((c) => [c.id, c.department_id]));

  for (const row of rows) {
    if (!row.category_id) {
      unfiledCount++;
      continue;
    }
    byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + 1);

    const owningDept = departmentOfCategory.get(row.category_id) ?? row.department_id;
    if (owningDept) {
      byDepartment.set(owningDept, (byDepartment.get(owningDept) ?? 0) + 1);
    }

    const y = effectiveYear(row.document_date, row.created_at);
    let bucket = yearsByCategory.get(row.category_id);
    if (!bucket) {
      bucket = new Map<number, number>();
      yearsByCategory.set(row.category_id, bucket);
    }
    bucket.set(y, (bucket.get(y) ?? 0) + 1);
  }

  const activeCategory = allCategories.find((c) => c.id === cat) ?? null;
  const activeDepartment =
    allDepartments.find((d) => d.id === (activeCategory?.department_id ?? dept)) ?? null;

  // ── Folders and files for the open level ──────────────────────────────────
  const categoryYears = activeCategory
    ? [...(yearsByCategory.get(activeCategory.id)?.entries() ?? [])].sort((a, b) => b[0] - a[0])
    : [];
  // One year is not a hierarchy — drilling into it would show exactly what the
  // category already shows, so the level is skipped entirely.
  const showYearFolders = level === 'category' && !isFlat && categoryYears.length > 1;

  let docs = (filesResult?.data ?? []) as unknown as DocumentListItem[];
  if (showYearFolders) docs = [];

  const folders: ExplorerFolder[] = (() => {
    if (level === 'root' && !isFlat) {
      return allDepartments.map((d) => {
        const count = byDepartment.get(d.id) ?? 0;
        const catCount = allCategories.filter((c) => c.department_id === d.id).length;
        return {
          key: d.id,
          name: d.name,
          href: workspaceHref({ dept: d.id }),
          count,
          kind: 'department' as const,
          // An empty department still has structure worth naming; "0 items"
          // would read as a dead end.
          hint: count === 0 ? `${catCount} folder${catCount === 1 ? '' : 's'}` : undefined,
        };
      });
    }

    if (level === 'department' && !isFlat) {
      return allCategories
        .filter((c) => c.department_id === dept)
        .map((c) => ({
          key: c.id,
          name: c.name,
          href: workspaceHref({ cat: c.id }),
          count: byCategory.get(c.id) ?? 0,
          kind: 'category' as const,
        }));
    }

    if (showYearFolders) {
      return categoryYears.map(([y, n]) => ({
        key: String(y),
        name: String(y),
        href: workspaceHref({ cat: activeCategory!.id, year: y }),
        count: n,
        kind: 'year' as const,
      }));
    }

    return [];
  })();

  // ── Location bar and the way back up ──────────────────────────────────────
  const crumbs: Crumb[] = [{ label: 'Workspace', href: '/workspace' }];
  let parentHref: string | null = null;

  if (level === 'unfiled') {
    crumbs.push({ label: 'Unfiled', href: workspaceHref({ unfiled: true }) });
    parentHref = '/workspace';
  } else if (activeDepartment) {
    crumbs.push({ label: activeDepartment.name, href: workspaceHref({ dept: activeDepartment.id }) });
    parentHref = '/workspace';
  }
  if (activeCategory) {
    crumbs.push({ label: activeCategory.name, href: workspaceHref({ cat: activeCategory.id }) });
    parentHref = activeDepartment ? workspaceHref({ dept: activeDepartment.id }) : '/workspace';
  }
  if (level === 'year' && activeCategory) {
    crumbs.push({
      label: activeYear!,
      href: workspaceHref({ cat: activeCategory.id, year: activeYear }),
    });
    parentHref = workspaceHref({ cat: activeCategory.id });
  }
  if (isFlat) {
    crumbs.push({ label: 'All files', href: workspaceHref({ dept, cat, flat: true }) });
    parentHref = workspaceHref({ dept, cat });
  }

  // ── The "flatten this folder" escape hatch ────────────────────────────────
  const flatTarget =
    level === 'root' && !isFlat
      ? { href: workspaceHref({ flat: true }), count: rows.length }
      : level === 'department' && !isFlat
        ? { href: workspaceHref({ dept, flat: true }), count: byDepartment.get(dept!) ?? 0 }
        : showYearFolders
          ? {
              href: workspaceHref({ cat: activeCategory!.id, flat: true }),
              count: byCategory.get(activeCategory!.id) ?? 0,
            }
          : null;

  const truncated = docs.length >= LIST_LIMIT;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Workspace"
        description="Your documents, filed into folders automatically from their content and metadata."
        action={
          <div className="flex items-center gap-2">
            <OrganizeDialog />
            <Link href="/upload" className="btn-primary">
              <Upload className="size-4" />
              Upload document
            </Link>
          </div>
        }
      />

      {listError && <ErrorNote>Could not load documents: {listError.message}</ErrorNote>}

      <div className="mt-1 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* ── Navigation pane ──────────────────────────────────────────────── */}
        <nav
          aria-label="Folders"
          className="card h-fit animate-rise overflow-hidden p-0 lg:sticky lg:top-[5.5rem]"
        >
          <p
            className="border-b border-line bg-surface-2/60 px-3 py-2 text-[11px] font-semibold
                       uppercase tracking-[0.1em] text-faint"
          >
            Folders
          </p>

          <div className="p-1.5">
            <TreeRow
              href="/workspace"
              icon={HardDrive}
              active={level === 'root' && !isFlat}
              strong
              count={rows.length}
            >
              Workspace
            </TreeRow>

            {/* Smart view. Unfiled documents match no folder, so without this row
                they exist but appear nowhere in the tree. */}
            {unfiledCount > 0 && (
              <TreeRow
                href={workspaceHref({ unfiled: true })}
                icon={Inbox}
                active={level === 'unfiled'}
                count={unfiledCount}
                tone="warn"
              >
                Unfiled
              </TreeRow>
            )}

            {allDepartments.map((d, di) => {
              const kids = allCategories.filter((c) => c.department_id === d.id);
              const inDepartment = activeDepartment?.id === d.id;

              return (
                <div key={d.id} className="fade-in mt-1.5" style={stagger(di + 1)}>
                  <TreeRow
                    href={workspaceHref({ dept: d.id })}
                    icon={Library}
                    active={level === 'department' && dept === d.id}
                    count={byDepartment.get(d.id)}
                    expanded={inDepartment}
                  >
                    {d.name}
                  </TreeRow>

                  {/* Subfolders unfold only for the branch you are standing in.
                      Rendering every category at once turns a tree into a wall. */}
                  {inDepartment && kids.length > 0 && (
                    <div className="ml-3.5 mt-px space-y-px border-l border-line pl-1.5">
                      {kids.map((c, ci) => {
                        const isOpen = activeCategory?.id === c.id;
                        const years = [...(yearsByCategory.get(c.id)?.entries() ?? [])].sort(
                          (a, b) => b[0] - a[0],
                        );

                        return (
                          <div key={c.id} className="fade-in" style={stagger(ci)}>
                            <TreeRow
                              href={workspaceHref({ cat: c.id })}
                              icon={Folder}
                              active={isOpen && !activeYear && !isFlat}
                              count={byCategory.get(c.id)}
                              small
                            >
                              {c.name}
                            </TreeRow>

                            {isOpen && years.length > 1 && (
                              <div className="ml-3.5 space-y-px border-l border-line pl-1.5">
                                {years.map(([y, n], yi) => (
                                  <div key={y} className="fade-in" style={stagger(yi)}>
                                    <TreeRow
                                      href={workspaceHref({ cat: c.id, year: y })}
                                      icon={CalendarDays}
                                      active={activeYear === String(y)}
                                      count={n}
                                      small
                                      mono
                                    >
                                      {y}
                                    </TreeRow>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {allDepartments.length === 0 && (
              <p className="px-2.5 py-2 text-xs leading-relaxed">
                {taxonomyError ? (
                  <span className="text-danger">
                    Could not load folders: {taxonomyError.message}
                  </span>
                ) : (
                  <span className="text-muted">
                    No categories yet. Run supabase/seed/seed.sql to create the taxonomy.
                  </span>
                )}
              </p>
            )}
          </div>
        </nav>

        {/* ── Contents pane ───────────────────────────────────────────────── */}
        <section>
          <FileExplorer
            crumbs={crumbs}
            folders={folders}
            files={docs}
            parentHref={parentHref}
            isFlat={isFlat}
            flatHref={flatTarget?.href}
            flatCount={flatTarget?.count}
            filesLabel={
              level === 'root' && !isFlat ? 'Unfiled files — not in any folder yet' : 'Files'
            }
            emptyTitle={
              level === 'unfiled'
                ? 'Nothing unfiled'
                : level === 'root'
                  ? 'This workspace is empty'
                  : 'This folder is empty'
            }
            emptyDescription={
              level === 'unfiled'
                ? 'Every document has been filed into a folder.'
                : level === 'root'
                  ? 'Upload your first document and it will be filed automatically.'
                  : 'No documents have been filed here yet.'
            }
            footnote={
              <>
                {truncated && (
                  <span className="font-medium text-warn">
                    Showing the {LIST_LIMIT} most recently updated files in this folder.{' '}
                  </span>
                )}
                Signed in as {profile.full_name || 'user'} · you only see documents you own or are
                authorized to review.
              </>
            }
          />
        </section>
      </div>
    </div>
  );
}

/**
 * One row of the navigation pane.
 *
 * Deliberately not a generic component: the tree is the only place that wants a
 * leading folder glyph, a trailing count, and an active rail all at once.
 */
function TreeRow({
  href,
  icon: Icon,
  active,
  count,
  strong,
  small,
  mono,
  tone,
  expanded,
  children,
}: {
  href: string;
  icon: LucideIcon;
  active: boolean;
  count?: number;
  strong?: boolean;
  small?: boolean;
  mono?: boolean;
  tone?: 'warn';
  /** Rotates the disclosure chevron for the branch currently unfolded. */
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-1.5 rounded-md py-1.5 pl-2.5 pr-2
                  transition-colors duration-200 ${small ? 'text-xs' : 'text-sm'}
                  ${strong ? 'font-semibold' : ''}
                  ${
                    active
                      ? 'bg-accent-soft font-medium text-accent-ink'
                      : tone === 'warn'
                        ? 'text-warn hover:bg-surface-2'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                  }`}
    >
      <span
        className={`absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 origin-center rounded-r-full
                    bg-accent transition-transform duration-300 ease-[var(--ease-spring)]
                    ${active ? 'scale-y-100' : 'scale-y-0'}`}
        aria-hidden
      />
      {expanded !== undefined && (
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 text-faint transition-transform duration-200
                      ${expanded ? 'rotate-90' : ''}`}
        />
      )}
      <Icon
        aria-hidden
        className={`shrink-0 ${small ? 'size-3.5' : 'size-4'} ${
          active ? 'text-accent-ink' : 'text-faint group-hover:text-muted'
        }`}
      />
      <span className={`min-w-0 flex-1 truncate ${mono ? 'font-mono tabular-nums' : ''}`}>
        {children}
      </span>
      {count ? (
        <span className="shrink-0 text-[11px] tabular-nums text-faint" title={itemCount(count)}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

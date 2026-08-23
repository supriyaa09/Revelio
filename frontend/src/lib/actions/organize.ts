'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fail, logAndMap, succeed, type ActionResult } from '@/lib/errors';
import {
  LOW_CONFIDENCE_BAR,
  ORGANIZE_BATCH,
  planOrganize,
  type OrganizeCandidate,
  type OrganizePlan,
  type OrganizePreview,
} from '@/lib/organize';
import type { Category, MetadataSource } from '@/lib/types';

/** Concurrent apply_ai_metadata calls. Each locks a different document row. */
const APPLY_CHUNK = 8;

/**
 * How far back the cheap scope pass looks. Scalar columns only, so this is a
 * small response even at 500 rows — it exists purely to decide *which*
 * documents are worth fetching text for.
 */
const SCOPE_SCAN_LIMIT = 500;

/** Scope pass row. No text, no joins. */
interface ScopeRow {
  id: string;
  category_id: string | null;
  category_confidence: number | null;
}

/** Candidate row, with the current version's text embedded. */
interface CandidateRow {
  id: string;
  title: string;
  category_id: string | null;
  category_source: MetadataSource;
  category_confidence: number | null;
  current_version: {
    extracted_text: string | null;
    original_filename: string | null;
  } | null;
}

type Failure = { ok: false; code: string; message: string };

/**
 * Loads the taxonomy. Split out because both entry points need it and neither
 * needs it before the scope pass, so they can run concurrently.
 */
async function loadTaxonomy(
  supabase: SupabaseClient,
): Promise<
  { ok: true; categories: Category[]; departments: { id: string; name: string }[] } | Failure
> {
  const [{ data: categories, error: catError }, { data: departments, error: deptError }] =
    await Promise.all([
      supabase
        .from('categories')
        .select('id, department_id, name, slug, description, match_keywords, is_active, sort_order')
        .eq('is_active', true),
      supabase.from('departments').select('id, name'),
    ]);

  const error = catError ?? deptError;
  if (error) return { ok: false, ...logAndMap('organize taxonomy query', error) };

  return {
    ok: true,
    categories: (categories ?? []) as Category[],
    departments: (departments ?? []) as { id: string; name: string }[],
  };
}

/**
 * Cheap pass: which documents are even worth examining.
 *
 * `neq('category_source', 'user')` is the server-side half of the scope. It
 * covers both cases we care about — a document with no folder (the upload path
 * records 'system' even when the classifier matched nothing) and one filed
 * automatically. The confidence half is applied here in JS: expressing "null OR
 * below the bar, but only for non-user sources" in PostgREST needs a nested
 * or(and(or(...))) that is easy to get subtly wrong and hard to read.
 *
 * Crucially this runs BEFORE any text is fetched. Applying the confidence rule
 * after a `limit(50)` on the heavy query — which is what an earlier version did —
 * meant the batch could come back almost entirely out of scope while still
 * reporting "more to do", and a second run would return the very same 50 rows.
 *
 * RLS scopes this to documents the caller may see, so a student sweeping cannot
 * enumerate anyone else's files.
 */
async function findInScope(
  supabase: SupabaseClient,
): Promise<{ ok: true; ids: string[]; total: number } | Failure> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, category_id, category_confidence')
    .neq('category_source', 'user')
    .order('updated_at', { ascending: false })
    .limit(SCOPE_SCAN_LIMIT);

  if (error) return { ok: false, ...logAndMap('organize scope query', error) };

  const inScope = ((data ?? []) as unknown as ScopeRow[]).filter(
    (r) =>
      r.category_id === null ||
      r.category_confidence == null ||
      r.category_confidence < LOW_CONFIDENCE_BAR,
  );

  return { ok: true, ids: inScope.map((r) => r.id), total: inScope.length };
}

/**
 * Fetches text for exactly these documents and plans their filing.
 *
 * Bounded by the caller on purpose: `extracted_text` is capped at 200,000 chars
 * per version, so an unbounded fetch is megabytes. Keeping this keyed on an
 * explicit id list is what lets `applyOrganize` re-derive one chunk's targets
 * without re-reading the whole batch.
 */
async function planFor(
  supabase: SupabaseClient,
  categories: Category[],
  departments: { id: string; name: string }[],
  ids: string[],
): Promise<{ ok: true; plan: OrganizePlan } | Failure> {
  if (ids.length === 0) return { ok: true, plan: { proposals: [], skipped: [] } };

  const { data, error } = await supabase
    .from('documents')
    .select(
      `id, title, category_id, category_source, category_confidence,
       current_version:document_versions!documents_current_version_fk
         (extracted_text, original_filename)`,
    )
    .in('id', ids);

  if (error) return { ok: false, ...logAndMap('organize candidates query', error) };

  const candidates: OrganizeCandidate[] = ((data ?? []) as unknown as CandidateRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    filename: r.current_version?.original_filename ?? '',
    text: r.current_version?.extracted_text ?? null,
    currentCategoryId: r.category_id,
    currentConfidence: r.category_confidence,
    currentSource: r.category_source,
  }));

  return { ok: true, plan: planOrganize(categories, departments, candidates) };
}

/**
 * Dry run. Returns what Organize would do, and writes nothing.
 *
 * Note what does NOT cross the wire: `extracted_text` is read here, on the
 * server, and only the resulting proposals (title, folder labels, confidence,
 * matched terms) are serialized to the client. Sending document text to the
 * browser to classify it there would be both slow and a needless disclosure.
 */
export async function previewOrganize(): Promise<ActionResult<OrganizePreview>> {
  await requireSession();
  const supabase = await createClient();

  const [taxonomy, scope] = await Promise.all([loadTaxonomy(supabase), findInScope(supabase)]);
  if (!taxonomy.ok) return fail(taxonomy.code, taxonomy.message);
  if (!scope.ok) return fail(scope.code, scope.message);

  const batch = scope.ids.slice(0, ORGANIZE_BATCH);
  const planned = await planFor(supabase, taxonomy.categories, taxonomy.departments, batch);
  if (!planned.ok) return fail(planned.code, planned.message);

  return succeed({
    ...planned.plan,
    scanned: batch.length,
    hasMore: scope.total > batch.length,
  });
}

/**
 * Files the accepted documents.
 *
 * `documentIds` is the ONLY thing taken from the client. The destination for
 * each one is re-derived here, because a request that carried its own
 * `category_id` would let a caller file any visible document into any folder —
 * the preview is a UI affordance, not an authorization decision. Re-planning is
 * safe and cheap: `planOrganize` is pure and deterministic, so it reproduces
 * exactly what the preview showed, and scope is re-enforced by the planner
 * itself (a user-filed or already-confident document yields no proposal no
 * matter what id was submitted).
 *
 * Writes go through `apply_ai_metadata`, which re-checks visibility, refuses to
 * overwrite a user-chosen folder, and records an audit_logs row per document.
 * `p_source: 'system'` is deliberate: this is keyword matching, and labelling it
 * 'ai' would credit a model that was never called.
 */
export async function applyOrganize(
  documentIds: string[],
): Promise<ActionResult<{ applied: number; failed: number }>> {
  await requireSession();

  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return fail('VALIDATION_ERROR', 'No documents were selected.');
  }
  // Bound the id list so a crafted request cannot force an enormous IN clause
  // and a multi-megabyte text fetch.
  if (documentIds.length > ORGANIZE_BATCH) {
    return fail('VALIDATION_ERROR', `Send at most ${ORGANIZE_BATCH} documents per call.`);
  }

  const supabase = await createClient();

  const taxonomy = await loadTaxonomy(supabase);
  if (!taxonomy.ok) return fail(taxonomy.code, taxonomy.message);

  // Re-plan only the submitted ids, not the whole batch. The client applies in
  // chunks, so re-deriving everything on each call would refetch the same text
  // once per chunk.
  const planned = await planFor(
    supabase,
    taxonomy.categories,
    taxonomy.departments,
    documentIds,
  );
  if (!planned.ok) return fail(planned.code, planned.message);

  const targets = planned.plan.proposals;

  if (targets.length === 0) {
    // Either the selection is stale (someone else re-filed these) or it never
    // matched a proposal. Both are worth saying rather than reporting success.
    return fail(
      'STALE_SELECTION',
      'Those documents no longer need filing. Scan again to see the current state.',
    );
  }

  let applied = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += APPLY_CHUNK) {
    const chunk = targets.slice(i, i + APPLY_CHUNK);

    const outcomes = await Promise.all(
      chunk.map((p) =>
        supabase.rpc('apply_ai_metadata', {
          p_document_id: p.documentId,
          p_document_type: null,
          p_category_id: p.toCategoryId,
          p_department_id: p.toDepartmentId,
          p_confidence: p.confidence,
          // The keyword pass has no opinion on these; passing null leaves any
          // existing value untouched (the RPC coalesces rather than overwrites).
          p_tags: null,
          p_document_date: null,
          p_matched_terms: p.matchedTerms,
          p_source: 'system',
        }),
      ),
    );

    outcomes.forEach(({ error }, index) => {
      if (error) {
        failed++;
        console.error(
          `[applyOrganize] document=${chunk[index]?.documentId} ` +
            `sqlstate=${error.code ?? 'n/a'} message=${JSON.stringify(error.message)}`,
        );
      } else {
        applied++;
      }
    });
  }

  revalidatePath('/workspace');
  revalidatePath('/search');

  // A partial failure is reported as success with a count, not as an error: the
  // documents that moved really did move, and hiding that would be misleading.
  return succeed({ applied, failed });
}

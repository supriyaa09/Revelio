import { classify } from './classify';
import type { Category, Department, MetadataSource } from './types';

/**
 * Minimum confidence to propose a folder at all.
 *
 * Deliberately the same value the processing pipeline uses before it writes a
 * keyword classification (pipeline.ts, the `result.confidence >= 0.35` guard).
 * If these two drifted apart, a bulk sweep and a per-document reprocess could
 * disagree about the same file — one would file it, the other would not — and
 * neither answer would be wrong, which is the worst kind of bug to debug.
 */
export const CONFIDENCE_FLOOR = 0.35;

/**
 * Below this, an existing automatic filing is treated as worth revisiting.
 * A document already filed at or above it is left alone.
 */
export const LOW_CONFIDENCE_BAR = 0.5;

/** Documents scanned per Organize run. Bounds both the query and the payload. */
export const ORGANIZE_BATCH = 50;

export interface OrganizeCandidate {
  id: string;
  title: string;
  filename: string;
  /** Extracted text of the current version, when processing has run. */
  text: string | null;
  currentCategoryId: string | null;
  currentConfidence: number | null;
  currentSource: MetadataSource;
}

export interface OrganizeProposal {
  documentId: string;
  title: string;
  /** "Finance / Invoices", or null when the document is currently unfiled. */
  fromLabel: string | null;
  toCategoryId: string;
  toDepartmentId: string;
  toLabel: string;
  confidence: number;
  matchedTerms: string[];
  /** Which evidence produced this, so the UI can be honest about it. */
  basis: 'extracted_text' | 'title_and_filename';
}

export type SkipReason =
  | 'user_filed'
  | 'no_match'
  | 'low_confidence'
  | 'already_correct'
  | 'confidently_filed';

export interface OrganizeSkip {
  documentId: string;
  title: string;
  reason: SkipReason;
}

export interface OrganizePlan {
  proposals: OrganizeProposal[];
  skipped: OrganizeSkip[];
}

/**
 * What `previewOrganize()` returns.
 *
 * Declared here rather than beside the action because a `'use server'` module
 * may only export async functions, and because the dialog needs this type on
 * the client — importing it from the action file would drag a server module
 * into the browser bundle graph for nothing.
 */
export interface OrganizePreview extends OrganizePlan {
  /** How many documents were examined, so the UI can say "of N scanned". */
  scanned: number;
  /** True when the batch cap was hit and another run would find more. */
  hasMore: boolean;
}

/** Human-readable explanation for each skip reason. */
export const SKIP_LABELS: Record<SkipReason, string> = {
  user_filed: 'You chose this folder yourself',
  no_match: 'No category keywords matched',
  low_confidence: 'Match was too weak to trust',
  already_correct: 'Already in the folder we would pick',
  confidently_filed: 'Already filed with good confidence',
};

/**
 * Decides where each candidate should be filed.
 *
 * Pure by design — no database, no network, no clock. That is what lets
 * `applyOrganize` re-run it server-side to re-derive targets instead of
 * trusting the ones the browser sends back, and what makes it testable without
 * a Supabase connection.
 *
 * Classification itself is delegated to `classify()`, the same deterministic
 * keyword scorer the upload path and the pipeline's AI-unavailable fallback
 * use. Nothing here is AI, and callers must record the result as such.
 */
export function planOrganize(
  categories: Category[],
  departments: Pick<Department, 'id' | 'name'>[],
  candidates: OrganizeCandidate[],
): OrganizePlan {
  const proposals: OrganizeProposal[] = [];
  const skipped: OrganizeSkip[] = [];

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const departmentById = new Map(departments.map((d) => [d.id, d]));

  /**
   * "Finance / Invoices" for a category id, or null if the id is unknown.
   *
   * Lenient on purpose: if the category resolves but its department does not,
   * the bare category name is still more useful to a reader than nothing. Target
   * validation is stricter and is done separately by `isResolvable` — mixing the
   * two concerns here is what made the target guard dead code.
   */
  const labelFor = (categoryId: string | null): string | null => {
    if (!categoryId) return null;
    const category = categoryById.get(categoryId);
    if (!category) return null;
    const department = departmentById.get(category.department_id);
    return department ? `${department.name} / ${category.name}` : category.name;
  };

  /**
   * Whether a category is safe to file *into*. Requires both the category and
   * its department to be present in the taxonomy we were handed: if our view of
   * the taxonomy is partial, we would rather skip than file a document somewhere
   * we cannot even name.
   */
  const isResolvable = (categoryId: string): boolean => {
    const category = categoryById.get(categoryId);
    return Boolean(category && departmentById.has(category.department_id));
  };

  for (const candidate of candidates) {
    const skip = (reason: SkipReason) =>
      skipped.push({ documentId: candidate.id, title: candidate.title, reason });

    // A folder the user picked is theirs. The database enforces this too — see
    // apply_ai_metadata — but filtering here means we never even show a
    // proposal that the write path would silently decline to perform.
    if (candidate.currentSource === 'user') {
      skip('user_filed');
      continue;
    }

    // An automatic filing that already scored well is left alone. Re-running
    // the same classifier over the same text would only reproduce it.
    if (
      candidate.currentCategoryId &&
      candidate.currentConfidence != null &&
      candidate.currentConfidence >= LOW_CONFIDENCE_BAR
    ) {
      skip('confidently_filed');
      continue;
    }

    // Prefer real document text. Falling back to title and filename is the
    // same evidence the upload path had, which is better than nothing for a
    // document that has not been processed yet.
    const hasText = Boolean(candidate.text && candidate.text.trim().length > 0);
    const result = classify(categories, {
      title: candidate.title,
      filename: candidate.filename,
      text: hasText ? candidate.text! : undefined,
    });

    if (!result.categoryId) {
      skip('no_match');
      continue;
    }
    if (result.confidence < CONFIDENCE_FLOOR) {
      skip('low_confidence');
      continue;
    }
    // Proposing a move to where the document already is would inflate the
    // count and produce a write that changes nothing.
    if (result.categoryId === candidate.currentCategoryId) {
      skip('already_correct');
      continue;
    }

    const toLabel = labelFor(result.categoryId);
    if (!result.departmentId || !toLabel || !isResolvable(result.categoryId)) {
      // The classifier picked a category we cannot fully resolve against the
      // taxonomy we were given. Treat as no match rather than filing into it.
      skip('no_match');
      continue;
    }

    proposals.push({
      documentId: candidate.id,
      title: candidate.title,
      fromLabel: labelFor(candidate.currentCategoryId),
      toCategoryId: result.categoryId,
      toDepartmentId: result.departmentId,
      toLabel,
      confidence: result.confidence,
      matchedTerms: result.matchedTerms,
      basis: hasText ? 'extracted_text' : 'title_and_filename',
    });
  }

  // Strongest matches first, so the reviewer's attention goes to the
  // borderline ones last, when they have context for what "good" looks like.
  proposals.sort((a, b) => b.confidence - a.confidence);

  return { proposals, skipped };
}

/** Groups proposals by destination folder for display. */
export function groupByTarget(proposals: OrganizeProposal[]): {
  label: string;
  items: OrganizeProposal[];
}[] {
  const groups = new Map<string, OrganizeProposal[]>();
  for (const p of proposals) {
    const existing = groups.get(p.toLabel);
    if (existing) existing.push(p);
    else groups.set(p.toLabel, [p]);
  }
  return [...groups.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

/**
 * Effective filing year: the date the document itself carries, falling back to
 * when it was uploaded.
 *
 * Shared by the folder tree and the year filter so a document can never appear
 * under one year in the sidebar and a different one in the list.
 */
export function effectiveYear(documentDate: string | null, createdAt: string): number {
  const source = documentDate ?? createdAt;
  const year = Number(source.slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : new Date(createdAt).getFullYear();
}

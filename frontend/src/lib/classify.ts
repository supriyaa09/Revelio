import type { Category } from './types';

export interface ClassificationResult {
  categoryId: string | null;
  departmentId: string | null;
  confidence: number;
  matchedTerms: string[];
}

/**
 * Deterministic keyword classifier used for automatic folder organization.
 *
 * This is NOT AI. It scores each category's `match_keywords` against whatever
 * text we currently hold. At upload time that is the title and filename only;
 * once extraction runs (Phase 3) the same function is re-run with document text,
 * which is why `confidence` and `category_source` are stored alongside the
 * result — the UI can always show how a document came to be filed where it is.
 */
export function classify(
  categories: Category[],
  input: { title: string; filename: string; text?: string },
): ClassificationResult {
  const haystack = [
    // Title and filename repeat so a hit there outweighs a body-text hit.
    input.title,
    input.title,
    input.filename.replace(/[-_]+/g, ' '),
    input.filename.replace(/[-_]+/g, ' '),
    input.text?.slice(0, 20_000) ?? '',
  ]
    .join(' ')
    .toLowerCase();

  if (!haystack.trim()) {
    return { categoryId: null, departmentId: null, confidence: 0, matchedTerms: [] };
  }

  let best: { category: Category; hits: string[]; score: number } | null = null;

  for (const category of categories) {
    if (!category.is_active) continue;

    const hits: string[] = [];
    let score = 0;

    for (const keyword of category.match_keywords) {
      const term = keyword.toLowerCase().trim();
      if (!term) continue;
      const occurrences = countOccurrences(haystack, term);
      if (occurrences > 0) {
        hits.push(keyword);
        // Multi-word phrases are far more discriminating than single tokens.
        const specificity = term.includes(' ') ? 2.5 : 1;
        // Diminishing returns: a term repeated 50 times is not 50x the signal.
        score += specificity * (1 + Math.log(occurrences));
      }
    }

    // The category name itself is a strong signal ("Invoice" in the title).
    if (countOccurrences(haystack, category.name.toLowerCase()) > 0) {
      score += 2;
      hits.push(category.name);
    }

    if (score > 0 && (best === null || score > best.score)) {
      best = { category, hits, score };
    }
  }

  if (!best) {
    return { categoryId: null, departmentId: null, confidence: 0, matchedTerms: [] };
  }

  return {
    categoryId: best.category.id,
    departmentId: best.category.department_id,
    // Squash an unbounded score into 0..1. Two solid phrase hits ≈ 0.7.
    confidence: Math.min(1, Number((best.score / (best.score + 4)).toFixed(2))),
    matchedTerms: [...new Set(best.hits)].slice(0, 6),
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length < 3) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Filename → readable title: "annual-budget_2026.pdf" → "Annual Budget 2026". */
export function deriveTitle(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const spaced = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return 'Untitled document';
  return spaced.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Strips path separators and unsafe characters from an upload filename. */
export function safeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file';
  return (
    base
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120) || 'file'
  );
}

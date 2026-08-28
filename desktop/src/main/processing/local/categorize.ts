/**
 * Document-type detection and category selection for the local analysis engine.
 *
 * document_type: weighted keyword rules (rules.ts) decide the document's FORM
 * (Invoice, Resume, Contract…). category: a short topical label, reusing an
 * existing library category whenever the document's keywords clearly fit one —
 * the local replacement for the AI prompt's "existing categories" hint — and
 * otherwise coined from the document's strongest bigram/keyword.
 */

import { DOC_TYPE_RULES, MIN_TYPE_SCORE } from './rules.ts';
import { isStopword, tokenize, type Token } from './text.ts';
import type { ScoredTerm } from './keywords.ts';

/** An existing library category with representative keywords, from the DB. */
export interface CategoryProfile {
  name: string;
  /** Top keywords of the documents already in this category (lowercase). */
  keywords: string[];
  /** Number of documents in the category. */
  count: number;
}

export interface CategorizationInput {
  tokens: Token[];
  /** Scored unigrams+bigrams for the document (see keywords.scoreTerms). */
  scored: ScoredTerm[];
  /** Existing library categories; plain names are accepted too. */
  existing?: (CategoryProfile | string)[];
}

export interface CategorizationResult {
  documentType: string | null;
  category: string | null;
  confidence: number;
}

/**
 * Scores every doc-type rule against the document and returns the winner,
 * or null when nothing clears MIN_TYPE_SCORE. Per-term contribution is capped
 * at 2 occurrences so keyword-stuffed text cannot inflate one rule.
 */
export function detectDocumentType(tokens: Token[]): { type: string; score: number } | null {
  const stemCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    stemCounts.set(t.stem, (stemCounts.get(t.stem) ?? 0) + 1);
    const next = tokens[i + 1];
    if (next) {
      const key = `${t.stem} ${next.stem}`;
      bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1);
    }
  }

  let best: { type: string; score: number } | null = null;

  for (const rule of DOC_TYPE_RULES) {
    let score = 0;
    for (const [term, weight] of rule.terms) {
      const count = term.includes(' ')
        ? bigramCounts.get(term) ?? 0
        : stemCounts.get(term) ?? 0;
      if (count > 0) score += weight * Math.min(count, 2);
    }
    if (score >= MIN_TYPE_SCORE && (!best || score > best.score)) {
      best = { type: rule.type, score };
    }
  }

  return best;
}

/**
 * Chooses the category. Preference order:
 *  1. An existing library category whose name or members' keywords overlap
 *     this document's top keywords (library stability).
 *  2. A new Title Case label coined from the strongest bigram, else unigram.
 *  3. The document type itself when there is no topical signal at all.
 */
export function pickCategory(input: CategorizationInput): CategorizationResult {
  const docType = detectDocumentType(input.tokens);

  const topKeywords = input.scored
    .filter((t) => !t.bigram)
    .slice(0, 12)
    .map((t) => t.surface.toLowerCase());
  const topStems = new Set(input.scored.slice(0, 12).flatMap((t) => t.stem.split(' ')));

  let reused: string | null = null;
  let bestOverlap = 0;

  for (const entry of input.existing ?? []) {
    const profile: CategoryProfile =
      typeof entry === 'string' ? { name: entry, keywords: [], count: 1 } : entry;

    const nameStems = tokenize(profile.name)
      .filter((t) => !isStopword(t.term))
      .map((t) => t.stem);

    let overlap = 0;
    for (const stem of new Set([...nameStems, ...tokenize(profile.keywords.join(' ')).map((t) => t.stem)])) {
      if (topStems.has(stem)) overlap++;
    }

    // A name match needs only one shared stem ("Finance" ~ finance keywords);
    // a keywords-only match needs two to avoid coincidences.
    const needed = nameStems.some((s) => topStems.has(s)) ? 1 : 2;
    if (overlap >= needed && overlap > bestOverlap) {
      bestOverlap = overlap;
      reused = profile.name;
    }
  }

  let category: string | null = reused;
  if (!category) {
    const coined =
      input.scored.find((t) => t.bigram && t.count >= 2)?.surface ??
      input.scored.find((t) => !t.bigram)?.surface ??
      null;
    category = coined ? toTitleCase(coined) : docType ? docType.type : null;
  }

  // Heuristic confidence in the chosen category.
  let confidence = 0.35;
  if (reused) confidence += 0.3;
  if (docType && docType.score >= 5) confidence += 0.2;
  if ((input.scored[0]?.count ?? 0) >= 3) confidence += 0.15;
  if (!category) confidence = 0;

  return {
    documentType: docType?.type ?? null,
    category,
    confidence: Math.round(Math.min(1, confidence) * 100) / 100,
  };
}

/** "machine learning" → "Machine Learning"; small words stay lowercase mid-label. */
export function toTitleCase(label: string): string {
  const small = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'on', 'at', 'by']);
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

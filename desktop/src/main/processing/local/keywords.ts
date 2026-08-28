/**
 * Keyword extraction for the local analysis engine.
 *
 * Approach: TF scoring over stems with three boosts — proper nouns (likely
 * topical names), long terms (more specific), and filename/title overlap
 * (what the file is called is a strong signal of what it is about). Bigrams
 * are scored separately and suppress their component unigrams so the output
 * prefers "machine learning" over "machine" + "learning".
 */

import { isStopword, tokenize, type Token } from './text.ts';
import { NOISE_TERMS } from './rules.ts';

export interface KeywordOptions {
  /** Document title (may be empty). Terms found in it are boosted. */
  title?: string;
  /** Filename without directory. Terms found in it are boosted. */
  filename?: string;
  /** Maximum keywords to return. Default 8. */
  max?: number;
}

export interface ScoredTerm {
  /** Stem used for grouping/dedup. */
  stem: string;
  /** Lowercased display form. */
  surface: string;
  count: number;
  score: number;
  /** True when this entry is a bigram ("a b"). */
  bigram: boolean;
}

/** True when a token's casing suggests a proper noun, not a sentence start. */
function isProperNoun(tokens: Token[], i: number): boolean {
  const t = tokens[i]!;
  if (!/^[A-Z]/.test(t.raw)) return false;

  // Document start is ambiguous — treat it as a possible proper noun only when
  // the NEXT token is also capitalised ("John Smith", not "The quick").
  if (i === 0) return /^[A-Z]/.test(tokens[1]?.raw ?? '');

  // A token right after sentence-terminal punctuation is a sentence start.
  const prev = tokens[i - 1]!;
  if (/[.!?]$/.test(prev.raw)) return false;

  return true;
}

/**
 * Scores unigrams and bigrams across the token stream.
 *
 * Exported (not just used internally) because categorize.ts reuses the score
 * table to pick category names.
 */
export function scoreTerms(tokens: Token[], opts: KeywordOptions = {}): ScoredTerm[] {
  const boostStems = new Set<string>();
  for (const t of tokenize(`${opts.title ?? ''} ${opts.filename ?? ''}`)) {
    if (!isStopword(t.term) && !NOISE_TERMS.has(t.term)) boostStems.add(t.stem);
  }

  const unigrams = new Map<string, ScoredTerm & { proper: number }>();
  const bigrams = new Map<string, ScoredTerm>();

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isStopword(t.term) || NOISE_TERMS.has(t.term)) continue;

    const u = unigrams.get(t.stem) ?? {
      stem: t.stem,
      surface: t.term,
      count: 0,
      score: 0,
      bigram: false,
      proper: 0,
    };
    u.count++;
    if (isProperNoun(tokens, i)) u.proper++;
    // Keep the longest surface form as the display representative.
    if (t.term.length > u.surface.length) u.surface = t.term;
    unigrams.set(t.stem, u);

    // Bigram with the next content token, allowing one stopword between
    // ("department of finance" → "department finance").
    const j = nextContentToken(tokens, i);
    if (j !== -1) {
      const t2 = tokens[j]!;
      const key = `${t.stem} ${t2.stem}`;
      const b = bigrams.get(key) ?? {
        stem: key,
        surface: `${t.term} ${t2.term}`,
        count: 0,
        score: 0,
        bigram: true,
      };
      b.count++;
      bigrams.set(key, b);
    }
  }

  const out: ScoredTerm[] = [];

  for (const u of unigrams.values()) {
    let score = u.count;
    if (u.proper > 0) score *= 1.5;
    if (u.surface.length >= 9) score *= 1.2;
    if (boostStems.has(u.stem)) score *= 1.75;
    out.push({ stem: u.stem, surface: u.surface, count: u.count, score, bigram: false });
  }

  for (const b of bigrams.values()) {
    let score = b.count * 2; // bigrams are more specific than their halves
    if (b.surface.split(' ').some((w) => boostStems.has(w))) score *= 1.75;
    out.push({ ...b, score });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Index of the next non-stopword, non-noise token after i, or -1. */
function nextContentToken(tokens: Token[], i: number): number {
  for (let j = i + 1; j < tokens.length && j <= i + 2; j++) {
    const t = tokens[j]!;
    if (!isStopword(t.term) && !NOISE_TERMS.has(t.term)) return j;
  }
  return -1;
}

/**
 * Extracts 3–`max` lowercase keywords from document text.
 *
 * A chosen bigram suppresses its component unigrams, and duplicate surfaces
 * are dropped. Returns fewer than 3 only when the text genuinely has less
 * signal than that.
 */
export function extractKeywords(text: string, opts: KeywordOptions = {}): string[] {
  return extractKeywordsFromTokens(tokenize(text), opts);
}

/** Same as extractKeywords, but over an existing token stream. */
export function extractKeywordsFromTokens(tokens: Token[], opts: KeywordOptions = {}): string[] {
  const max = opts.max ?? 8;
  const scored = scoreTerms(tokens, opts);

  const chosen: ScoredTerm[] = [];
  const usedStems = new Set<string>();

  for (const term of scored) {
    if (chosen.length >= max) break;

    if (term.bigram) {
      const [a, b] = term.stem.split(' ');
      if (usedStems.has(a!) || usedStems.has(b!)) continue;
      chosen.push(term);
      usedStems.add(a!);
      usedStems.add(b!);
    } else {
      if (usedStems.has(term.stem)) continue;
      chosen.push(term);
      usedStems.add(term.stem);
    }
  }

  const seen = new Set<string>();
  return chosen
    .map((t) => t.surface.toLowerCase())
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

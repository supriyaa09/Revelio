/**
 * Text mechanics for the local analysis engine: tokenization, lightweight
 * stemming, and sentence splitting.
 *
 * Pure functions, no dependencies, no Electron or DB imports — plain Node can
 * load this module directly, which is how the test suite exercises it.
 */

import { STOPWORDS } from './rules.ts';

/** One word token with its normalized stem and position in the token stream. */
export interface Token {
  /** Lowercased surface form, e.g. "invoices". */
  term: string;
  /** Original casing as it appeared in the text, for proper-noun detection. */
  raw: string;
  /** Stemmed grouping key, e.g. "invoice". */
  stem: string;
  /** Ordinal position in the token stream (0-based). */
  index: number;
}

/**
 * A word: starts with a letter, may contain digits, and allows ONE internal
 * apostrophe or hyphen ("don't", "peer-reviewed", "gpt4"). Matching is global
 * so tokenization also works on OCR text with odd spacing.
 */
const WORD_RE = /[A-Za-z][A-Za-z0-9]*(?:['’-][A-Za-z0-9]+)?/g;

/**
 * Splits text into lowercase tokens. Pure-number tokens are dropped (dates and
 * amounts are handled by dedicated regexes in entities.ts), as are single
 * characters, which are almost always OCR noise or list bullets.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  for (const match of text.matchAll(WORD_RE)) {
    const raw = match[0];
    const term = raw.toLowerCase().replace('’', "'");
    if (term.length < 2) continue;
    if (!/[a-z]/.test(term)) continue;

    tokens.push({ term, raw, stem: stemWord(term), index });
    index++;
  }

  return tokens;
}

/** True when the term is a stopword (checked against the unstemmed form). */
export function isStopword(term: string): boolean {
  return STOPWORDS.has(term);
}

/**
 * Lightweight suffix stemmer. Deliberately conservative — it exists to group
 * obvious inflections ("invoices"/"invoice", "testing"/"test"), not to be a
 * Porter implementation. Words under 4 characters are never touched, and the
 * riskier suffixes (-ies, -ing, -ed, -ly) each carry their own length guards,
 * so short words ("was", "has", "menu") can never be mangled.
 *
 * The stem is a grouping key only: keyword output always prefers the original
 * surface form (see keywords.ts).
 */
export function stemWord(word: string): string {
  if (word.length < 4) return word;

  let w = word;

  // -ies → -y  ("categories" → "category") — gated at 5+ so "pies" stays put
  if (w.length >= 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';

  // -sses → -ss  ("classes" → "class")
  if (w.endsWith('sses')) return w.slice(0, -2);

  // plural -s, but keep -us/-is/-ss endings ("bus", "this", "class")
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    return w.slice(0, -1);
  }

  // -ing, undoing consonant doubling except for 's' ("running" → "run",
  // but "processing" → "process", not "proces")
  if (w.endsWith('ing') && w.length - 3 >= 3) {
    const base = w.slice(0, -3);
    if (
      base.length >= 3 &&
      base[base.length - 1] === base[base.length - 2] &&
      base[base.length - 1] !== 's'
    ) {
      return base.slice(0, -1);
    }
    return base;
  }

  // -ed  ("invoiced" → "invoic" — imperfect but stable for grouping)
  if (w.endsWith('ed') && w.length - 2 >= 3) {
    const base = w.slice(0, -2);
    if (
      base.length >= 3 &&
      base[base.length - 1] === base[base.length - 2] &&
      base[base.length - 1] !== 's'
    ) {
      return base.slice(0, -1);
    }
    return base;
  }

  // -ly  ("quickly" → "quick")
  if (w.endsWith('ly') && w.length - 2 >= 3) return w.slice(0, -2);

  return w;
}

/** A sentence with its character offset in the source text. */
export interface Sentence {
  /** Whitespace-normalized sentence text, terminal punctuation kept. */
  text: string;
  /** Character offset of the sentence start in the source text. */
  start: number;
}

/**
 * Abbreviations that must not end a sentence when followed by a period.
 * Lowercase, without the dot. Single capital letters ("J. Smith") are handled
 * separately by length.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie',
  'co', 'ltd', 'inc', 'corp', 'dept', 'approx', 'no', 'fig', 'figs', 'vol',
  'pp', 'al', 'gen', 'gov', 'sgt', 'capt', 'mt', 'ft', 'avg', 'min', 'max',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct',
  'nov', 'dec',
]);

/** Sentences longer than this are almost always OCR/run-on garbage; cut them. */
const MAX_SENTENCE_CHARS = 600;

/**
 * Splits text into sentences.
 *
 * Boundaries: `.`, `!`, `?` followed by whitespace and a capital letter or
 * digit (the capital requirement stops "e.g. this" and decimal numbers from
 * splitting), plus paragraph breaks — a blank line always ends a sentence,
 * which matters for forms and slides where punctuation is absent.
 *
 * `limit` caps how many sentences are returned; callers scanning a 100-page
 * OCR dump do not need sentence 4,000.
 */
export function splitSentences(text: string, limit = 800): Sentence[] {
  const sentences: Sentence[] = [];
  const n = text.length;
  let start = indexOfFirstNonSpace(text, 0);
  let i = start;

  const flush = (endExclusive: number) => {
    const raw = text.slice(start, endExclusive).replace(/\s+/g, ' ').trim();
    if (raw.length > 0) {
      sentences.push({ text: raw.length > MAX_SENTENCE_CHARS ? raw.slice(0, MAX_SENTENCE_CHARS) : raw, start });
    }
    start = indexOfFirstNonSpace(text, endExclusive);
    i = start;
  };

  while (i < n && sentences.length < limit) {
    const ch = text[i];

    // Paragraph break: blank line ends the current sentence.
    if (ch === '\n') {
      const next = text.indexOf('\n', i + 1);
      const onlySpacesBetween =
        next !== -1 && text.slice(i + 1, next).trim() === '' && text.slice(start, i).trim() !== '';
      if (onlySpacesBetween) {
        flush(i);
        i = start;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      // Consume a run of terminals ("...", "?!").
      let end = i;
      while (end + 1 < n && '.!?'.includes(text[end + 1]!)) end++;

      const after = end + 1 < n ? text[end + 1]! : '';
      const boundary =
        after === '' ||
        after === '\n' ||
        (/\s/.test(after) && startsNewSentence(text, end + 1));

      if (boundary && !isAbbreviationDot(text, i, ch)) {
        flush(end + 1);
        continue;
      }
    }

    i++;
  }

  if (sentences.length < limit && start < n) flush(n);

  return sentences;
}

/** True when the non-space text at `from` begins with a capital letter, digit or opening quote. */
function startsNewSentence(text: string, from: number): boolean {
  for (let j = from; j < text.length; j++) {
    const c = text[j]!;
    if (c === ' ' || c === '\t' || c === '\r') continue;
    return /[A-Z0-9"'“‘(\[]/.test(c);
  }
  return false;
}

/** True when this period belongs to an abbreviation or a single initial. */
function isAbbreviationDot(text: string, dotIndex: number, ch: string): boolean {
  if (ch !== '.') return false;

  // Walk back over the preceding word.
  let j = dotIndex - 1;
  while (j >= 0 && /[A-Za-z.]/.test(text[j]!)) j--;
  const word = text.slice(j + 1, dotIndex).toLowerCase().replace(/\./g, '');

  if (word.length === 0) return false;
  if (word.length === 1) return /[a-z]/i.test(word); // initial: "J."
  return ABBREVIATIONS.has(word);
}

function indexOfFirstNonSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

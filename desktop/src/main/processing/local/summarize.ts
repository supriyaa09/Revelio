/**
 * Extractive summarization for the local analysis engine.
 *
 * Sentences are scored by how much of the document's topical vocabulary they
 * carry, with boosts for early position and title overlap, and a penalty for
 * unusual length. The top sentences (in document order) become the summary;
 * the next-best become key points. Nothing is generated — only selected — so
 * the summary can never invent facts.
 */

import { isStopword, splitSentences, tokenize } from './text.ts';
import { NOISE_TERMS } from './rules.ts';

export interface SummaryResult {
  /** 2–4 sentences joined into one paragraph, or null when text is too thin. */
  summary: string | null;
  /** Up to 3 additional noteworthy sentences, not part of the summary. */
  keyPoints: string[];
}

/** Sentences shorter than this rarely carry content. */
const MIN_SENTENCE_WORDS = 4;

/** OCR run-ons longer than this get a heavy score penalty. */
const MAX_GOOD_SENTENCE_WORDS = 45;

/** Summary length target by document size. */
function summarySentenceCount(sentenceCount: number): number {
  if (sentenceCount <= 6) return 2;
  if (sentenceCount <= 20) return 3;
  return 4;
}

/**
 * Builds an extractive summary + key points from document text.
 * `title` (when present) nudges scoring toward sentences that mention the
 * document's own subject.
 */
export function summarize(text: string, title = ''): SummaryResult {
  const sentences = splitSentences(text);

  // Document-level term frequencies over content stems.
  const docFreq = new Map<string, number>();
  const allTokens = tokenize(text);
  for (const t of allTokens) {
    if (isStopword(t.term) || NOISE_TERMS.has(t.term)) continue;
    docFreq.set(t.stem, (docFreq.get(t.stem) ?? 0) + 1);
  }

  const titleStems = new Set(
    tokenize(title)
      .filter((t) => !isStopword(t.term) && !NOISE_TERMS.has(t.term))
      .map((t) => t.stem),
  );

  interface Scored {
    text: string;
    start: number;
    score: number;
    order: number;
  }

  const scored: Scored[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const tokens = tokenize(s.text);
    const wordCount = tokens.length;
    if (wordCount < MIN_SENTENCE_WORDS) continue;

    // Letter ratio guards against OCR garbage ("| | | _ _ 123").
    const letters = s.text.replace(/[^A-Za-z]/g, '').length;
    if (letters / Math.max(1, s.text.length) < 0.4) continue;

    // Sum the document frequencies of this sentence's distinct content stems,
    // capped per term so one repeated word cannot dominate.
    const seen = new Set<string>();
    let topicality = 0;
    let titleHits = 0;
    for (const t of tokens) {
      if (isStopword(t.term) || NOISE_TERMS.has(t.term) || seen.has(t.stem)) continue;
      seen.add(t.stem);
      topicality += Math.min(docFreq.get(t.stem) ?? 0, 6);
      if (titleStems.has(t.stem)) titleHits++;
    }
    if (topicality === 0) continue;

    let score = topicality / Math.sqrt(wordCount);

    // Position: documents state their subject early.
    if (i === 0) score *= 1.6;
    else if (i === 1) score *= 1.25;

    if (titleHits > 0) score *= 1 + Math.min(titleHits, 3) * 0.3;
    if (wordCount > MAX_GOOD_SENTENCE_WORDS) score *= 0.5;

    scored.push({ text: s.text, start: s.start, score, order: i });
  }

  if (scored.length === 0) return { summary: null, keyPoints: [] };

  const ranked = [...scored].sort((a, b) => b.score - a.score);

  const want = Math.min(summarySentenceCount(scored.length), ranked.length);
  const summaryPicks = ranked.slice(0, want).sort((a, b) => a.order - b.order);

  let summary = summaryPicks.map((s) => s.text).join(' ');
  // Keep the summary block digestible; drop trailing sentences if oversized.
  while (summary.length > 600 && summaryPicks.length > 1) {
    summaryPicks.pop();
    summary = summaryPicks.map((s) => s.text).join(' ');
  }

  const inSummary = new Set(summaryPicks.map((s) => s.order));
  const keyPoints = ranked
    .filter((s) => !inSummary.has(s.order))
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map((s) => (s.text.length > 220 ? `${s.text.slice(0, 217)}…` : s.text));

  return { summary, keyPoints };
}

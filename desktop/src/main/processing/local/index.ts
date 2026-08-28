/**
 * The local analysis engine: turns extracted document text into structured
 * metadata — keywords, summary, key points, document type, category, entities
 * and dates — entirely on this machine.
 *
 * This is the keyless replacement for the Anthropic/AgentRouter call the app
 * used to make. It keeps the exact field shape of the old `AiAnalysis`
 * contract so the DB layer, IPC and UI are unaffected; `analyze.ts` wraps it
 * in the same `AiOutcome` honesty contract as before.
 *
 * Pure and dependency-free: plain Node tests import it directly.
 */

import { tokenize } from './text.ts';
import { extractKeywordsFromTokens, scoreTerms } from './keywords.ts';
import { summarize } from './summarize.ts';
import { pickCategory, type CategoryProfile } from './categorize.ts';
import { extractEntities } from './entities.ts';

/** Recorded as `ai_model` on analyzed rows; shown in the UI badge. */
export const LOCAL_MODEL_NAME = 'revelio-local';

/**
 * Analysis is bounded to this many characters. Local scoring is cheap, but a
 * 500-page OCR dump gains nothing from sentence 20,000 onward, and the cap
 * keeps worst-case indexing time predictable.
 */
const MAX_ANALYSIS_CHARS = 60_000;

/** Same nine fields as the previous model-produced contract. */
export interface LocalAnalysis {
  document_type: string | null;
  category: string | null;
  keywords: string[];
  summary: string | null;
  key_points: string[];
  entities: { name: string; type: string }[];
  important_dates: { label: string; date: string; is_deadline: boolean }[];
  document_date: string | null;
  confidence: number;
}

export interface LocalAnalysisInput {
  text: string;
  title: string;
  filename: string;
  /**
   * Categories already present in the library, optionally with representative
   * keywords (see db.categoryKeywordProfiles). Used to keep naming stable.
   */
  existingCategories?: (CategoryProfile | string)[];
}

/** Runs the full local analysis pipeline over one document. */
export function analyzeLocally(input: LocalAnalysisInput): LocalAnalysis {
  const text = input.text.slice(0, MAX_ANALYSIS_CHARS);
  const title = input.title ?? '';
  const filename = input.filename ?? '';

  const tokens = tokenize(text);
  const scored = scoreTerms(tokens, { title, filename });

  const keywords = extractKeywordsFromTokens(tokens, { title, filename });
  const { summary, keyPoints } = summarize(text, title);
  const { documentType, category, confidence } = pickCategory({
    tokens,
    scored,
    existing: input.existingCategories,
  });
  const { entities, importantDates, documentDate } = extractEntities(text);

  return {
    document_type: documentType,
    category,
    keywords,
    summary,
    key_points: keyPoints,
    entities,
    important_dates: importantDates,
    document_date: documentDate,
    confidence,
  };
}

export type { CategoryProfile } from './categorize.ts';

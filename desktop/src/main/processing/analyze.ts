/**
 * Document analysis for Revelio Desktop — 100% on-device.
 *
 * Phase 2 replaced the Anthropic/AgentRouter model call with the built-in,
 * deterministic engine in `./local`. Nothing leaves the machine: no API key,
 * no network call, no provider configuration.
 *
 * What is preserved from the key era:
 *  - The `AiAnalysis` contract (nine fields), so the DB layer, IPC and UI
 *    needed no structural change.
 *  - The `AiOutcome` honesty contract: every failure path returns ok:false
 *    with a machine-readable reason. Nothing is shown as analysis output
 *    unless ok is true.
 *
 * The reason set shrank with the failure modes: a local engine cannot run out
 * of API key, refuse, or return malformed JSON — it either has no text to
 * work on (NO_TEXT) or it threw (ANALYSIS_ERROR).
 */

import { analyzeLocally, LOCAL_MODEL_NAME, type LocalAnalysisInput } from './local/index.ts';

if ('window' in globalThis) {
  throw new Error('processing/analyze.ts is main-process only.');
}

/** Structured metadata produced for one document. Every field is optional-by-emptiness. */
export interface AiAnalysis {
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

export interface AiOutcome {
  ok: boolean;
  analysis: AiAnalysis | null;
  model: string | null;
  reason?: 'NO_TEXT' | 'ANALYSIS_ERROR';
  detail?: string;
}

/** Minimum extractable text before analysis is worth running. */
const MIN_ANALYSIS_CHARS = 40;

/**
 * Structured analysis of extracted document text, computed locally.
 *
 * `existingCategories` are the categories already present in the library
 * (optionally with representative keywords), used to keep naming stable —
 * the local replacement for the old prompt's "existing categories" hint.
 */
export async function analyseDocument(input: {
  text: string;
  title: string;
  filename: string;
  existingCategories?: LocalAnalysisInput['existingCategories'];
}): Promise<AiOutcome> {
  const text = input.text.trim();
  if (text.length < MIN_ANALYSIS_CHARS) {
    return { ok: false, analysis: null, model: null, reason: 'NO_TEXT' };
  }

  try {
    const analysis = analyzeLocally({
      text,
      title: input.title,
      filename: input.filename,
      existingCategories: input.existingCategories,
    });
    return { ok: true, analysis, model: LOCAL_MODEL_NAME };
  } catch (error) {
    return {
      ok: false,
      analysis: null,
      model: LOCAL_MODEL_NAME,
      reason: 'ANALYSIS_ERROR',
      detail: describeError(error),
    };
  }
}

/** Keeps an unexpected engine error actionable in the log and the DB. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

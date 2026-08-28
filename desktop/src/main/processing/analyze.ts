/**
 * AI analysis for Revelio Desktop.
 *
 * Adapted from the web pipeline (`frontend/src/lib/processing/analyze.ts`).
 * The institutional version constrained the model to a seeded department /
 * category taxonomy via schema enums. A personal-files assistant has no fixed
 * taxonomy — the user's library defines its own. So the category becomes a
 * free-form string, and the model is handed the *existing* category names in
 * the library as consistency hints: reuse one when the document clearly fits,
 * coin a short new one when it does not. That is what keeps auto-categorization
 * stable instead of inventing a fresh synonym per file.
 *
 * Everything else is preserved from the web pipeline:
 *  - JSON-only output, enforced by structured outputs on Anthropic and by a
 *    stated contract on AgentRouter (which ignores output_config).
 *  - The `AiOutcome` honesty contract: every failure path returns ok:false with
 *    a machine-readable reason. Nothing is shown as AI output unless ok is true.
 *  - Defensive `coerce()` on the parsed result.
 *
 * Server-only: it reads credentials, so it must never be bundled into the
 * renderer.
 */

import {
  callAgentRouter,
  resolveProvider,
  type MessagesResponse,
  type ProviderConfig,
} from './providers';

if ('window' in globalThis) {
  throw new Error('processing/analyze.ts is main-process only.');
}

/** Shape the model is forced to return. Every field is optional-by-emptiness. */
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
  reason?: 'NO_API_KEY' | 'NO_TEXT' | 'API_ERROR' | 'MALFORMED_OUTPUT' | 'REFUSED';
  detail?: string;
}

/** Characters of document text sent to the model. */
const MAX_PROMPT_CHARS = 24_000;

/** Ceiling covers adaptive-thinking reasoning tokens plus the JSON answer. */
const MAX_OUTPUT_TOKENS = 16_000;

/** Bounded extraction is not a hard reasoning problem; keep latency sane. */
const ANALYSIS_EFFORT = 'medium' as const;

/**
 * Structured analysis of extracted document text.
 *
 * `env` is the settings-overlaid environment (see settings.buildAiEnv) so the
 * in-app key/provider/model take effect without mutating process.env.
 * `existingCategories` are the category names already present in the library,
 * passed as consistency hints.
 */
export async function analyseDocument(input: {
  text: string;
  title: string;
  filename: string;
  existingCategories: string[];
  env?: Record<string, string | undefined>;
}): Promise<AiOutcome> {
  const config = resolveProvider(input.env ?? process.env);

  if (!config.apiKey) {
    return { ok: false, analysis: null, model: null, reason: 'NO_API_KEY' };
  }

  const text = input.text.trim();
  if (text.length < 40) {
    return { ok: false, analysis: null, model: null, reason: 'NO_TEXT' };
  }

  const model = config.model;

  const hints = input.existingCategories
    .filter((c) => typeof c === 'string' && c.length > 0)
    .slice(0, 40);
  const hintLine = hints.length > 0 ? hints.map((c) => `- ${c}`).join('\n') : '(none yet)';

  const system = [
    'You analyse a person\'s local documents and return structured metadata that helps them find and organise the file later.',
    '',
    'Rules:',
    '- Use ONLY information present in the document text and filename. Never invent facts.',
    '- category: a single short label (1-4 words, Title Case) describing what this document is about. Prefer reusing one of the existing categories below when the document clearly fits; otherwise coin a concise new one. Examples of good categories: Programming, Research Papers, Finance, College Notes, Books, Personal, Projects, Invoices, Contracts.',
    '- keywords: 3-10 short lowercase search terms someone might use to find this file again. Include topics, technologies, and proper nouns.',
    '- Dates must be ISO (YYYY-MM-DD). Omit dates you cannot resolve; do not guess a year.',
    '- is_deadline is true only for dates the document presents as a due date, closing date or last date.',
    '- summary: 2-4 sentences, factual, no preamble.',
    '- confidence is your own 0..1 estimate that the chosen category is correct.',
    '- If the document is unreadable or contains no meaningful content, return nulls and empty arrays.',
    '',
    'Existing categories in this library (reuse when appropriate):',
    hintLine,
    // AgentRouter accepts output_config and then IGNORES it, so on that
    // provider the contract has to be stated in the prompt as well.
    ...(config.provider === 'agentrouter' ? ['', jsonContractInstruction()] : []),
  ].join('\n');

  const userMessage = [
    `Filename: ${input.filename}`,
    `Title: ${input.title}`,
    '',
    'Document text:',
    '"""',
    text.slice(0, MAX_PROMPT_CHARS),
    '"""',
  ].join('\n');

  const schema = buildAnalysisSchema();

  const requestBody = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // No temperature: sampling parameters are rejected on Claude Opus 5.
    thinking: { type: 'adaptive' },
    output_config: { effort: ANALYSIS_EFFORT, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: userMessage }],
  };

  try {
    const response = await sendMessages(config, requestBody);

    if (response.stop_reason === 'refusal') {
      return {
        ok: false,
        analysis: null,
        model,
        reason: 'REFUSED',
        detail: response.stop_details?.explanation ?? response.stop_details?.category ?? undefined,
      };
    }

    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        analysis: null,
        model,
        reason: 'MALFORMED_OUTPUT',
        detail: `output truncated at max_tokens (${MAX_OUTPUT_TOKENS})`,
      };
    }

    // Both providers return thinking blocks before the answer, so find the text
    // block rather than assuming content[0].
    const raw = response.content?.find((b) => b.type === 'text')?.text;
    if (!raw) {
      return { ok: false, analysis: null, model, reason: 'MALFORMED_OUTPUT', detail: 'empty response' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch {
      return {
        ok: false,
        analysis: null,
        model,
        reason: 'MALFORMED_OUTPUT',
        detail: `not valid JSON: ${raw.slice(0, 200)}`,
      };
    }

    return { ok: true, analysis: coerce(parsed), model };
  } catch (error) {
    return {
      ok: false,
      analysis: null,
      model,
      reason: 'API_ERROR',
      detail: describeError(error),
    };
  }
}

/**
 * The JSON Schema the response is constrained to. Free-form strings replace the
 * web version's taxonomy enums; everything else is identical.
 */
export function buildAnalysisSchema(): Record<string, unknown> {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const nullableDate = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] };

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'document_type',
      'category',
      'keywords',
      'summary',
      'key_points',
      'entities',
      'important_dates',
      'document_date',
      'confidence',
    ],
    properties: {
      document_type: nullableString,
      category: nullableString,
      keywords: { type: 'array', items: { type: 'string' } },
      summary: nullableString,
      key_points: { type: 'array', items: { type: 'string' } },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type'],
          properties: { name: { type: 'string' }, type: { type: 'string' } },
        },
      },
      important_dates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'date', 'is_deadline'],
          properties: {
            label: { type: 'string' },
            date: { type: 'string', format: 'date' },
            is_deadline: { type: 'boolean' },
          },
        },
      },
      document_date: nullableDate,
      confidence: { type: 'number' },
    },
  };
}

/** Sends one Messages request through the selected provider. */
async function sendMessages(
  config: ProviderConfig,
  body: Record<string, unknown>,
): Promise<MessagesResponse> {
  if (config.provider === 'agentrouter') {
    return callAgentRouter(config, body);
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.apiKey ?? undefined, baseURL: config.baseUrl });

  const create = client.messages.create.bind(client.messages) as unknown as (
    params: Record<string, unknown>,
  ) => Promise<MessagesResponse>;

  return create(body);
}

/** The response contract, stated in the prompt, for providers that ignore output_config. */
export function jsonContractInstruction(): string {
  return [
    'OUTPUT FORMAT — this is strict:',
    'Return ONE JSON object and nothing else. No markdown code fences, no prose',
    'before or after, no explanation, and no keys beyond the nine listed here.',
    '',
    'Exactly these keys, all of them required, using null for anything the',
    'document does not state:',
    '  "document_type":    string | null',
    '  "category":         string | null  (1-4 words, Title Case)',
    '  "keywords":         array of strings (may be empty)',
    '  "summary":          string | null',
    '  "key_points":       array of strings (may be empty)',
    '  "entities":         array of { "name": string, "type": string }',
    '  "important_dates":  array of { "label": string, "date": "YYYY-MM-DD", "is_deadline": boolean }',
    '  "document_date":    "YYYY-MM-DD" | null',
    '  "confidence":       number between 0 and 1',
  ].join('\n');
}

/**
 * Pulls the JSON object out of a model response. Brace matching is
 * string-aware: a `}` inside a summary must not end the object early.
 */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();

  const fenced = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  if (text.startsWith('{') && text.endsWith('}')) return text;

  const start = text.indexOf('{');
  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return text.slice(start);
}

/** Keeps a provider error actionable in the log without leaking the key. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    return status ? `${error.name} ${status}: ${error.message}` : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** Defensive normalisation. A schema-constrained response is still untrusted input. */
export function coerce(value: unknown): AiAnalysis {
  const o = (value ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : null;
  };
  const strArray = (v: unknown, limit: number): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, limit)
      : [];

  const isoDate = (v: unknown): string | null => {
    const s = str(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const entities = Array.isArray(o.entities)
    ? o.entities
        .map((e) => {
          const r = (e ?? {}) as Record<string, unknown>;
          const name = str(r.name);
          return name ? { name, type: str(r.type) ?? 'unknown' } : null;
        })
        .filter((e): e is { name: string; type: string } => e !== null)
        .slice(0, 40)
    : [];

  const importantDates = Array.isArray(o.important_dates)
    ? o.important_dates
        .map((d) => {
          const r = (d ?? {}) as Record<string, unknown>;
          const date = isoDate(r.date);
          return date
            ? { label: str(r.label) ?? 'Date', date, is_deadline: r.is_deadline === true }
            : null;
        })
        .filter((d): d is { label: string; date: string; is_deadline: boolean } => d !== null)
        .slice(0, 25)
    : [];

  const confidenceRaw = Number.isFinite(o.confidence) ? (o.confidence as number) : 0;

  return {
    document_type: str(o.document_type),
    category: str(o.category),
    keywords: strArray(o.keywords, 12),
    summary: str(o.summary),
    key_points: strArray(o.key_points, 12),
    entities,
    important_dates: importantDates,
    document_date: isoDate(o.document_date),
    confidence: Math.max(0, Math.min(1, confidenceRaw)),
  };
}

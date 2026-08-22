import type { Category, Department } from '@/lib/types';

// ANTHROPIC_API_KEY is server-side only and is never prefixed NEXT_PUBLIC_, so
// it would simply be undefined in a browser bundle — the call would fail with
// NO_API_KEY and look like a configuration problem. Fail loudly instead: this
// module may only be reached from Server Actions and Route Handlers.
if (typeof window !== 'undefined') {
  throw new Error(
    'processing/analyze.ts is server-only. Do not import it from a client component.',
  );
}

/** Shape the model is forced to return. Every field is optional-by-emptiness. */
export interface AiAnalysis {
  document_type: string | null;
  department_slug: string | null;
  category_slug: string | null;
  tags: string[];
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
  /** Machine-readable reason when ok is false, for honest UI messaging. */
  reason?: 'NO_API_KEY' | 'NO_TEXT' | 'API_ERROR' | 'MALFORMED_OUTPUT' | 'REFUSED';
  detail?: string;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/** Characters of document text sent to the model. */
const MAX_PROMPT_CHARS = 24_000;

/**
 * Adaptive thinking spends output tokens before the JSON is emitted, so this
 * ceiling covers reasoning + the answer. Too low and the JSON is truncated
 * mid-object, which surfaces as MALFORMED_OUTPUT rather than a clean failure.
 */
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * Extraction from a bounded document is not a hard reasoning problem, and this
 * call sits inside a pipeline that has already spent time on OCR. `medium`
 * keeps latency reasonable; raise it if classification quality disappoints.
 */
const ANALYSIS_EFFORT = 'medium' as const;

/**
 * Structured analysis of extracted document text.
 *
 * Design rules:
 *  * Returns JSON only, enforced by `output_config.format` (structured outputs),
 *    so we never regex a summary out of prose.
 *  * The model chooses from the *actual* seeded taxonomy by slug, constrained by
 *    a schema enum, so an invented department or category cannot be emitted at
 *    all. `pipeline.ts` still resolves the slug against the database, so the
 *    guarantee survives even if the enum is ever dropped.
 *  * Every failure path returns ok:false with a reason. Callers must not display
 *    anything as AI output unless ok is true.
 */
export async function analyseDocument(input: {
  text: string;
  title: string;
  filename: string;
  departments: Pick<Department, 'slug' | 'name'>[];
  categories: (Pick<Category, 'slug' | 'name' | 'description'> & { department_slug: string })[];
}): Promise<AiOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, analysis: null, model: null, reason: 'NO_API_KEY' };
  }

  const text = input.text.trim();
  if (text.length < 40) {
    return { ok: false, analysis: null, model: null, reason: 'NO_TEXT' };
  }

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;

  // The Anthropic SDK silently honours ANTHROPIC_BASE_URL. On a document
  // platform that means institutional document text could be routed to a third
  // party without anyone choosing it in code, so say so once per process. The
  // override is respected — it is deliberate for gateways and proxies — but it
  // is never invisible.
  warnOnNonDefaultBaseUrl();

  const taxonomy = input.categories
    .map((c) => `- ${c.department_slug}/${c.slug} — ${c.name}${c.description ? `: ${c.description}` : ''}`)
    .join('\n');

  const system = [
    'You analyse institutional documents and return structured metadata.',
    '',
    'Rules:',
    '- Use ONLY information present in the document text. Never invent facts.',
    '- Choose department_slug and category_slug from the allowed list below, or null if the text does not clearly fit one.',
    '- confidence is your own 0..1 estimate that the chosen category is correct. Use a low value when the evidence is weak.',
    '- Dates must be ISO (YYYY-MM-DD). Omit dates you cannot resolve; do not guess a year.',
    '- is_deadline is true only for dates the document presents as a due date, closing date or last date.',
    '- summary: 2-4 sentences, factual, no preamble.',
    '- If the document is unreadable or contains no meaningful content, return nulls and empty arrays.',
    '',
    'Allowed department/category pairs:',
    taxonomy || '(none configured)',
  ].join('\n');

  const userMessage = [
    `Filename: ${input.filename}`,
    `Provided title: ${input.title}`,
    '',
    'Document text:',
    '"""',
    text.slice(0, MAX_PROMPT_CHARS),
    '"""',
  ].join('\n');

  const schema = buildAnalysisSchema(
    input.departments.map((d) => d.slug),
    input.categories.map((c) => c.slug),
  );

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // No temperature: sampling parameters are rejected on Claude Opus 5.
      thinking: { type: 'adaptive' },
      output_config: { effort: ANALYSIS_EFFORT, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    // A safety refusal is a real outcome, not a malformed one. Reporting it
    // distinctly keeps the pipeline honest: it degrades to the deterministic
    // keyword classifier instead of presenting nothing as analysis.
    if (response.stop_reason === 'refusal') {
      return {
        ok: false,
        analysis: null,
        model,
        reason: 'REFUSED',
        detail: response.stop_details?.explanation ?? response.stop_details?.category ?? undefined,
      };
    }

    // Truncation produces JSON that is valid-looking but cut off mid-object.
    // Naming it beats letting JSON.parse report a syntax error at some offset.
    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        analysis: null,
        model,
        reason: 'MALFORMED_OUTPUT',
        detail: `output truncated at max_tokens (${MAX_OUTPUT_TOKENS})`,
      };
    }

    const raw = response.content.find((b) => b.type === 'text')?.text;
    if (!raw) {
      return { ok: false, analysis: null, model, reason: 'MALFORMED_OUTPUT', detail: 'empty response' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
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
 * The JSON Schema the response is constrained to.
 *
 * Exported so tests can assert it stays inside the structured-outputs subset —
 * a violation is a 400 at runtime, i.e. exactly the failure a test should catch
 * instead of the first real upload.
 *
 * Subset rules this must respect:
 *  * every object needs `additionalProperties: false`
 *  * there is no `nullable` keyword — nullability is an `enum` containing null
 *    or an `anyOf` with `{ type: 'null' }`
 *  * numeric and string length constraints are unsupported, so bounds live in
 *    `coerce()` instead
 *
 * Every key is `required`, with null as the explicit "unknown" value. Making
 * fields optional instead would let the model omit a key silently, which is
 * indistinguishable from "the document had nothing to say".
 */
export function buildAnalysisSchema(
  departmentSlugs: string[],
  categorySlugs: string[],
): Record<string, unknown> {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  const nullableDate = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] };

  // An empty enum is not a valid schema, so an unseeded taxonomy falls back to
  // a free string. pipeline.ts resolves the slug against the database either
  // way, so nothing can be filed into a category that does not exist.
  const slugEnum = (slugs: string[]) => {
    const unique = [...new Set(slugs.filter((s) => typeof s === 'string' && s.length > 0))];
    return unique.length > 0 ? { enum: [...unique, null] } : nullableString;
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'document_type',
      'department_slug',
      'category_slug',
      'tags',
      'summary',
      'key_points',
      'entities',
      'important_dates',
      'document_date',
      'confidence',
    ],
    properties: {
      document_type: nullableString,
      department_slug: slugEnum(departmentSlugs),
      category_slug: slugEnum(categorySlugs),
      tags: { type: 'array', items: { type: 'string' } },
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

/** Keeps a provider error actionable in the server log without leaking the key. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    return status ? `${error.name} ${status}: ${error.message}` : `${error.name}: ${error.message}`;
  }
  return String(error);
}

let baseUrlWarned = false;

function warnOnNonDefaultBaseUrl(): void {
  const base = process.env.ANTHROPIC_BASE_URL;
  if (!base || baseUrlWarned) return;
  baseUrlWarned = true;
  console.warn(
    `[analyze] ANTHROPIC_BASE_URL is set to ${base}. Document text will be sent ` +
      'there instead of to api.anthropic.com. Unset it to call Anthropic directly.',
  );
}

/**
 * Defensive normalisation. A schema-constrained response is still untrusted
 * input, so every field is clamped and every array bounded.
 */
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

  // Number.isFinite, not typeof: NaN and Infinity are numbers, and clamping
  // them leaves them intact, so a non-finite confidence would reach the
  // numeric confidence column.
  const confidenceRaw = Number.isFinite(o.confidence) ? (o.confidence as number) : 0;

  return {
    document_type: str(o.document_type),
    department_slug: str(o.department_slug),
    category_slug: str(o.category_slug),
    tags: strArray(o.tags, 12),
    summary: str(o.summary),
    key_points: strArray(o.key_points, 12),
    entities,
    important_dates: importantDates,
    document_date: isoDate(o.document_date),
    confidence: Math.max(0, Math.min(1, confidenceRaw)),
  };
}

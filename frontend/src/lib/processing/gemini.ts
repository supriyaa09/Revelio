import type { Category, Department } from '@/lib/types';

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
  reason?: 'NO_API_KEY' | 'NO_TEXT' | 'API_ERROR' | 'MALFORMED_OUTPUT';
  detail?: string;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

/** Characters of document text sent to the model. */
const MAX_PROMPT_CHARS = 24_000;

/**
 * Structured analysis of extracted document text.
 *
 * Design rules:
 *  * Returns JSON only, enforced by responseMimeType + responseSchema, so we
 *    never regex a summary out of prose.
 *  * The model chooses from the *actual* seeded taxonomy by slug. It cannot
 *    invent a department or category, which is what stops a hallucinated folder.
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, analysis: null, model: null, reason: 'NO_API_KEY' };
  }

  const text = input.text.trim();
  if (text.length < 40) {
    return { ok: false, analysis: null, model: null, reason: 'NO_TEXT' };
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  const taxonomy = input.categories
    .map((c) => `- ${c.department_slug}/${c.slug} — ${c.name}${c.description ? `: ${c.description}` : ''}`)
    .join('\n');

  const prompt = [
    'You analyse institutional documents. Return JSON only.',
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
    '',
    `Filename: ${input.filename}`,
    `Provided title: ${input.title}`,
    '',
    'Document text:',
    '"""',
    text.slice(0, MAX_PROMPT_CHARS),
    '"""',
  ].join('\n');

  const responseSchema = {
    type: 'object',
    properties: {
      document_type: { type: 'string', nullable: true },
      department_slug: { type: 'string', nullable: true },
      category_slug: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string', nullable: true },
      key_points: { type: 'array', items: { type: 'string' } },
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, type: { type: 'string' } },
          required: ['name', 'type'],
        },
      },
      important_dates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            date: { type: 'string' },
            is_deadline: { type: 'boolean' },
          },
          required: ['label', 'date', 'is_deadline'],
        },
      },
      document_date: { type: 'string', nullable: true },
      confidence: { type: 'number' },
    },
    required: ['tags', 'key_points', 'entities', 'important_dates', 'confidence'],
  };

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema as never,
        temperature: 0.1,
      },
    });

    const raw = response.text;
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
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Defensive normalisation. A schema-constrained response is still untrusted
 * input, so every field is clamped and every array bounded.
 */
function coerce(value: unknown): AiAnalysis {
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

  const confidenceRaw = typeof o.confidence === 'number' ? o.confidence : 0;

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

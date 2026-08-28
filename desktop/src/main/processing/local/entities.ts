/**
 * Regex-based entity and date extraction for the local analysis engine.
 *
 * A deliberately modest NER: emails, URLs, phone numbers, money amounts and
 * capitalized proper-noun runs — the entity classes that matter for finding
 * documents later — plus multi-format date extraction with deadline detection
 * from nearby cue words. No statistical model, no downloads.
 */

import { DEADLINE_CUES, DOC_DATE_LABELS, MONTHS } from './rules.ts';

export interface ExtractedEntity {
  name: string;
  type: string;
}

export interface ExtractedDate {
  label: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  is_deadline: boolean;
}

export interface EntityExtraction {
  entities: ExtractedEntity[];
  importantDates: ExtractedDate[];
  /** The document's own date, when one can be identified. */
  documentDate: string | null;
}

const MAX_ENTITIES_PER_TYPE = 10;

/**
 * Extracts entities and dates from document text.
 * `textStartOffset` is unused by callers today but kept as a seam in case
 * chunk-level extraction wants offsets later.
 */
export function extractEntities(text: string): EntityExtraction {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const push = (name: string, type: string) => {
    const key = `${type}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ name, type });
  };

  // Emails.
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    if (entities.filter((e) => e.type === 'email').length >= MAX_ENTITIES_PER_TYPE) break;
    push(m[0], 'email');
  }

  // URLs (absolute and www.). Trailing sentence punctuation is stripped.
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi)) {
    if (entities.filter((e) => e.type === 'url').length >= MAX_ENTITIES_PER_TYPE) break;
    push(m[0].replace(/[.,;:!?]+$/, ''), 'url');
  }

  // Money amounts: symbol-prefixed or currency-suffixed.
  for (const m of text.matchAll(/[$€£₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR|dollars|euros|pounds|rupees)\b/gi)) {
    if (entities.filter((e) => e.type === 'money').length >= MAX_ENTITIES_PER_TYPE) break;
    push(m[0].replace(/\s+/g, ' ').trim(), 'money');
  }

  // Phone numbers: candidate digit clusters, then validated.
  for (const m of text.matchAll(/(?:\+?\d{1,3}[-.\s]?)?(?:\(\d{2,4}\)[-.\s]?)?\d{2,4}[-.\s]\d{3,4}(?:[-.\s]\d{2,4})?/g)) {
    if (entities.filter((e) => e.type === 'phone').length >= MAX_ENTITIES_PER_TYPE) break;
    const candidate = m[0].trim();
    const digits = candidate.replace(/\D/g, '');
    const hasSeparator = /[-.\s()]/.test(candidate);
    if (digits.length >= 8 && digits.length <= 14 && (hasSeparator || candidate.startsWith('+'))) {
      push(candidate.replace(/\s+/g, ' '), 'phone');
    }
  }

  // Proper-noun runs: 2–4 consecutive Capitalized words, not at a sentence
  // start, not months, not pure stopwords.
  const monthNames = new Set(Object.keys(MONTHS));
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
    if (entities.filter((e) => e.type === 'name').length >= MAX_ENTITIES_PER_TYPE) break;

    const run = m[0];
    const words = run.split(/\s+/);
    if (words.every((w) => monthNames.has(w.toLowerCase()))) continue;

    // Skip sentence-start runs: find the last non-space character before the
    // match; terminal punctuation means the capital is just grammar.
    let k = m.index! - 1;
    while (k >= 0 && /\s/.test(text[k]!)) k--;
    const prevChar = k >= 0 ? text[k]! : '';
    const afterTerminal =
      /[.!?]/.test(prevChar) ||
      (/["')\]]/.test(prevChar) && k > 0 && /[.!?]/.test(text[k - 1]!));

    if (prevChar === '') {
      // Document start: keep only 3+ word runs (likely a title, not prose).
      if (words.length < 3) continue;
    } else if (afterTerminal) {
      continue;
    }

    push(run, 'name');
  }

  const { importantDates, documentDate } = extractDates(text);

  return { entities, importantDates, documentDate };
}

interface DateCandidate {
  date: string;
  index: number;
  label: string;
  isDeadline: boolean;
  hasDocDateLabel: boolean;
}

/**
 * Finds dates in ISO, "12 May 2024", "May 12, 2024" and DD/MM/YYYY forms.
 * Ambiguous DD/MM vs MM/DD resolves as DD/MM unless that is impossible.
 * A date becomes a deadline when a cue word ("due", "no later than", …)
 * appears in the ~50 characters around it.
 */
export function extractDates(text: string): {
  importantDates: ExtractedDate[];
  documentDate: string | null;
} {
  const candidates: DateCandidate[] = [];

  const consider = (
    match: RegExpExecArray | RegExpMatchArray,
    year: number,
    month: number,
    day: number,
  ) => {
    if (!isValidDate(year, month, day)) return;
    if (year < 1900 || year > 2100) return;

    const index = (match as RegExpExecArray).index ?? 0;
    const windowBefore = text.slice(Math.max(0, index - 60), index).toLowerCase();
    const windowAfter = text
      .slice(index + match[0].length, Math.min(text.length, index + match[0].length + 30))
      .toLowerCase();
    const window = `${windowBefore} ${windowAfter}`;

    const cue = DEADLINE_CUES.find((c) => window.includes(c));
    const docLabel = DOC_DATE_LABELS.find((l) => windowBefore.includes(l));

    candidates.push({
      date: toIso(year, month, day),
      index,
      label: cue ? toLabel(cue) : docLabel ? toLabel(docLabel) : 'Date',
      isDeadline: cue !== undefined,
      hasDocDateLabel: docLabel !== undefined,
    });
  };

  // ISO: 2024-05-12
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    consider(m, Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // 12 May 2024 / 12th May, 2024
  const monthNames = Object.keys(MONTHS).join('|');
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?,?\\s+(\\d{4})\\b`, 'gi'))) {
    consider(m, Number(m[3]), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]));
  }

  // May 12, 2024 / May 12th 2024
  for (const m of text.matchAll(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) {
    consider(m, Number(m[3]), MONTHS[m[1]!.toLowerCase()]!, Number(m[2]));
  }

  // DD/MM/YYYY (or MM/DD when DD is impossible)
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    if (a > 12 && b <= 12) consider(m, year, b, a);
    else if (a <= 12 && b > 12) consider(m, year, a, b);
    else consider(m, year, b, a); // ambiguous → DD/MM
  }

  // Deduplicate identical date+label pairs, keeping the earliest occurrence.
  const unique = new Map<string, DateCandidate>();
  for (const c of candidates.sort((x, y) => x.index - y.index)) {
    const key = `${c.date}|${c.label}`;
    if (!unique.has(key)) unique.set(key, c);
  }

  const importantDates = [...unique.values()]
    .sort((x, y) => x.index - y.index)
    .slice(0, 15)
    .map((c) => ({ label: c.label, date: c.date, is_deadline: c.isDeadline }));

  // document_date: prefer a labelled "Date:/Issued:" candidate, else the
  // earliest date found in the first third of the document.
  const labelled = [...unique.values()].find((c) => c.hasDocDateLabel);
  let documentDate = labelled?.date ?? null;
  if (!documentDate) {
    const third = text.length / 3;
    const early = [...unique.values()].filter((c) => c.index <= third).sort((x, y) => x.index - y.index);
    documentDate = early[0]?.date ?? null;
  }

  return { importantDates, documentDate };
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "due date" → "Due Date", "no later than" → "No Later Than". */
function toLabel(cue: string): string {
  return cue
    .split(/\s+/)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

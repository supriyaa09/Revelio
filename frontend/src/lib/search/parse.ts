/**
 * Deterministic search-query parser.
 *
 * Extracts structured filters (status, uploader name, document type, tags,
 * date ranges) from a natural-language search string.  The remainder becomes
 * the free-text query for PostgreSQL full-text search.
 *
 * No network, no AI, no side effects.
 *
 * @module
 */

import type { WorkflowState } from '@/lib/types';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ParsedSearch {
  /** Free text for full-text search / ilike fallback. */
  text: string;
  /** Workflow status filter. */
  status: WorkflowState | null;
  /** Uploader name (partial match against profiles.full_name). */
  uploaderName: string | null;
  /** Document type (partial match against documents.document_type). */
  documentType: string | null;
  /** Tags to match (exact, lowercased, deduplicated). */
  tags: string[];
  /** Start date filter (ISO YYYY-MM-DD, inclusive). */
  dateFrom: string | null;
  /** End date filter (ISO YYYY-MM-DD, inclusive). */
  dateTo: string | null;
}

// ── Lookup tables ────────────────────────────────────────────────────────────

/** Maps lowercase status text → WorkflowState enum value. */
const STATUS_MAP = new Map<string, WorkflowState>([
  // Enum values (snake_case)
  ['draft', 'draft'],
  ['submitted', 'submitted'],
  ['faculty_review', 'faculty_review'],
  ['hod_review', 'hod_review'],
  ['approved', 'approved'],
  ['rejected', 'rejected'],
  ['changes_requested', 'changes_requested'],
  // Display labels (space-separated)
  ['faculty review', 'faculty_review'],
  ['hod review', 'hod_review'],
  ['changes requested', 'changes_requested'],
]);

/** Single-word status values for bare-word detection. */
const SINGLE_WORD_STATUSES = new Set<string>([
  'draft', 'submitted', 'approved', 'rejected',
]);

/** Multi-word status labels, longest first for greedy matching. */
const MULTI_WORD_LABELS: readonly [string, WorkflowState][] = [
  ['changes requested', 'changes_requested'],
  ['faculty review', 'faculty_review'],
  ['hod review', 'hod_review'],
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true if the string is a valid ISO YYYY-MM-DD calendar date.
 * Rejects syntactically correct but impossible dates like 2026-02-30.
 */
export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  // Reject dates that parse but aren't real calendar dates
  return d.toISOString().startsWith(s);
}

/** Collapse runs of whitespace to a single space and trim. */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parses a natural-language search query into structured filters.
 *
 * Processing order (each stage removes matched text from the input):
 * 1. Prefix filters: `status:`, `type:`, `tag:`, `#`, `after:`, `before:`,
 *    `since:`, `until:`
 * 2. Uploader: `uploaded by <name>` (anywhere), then `by <name>` (at end)
 * 3. Bare workflow-state keywords (multi-word labels first, then single words)
 * 4. Everything remaining → `text`
 */
export function parseSearchQuery(raw: string): ParsedSearch {
  const result: ParsedSearch = {
    text: '',
    status: null,
    uploaderName: null,
    documentType: null,
    tags: [],
    dateFrom: null,
    dateTo: null,
  };

  let input = raw.trim();
  if (!input) return result;

  // ── 1. Prefix-based filters (unambiguous, extracted first) ──────────────

  // status:<value>
  input = input.replace(/\bstatus:(\S+)/gi, (_, val: string) => {
    if (!result.status) {
      const mapped = STATUS_MAP.get(val.toLowerCase());
      if (mapped) result.status = mapped;
    }
    return '';
  });

  // type:"multi word value" or type:single_word
  input = input.replace(/\btype:"([^"]+)"/gi, (_, val: string) => {
    if (!result.documentType) result.documentType = val.trim();
    return '';
  });
  input = input.replace(/\btype:(\S+)/gi, (_, val: string) => {
    if (!result.documentType) result.documentType = val.trim();
    return '';
  });

  // tag:<value> or #<value>  (strip trailing punctuation from tag)
  input = input.replace(/(?:^|\s)(?:tag:|#)(\S+)/gi, (_, val: string) => {
    const tag = val.toLowerCase().replace(/[,;.]+$/, '');
    if (tag) result.tags.push(tag);
    return ' ';
  });

  // after:<date> / since:<date>
  input = input.replace(/\b(?:after|since):(\S+)/gi, (_, val: string) => {
    if (!result.dateFrom && isValidIsoDate(val)) result.dateFrom = val;
    return '';
  });

  // before:<date> / until:<date>
  input = input.replace(/\b(?:before|until):(\S+)/gi, (_, val: string) => {
    if (!result.dateTo && isValidIsoDate(val)) result.dateTo = val;
    return '';
  });

  input = normalise(input);

  // ── 2. Uploader name ───────────────────────────────────────────────────

  // "uploaded by <name>" at end of remaining text (most specific, checked first)
  const uploadedByMatch = input.match(/\buploaded\s+by\s+(.+?)\s*$/i);
  if (uploadedByMatch && uploadedByMatch[1]!.trim()) {
    result.uploaderName = uploadedByMatch[1]!.trim();
    input = input.slice(0, uploadedByMatch.index!).trim();
  }

  // "by <name>" at end (only if "uploaded by" didn't match)
  if (!result.uploaderName) {
    const byMatch = input.match(/\bby\s+(.+?)\s*$/i);
    if (byMatch && byMatch[1]!.trim()) {
      const name = byMatch[1]!.trim();
      // Don't treat a bare status keyword as an uploader name
      if (!STATUS_MAP.has(name.toLowerCase())) {
        result.uploaderName = name;
        input = input.slice(0, byMatch.index!).trim();
      }
    }
  }

  input = normalise(input);

  // ── 3. Bare workflow-state keywords ────────────────────────────────────

  // Multi-word labels first (greedy: "changes requested" before "changes")
  if (!result.status) {
    const lower = input.toLowerCase();
    for (const [label, state] of MULTI_WORD_LABELS) {
      const re = new RegExp(`\\b${label}\\b`, 'i');
      const m = lower.match(re);
      if (m !== null) {
        result.status = state;
        input = (input.slice(0, m.index!) + input.slice(m.index! + label.length)).trim();
        break;
      }
    }
  }

  // Single-word statuses
  if (!result.status) {
    const words = input.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!.toLowerCase();
      if (SINGLE_WORD_STATUSES.has(w)) {
        result.status = STATUS_MAP.get(w)!;
        words.splice(i, 1);
        input = words.join(' ');
        break;
      }
    }
  }

  // ── 4. Collapse and finalise ───────────────────────────────────────────

  result.text = normalise(input);
  result.tags = [...new Set(result.tags)];

  return result;
}

/**
 * Builds display-friendly labels for active parsed filters (for chip UI).
 */
export function describeFilters(
  parsed: ParsedSearch,
  workflowLabels: Record<string, string>,
): { label: string; key: string }[] {
  const chips: { label: string; key: string }[] = [];

  if (parsed.status) {
    chips.push({ label: workflowLabels[parsed.status] ?? parsed.status, key: 'status' });
  }
  if (parsed.uploaderName) {
    chips.push({ label: `By ${parsed.uploaderName}`, key: 'uploader' });
  }
  if (parsed.documentType) {
    chips.push({ label: `Type: ${parsed.documentType}`, key: 'type' });
  }
  for (const tag of parsed.tags) {
    chips.push({ label: `#${tag}`, key: `tag:${tag}` });
  }
  if (parsed.dateFrom) {
    chips.push({ label: `After ${parsed.dateFrom}`, key: 'dateFrom' });
  }
  if (parsed.dateTo) {
    chips.push({ label: `Before ${parsed.dateTo}`, key: 'dateTo' });
  }

  return chips;
}

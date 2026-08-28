/**
 * Deterministic search-query parser for the desktop app.
 *
 * Adapted from the web parser (`frontend/src/lib/search/parse.ts`): same
 * architecture — strip structured filters out of the string, leave the rest as
 * free text — with the institutional filters (status:, uploaded by) replaced
 * by file-oriented ones:
 *
 *   type:pdf / type:docx / type:image     file family or raw extension
 *   category:"Research Papers"            AI category
 *   in:Notes / in:"C:/Users/me/College"   path substring
 *   modified:today|this-week|this-month|this-year|last-30-days|2024|2024-06|2024-06-15
 *   after:2024-01-01 / since:...          mtime lower bound (inclusive)
 *   before:2024-12-31 / until:...         mtime upper bound (inclusive)
 *   #tag or tag:react                     keyword match
 *   "exact phrase"                        phrase extraction
 *
 * No network, no AI, no side effects — which is also what makes it testable.
 */

import type { FileKind, ParsedQuery, SearchFilters } from '@shared/types';

const KIND_MAP: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'docx',
  word: 'docx',
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  image: 'image',
  images: 'image',
  img: 'image',
  photo: 'image',
  photos: 'image',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  return d.toISOString().startsWith(s);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Resolves a `modified:` value to an inclusive [from, to] range, or null. */
export function resolveModified(value: string): { from: string; to: string } | null {
  const v = value.toLowerCase().trim();
  const today = new Date();

  switch (v) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case 'yesterday': {
      const y = iso(daysAgo(1));
      return { from: y, to: y };
    }
    case 'this-week':
    case 'week': {
      const d = new Date();
      const day = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - day);
      return { from: iso(d), to: iso(today) };
    }
    case 'this-month':
    case 'month':
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case 'this-year':
    case 'year':
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
  }

  let m = /^last-(\d+)-days?$/.exec(v);
  if (m) {
    const n = Math.max(1, parseInt(m[1]!, 10));
    return { from: iso(daysAgo(n - 1)), to: iso(today) };
  }

  m = /^(\d{4})$/.exec(v);
  if (m) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };

  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) {
    const year = parseInt(m[1]!, 10);
    const month = parseInt(m[2]!, 10);
    if (month < 1 || month > 12) return null;
    const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of month
    return { from: `${v}-01`, to: iso(last) };
  }

  if (isValidIsoDate(v)) return { from: v, to: v };

  return null;
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function emptyFilters(): SearchFilters {
  return {
    kind: null,
    extension: null,
    category: null,
    folderId: null,
    pathPrefix: null,
    dateFrom: null,
    dateTo: null,
    tags: [],
  };
}

/**
 * Parses a natural-language query into free text + structured filters.
 * Processing order (each stage removes matched text from the input):
 * 1. quoted phrases  2. prefix filters  3. #tags  4. remainder → text
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const filters = emptyFilters();
  let phrase: string | null = null;

  let input = raw.trim();
  if (!input) {
    return { raw, text: '', phrase: null, terms: [], filters };
  }

  // ── 1. Quoted phrases: the first one becomes the phrase filter ────────────
  // Quotes glued to a filter prefix (type:"…", category:"…", in:"…") are left
  // alone — stage 2 owns those. Empty quote pairs are stripped as noise.
  input = input.replace(/(?<!\b(?:type|category|in):)"([^"]*)"/gi, (whole, p: string) => {
    if (!phrase && p.trim()) phrase = p.trim();
    return ' ';
  });

  // ── 2. Prefix filters ──────────────────────────────────────────────────────

  // type:<value> — quoted or bare
  input = input.replace(/\btype:(?:"([^"]+)"|(\S+))/gi, (_, quoted: string | undefined, bare: string | undefined) => {
    if (!filters.kind && !filters.extension) {
      const val = (quoted ?? bare ?? '').toLowerCase().trim();
      const kind = KIND_MAP[val];
      if (kind) filters.kind = kind;
      else if (/^[a-z0-9]+$/.test(val)) filters.extension = val;
    }
    return ' ';
  });

  // category:<value> — quoted or bare
  input = input.replace(/\bcategory:(?:"([^"]+)"|(\S+))/gi, (_, quoted: string | undefined, bare: string | undefined) => {
    if (!filters.category) {
      const val = (quoted ?? bare ?? '').trim();
      if (val) filters.category = val;
    }
    return ' ';
  });

  // in:<path or name> — quoted or bare
  input = input.replace(/\bin:(?:"([^"]+)"|(\S+))/gi, (_, quoted: string | undefined, bare: string | undefined) => {
    if (!filters.pathPrefix) {
      const val = (quoted ?? bare ?? '').trim().replace(/\\/g, '/');
      if (val) filters.pathPrefix = val;
    }
    return ' ';
  });

  // modified:<value>
  input = input.replace(/\bmodified:(\S+)/gi, (_, val: string) => {
    if (!filters.dateFrom && !filters.dateTo) {
      const range = resolveModified(val);
      if (range) {
        filters.dateFrom = range.from;
        filters.dateTo = range.to;
      }
    }
    return ' ';
  });

  // after:/since: and before:/until:
  input = input.replace(/\b(?:after|since):(\S+)/gi, (_, val: string) => {
    if (!filters.dateFrom && isValidIsoDate(val)) filters.dateFrom = val;
    return ' ';
  });
  input = input.replace(/\b(?:before|until):(\S+)/gi, (_, val: string) => {
    if (!filters.dateTo && isValidIsoDate(val)) filters.dateTo = val;
    return ' ';
  });

  // ── 3. Tags: #tag or tag:x ─────────────────────────────────────────────────
  input = input.replace(/(?:^|\s)(?:tag:|#)(\S+)/gi, (_, val: string) => {
    const tag = val.toLowerCase().replace(/[,;.]+$/, '');
    if (tag) filters.tags.push(tag);
    return ' ';
  });

  // ── 4. Finalise ────────────────────────────────────────────────────────────
  const text = normalise(input);
  filters.tags = [...new Set(filters.tags)];

  return {
    raw,
    text,
    phrase,
    terms: splitTerms(text),
    filters,
  };
}

/** Splits free text into searchable terms, dropping pure punctuation. */
export function splitTerms(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && /[\p{L}\p{N}]/u.test(t));
}

/** Display labels for active filters (chip UI). */
export function describeFilters(parsed: ParsedQuery): { label: string; key: string }[] {
  const chips: { label: string; key: string }[] = [];
  const f = parsed.filters;

  if (f.kind) chips.push({ label: `Type: ${f.kind}`, key: 'kind' });
  if (f.extension) chips.push({ label: `Type: .${f.extension}`, key: 'extension' });
  if (f.category) chips.push({ label: `Category: ${f.category}`, key: 'category' });
  if (f.pathPrefix) chips.push({ label: `In: ${f.pathPrefix}`, key: 'in' });
  if (f.dateFrom && f.dateTo) chips.push({ label: `${f.dateFrom} → ${f.dateTo}`, key: 'range' });
  else if (f.dateFrom) chips.push({ label: `After ${f.dateFrom}`, key: 'dateFrom' });
  else if (f.dateTo) chips.push({ label: `Before ${f.dateTo}`, key: 'dateTo' });
  for (const tag of f.tags) chips.push({ label: `#${tag}`, key: `tag:${tag}` });
  if (parsed.phrase) chips.push({ label: `"${parsed.phrase}"`, key: 'phrase' });

  return chips;
}

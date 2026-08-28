/**
 * Tests for the desktop search parser and FTS5 match builder.
 *
 * No network, no AI, no database writes — parse.ts is pure and buildFtsMatch
 * only shapes a MATCH string. Importing query.ts does load the db module, but
 * getDb() is lazy, so no database file is created.
 *
 *   npm run test:search
 */
import assert from 'node:assert/strict';
import {
  parseSearchQuery,
  isValidIsoDate,
  resolveModified,
  splitTerms,
  describeFilters,
} from '../src/main/search/parse.ts';
import { buildFtsMatch } from '../src/main/search/query.ts';

// ── Test harness (same pattern as frontend/scripts/test-search.mts) ──────────

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e: any) {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── 1. Basic parsing ─────────────────────────────────────────────────────────

console.log('\n=== 1. Basic parsing ===');

await test('empty string returns empty result', () => {
  const r = parseSearchQuery('');
  assert.equal(r.text, '');
  assert.equal(r.phrase, null);
  assert.deepEqual(r.terms, []);
  assert.equal(r.filters.kind, null);
  assert.equal(r.filters.category, null);
  assert.deepEqual(r.filters.tags, []);
});

await test('whitespace-only returns empty result', () => {
  const r = parseSearchQuery('   \t  \n  ');
  assert.equal(r.text, '');
  assert.deepEqual(r.terms, []);
});

await test('plain text passes through unchanged', () => {
  const r = parseSearchQuery('machine learning notes');
  assert.equal(r.text, 'machine learning notes');
  assert.deepEqual(r.terms, ['machine', 'learning', 'notes']);
  assert.equal(r.phrase, null);
});

await test('extra whitespace is normalised', () => {
  const r = parseSearchQuery('  hello   world  ');
  assert.equal(r.text, 'hello world');
});

await test('raw is preserved verbatim', () => {
  const raw = '  type:pdf  notes ';
  assert.equal(parseSearchQuery(raw).raw, raw);
});

// ── 2. type: filter ──────────────────────────────────────────────────────────

console.log('\n=== 2. type: filter ===');

await test('type:pdf maps to kind pdf', () => {
  const r = parseSearchQuery('type:pdf');
  assert.equal(r.filters.kind, 'pdf');
  assert.equal(r.filters.extension, null);
  assert.equal(r.text, '');
});

await test('type:word and type:doc map to docx', () => {
  assert.equal(parseSearchQuery('type:word').filters.kind, 'docx');
  assert.equal(parseSearchQuery('type:doc').filters.kind, 'docx');
});

await test('type:photos maps to image kind', () => {
  assert.equal(parseSearchQuery('type:photos').filters.kind, 'image');
});

await test('unknown alphanumeric type becomes raw extension', () => {
  const r = parseSearchQuery('type:xlsx');
  assert.equal(r.filters.kind, null);
  assert.equal(r.filters.extension, 'xlsx');
});

await test('type: is case insensitive', () => {
  assert.equal(parseSearchQuery('TYPE:PDF').filters.kind, 'pdf');
});

await test('quoted type value works', () => {
  assert.equal(parseSearchQuery('type:"md"').filters.kind, 'md');
});

await test('only the first type: wins', () => {
  const r = parseSearchQuery('type:pdf type:docx');
  assert.equal(r.filters.kind, 'pdf');
});

await test('type: with surrounding text keeps the text', () => {
  const r = parseSearchQuery('notes type:pdf from college');
  assert.equal(r.filters.kind, 'pdf');
  assert.equal(r.text, 'notes from college');
});

// ── 3. category: filter ──────────────────────────────────────────────────────

console.log('\n=== 3. category: filter ===');

await test('bare category value', () => {
  const r = parseSearchQuery('category:Finance');
  assert.equal(r.filters.category, 'Finance');
  assert.equal(r.text, '');
});

await test('quoted category preserves spaces and case', () => {
  const r = parseSearchQuery('category:"Research Papers"');
  assert.equal(r.filters.category, 'Research Papers');
});

await test('category prefix is case insensitive', () => {
  assert.equal(parseSearchQuery('CATEGORY:Finance').filters.category, 'Finance');
});

// ── 4. in: filter ────────────────────────────────────────────────────────────

console.log('\n=== 4. in: filter ===');

await test('bare in: value', () => {
  const r = parseSearchQuery('in:Notes');
  assert.equal(r.filters.pathPrefix, 'Notes');
});

await test('quoted in: path preserved', () => {
  const r = parseSearchQuery('in:"C:/Users/me/College"');
  assert.equal(r.filters.pathPrefix, 'C:/Users/me/College');
});

await test('backslashes normalised to forward slashes', () => {
  const r = parseSearchQuery('in:"C:\\Users\\me\\Notes"');
  assert.equal(r.filters.pathPrefix, 'C:/Users/me/Notes');
});

// ── 5. modified: filter ──────────────────────────────────────────────────────

console.log('\n=== 5. modified: filter ===');

await test('modified:today is a single-day range', () => {
  const r = parseSearchQuery('modified:today');
  const today = iso(new Date());
  assert.equal(r.filters.dateFrom, today);
  assert.equal(r.filters.dateTo, today);
});

await test('modified:2024 spans the whole year', () => {
  const r = parseSearchQuery('invoice modified:2024');
  assert.equal(r.filters.dateFrom, '2024-01-01');
  assert.equal(r.filters.dateTo, '2024-12-31');
  assert.equal(r.text, 'invoice');
});

await test('modified:2024-06 spans June', () => {
  const r = parseSearchQuery('modified:2024-06');
  assert.equal(r.filters.dateFrom, '2024-06-01');
  assert.equal(r.filters.dateTo, '2024-06-30');
});

await test('modified: handles February leap years', () => {
  assert.equal(parseSearchQuery('modified:2024-02').filters.dateTo, '2024-02-29');
  assert.equal(parseSearchQuery('modified:2023-02').filters.dateTo, '2023-02-28');
});

await test('modified: rejects month 13', () => {
  const r = parseSearchQuery('modified:2024-13');
  assert.equal(r.filters.dateFrom, null);
  assert.equal(r.filters.dateTo, null);
});

await test('modified: exact ISO date becomes single-day range', () => {
  const r = parseSearchQuery('modified:2024-06-15');
  assert.equal(r.filters.dateFrom, '2024-06-15');
  assert.equal(r.filters.dateTo, '2024-06-15');
});

await test('modified:last-30-days covers 30 days ending today', () => {
  const r = parseSearchQuery('modified:last-30-days');
  const d = new Date();
  d.setDate(d.getDate() - 29);
  assert.equal(r.filters.dateFrom, iso(d));
  assert.equal(r.filters.dateTo, iso(new Date()));
});

await test('modified:this-month starts on the 1st', () => {
  const r = parseSearchQuery('modified:this-month');
  const now = new Date();
  assert.equal(r.filters.dateFrom, iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  assert.equal(r.filters.dateTo, iso(now));
});

await test('modified:this-week starts on Monday', () => {
  const r = parseSearchQuery('modified:this-week');
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  assert.equal(r.filters.dateFrom, iso(d));
});

await test('unresolvable modified: value sets no filter', () => {
  const r = parseSearchQuery('modified:someday notes');
  assert.equal(r.filters.dateFrom, null);
  assert.equal(r.filters.dateTo, null);
  assert.equal(r.text, 'notes');
});

// ── 6. after/since and before/until ──────────────────────────────────────────

console.log('\n=== 6. after/since and before/until ===');

await test('after: sets lower bound only', () => {
  const r = parseSearchQuery('after:2024-01-01');
  assert.equal(r.filters.dateFrom, '2024-01-01');
  assert.equal(r.filters.dateTo, null);
});

await test('before: sets upper bound only', () => {
  const r = parseSearchQuery('before:2024-12-31');
  assert.equal(r.filters.dateTo, '2024-12-31');
  assert.equal(r.filters.dateFrom, null);
});

await test('since: and until: are aliases', () => {
  const r = parseSearchQuery('since:2024-01-01 until:2024-06-30');
  assert.equal(r.filters.dateFrom, '2024-01-01');
  assert.equal(r.filters.dateTo, '2024-06-30');
});

await test('invalid dates are ignored', () => {
  const r = parseSearchQuery('after:banana before:2024-99-99');
  assert.equal(r.filters.dateFrom, null);
  assert.equal(r.filters.dateTo, null);
});

// ── 7. Tags ──────────────────────────────────────────────────────────────────

console.log('\n=== 7. Tags ===');

await test('#tag extracts a tag', () => {
  const r = parseSearchQuery('#react hooks');
  assert.deepEqual(r.filters.tags, ['react']);
  assert.equal(r.text, 'hooks');
});

await test('tag: prefix works too', () => {
  assert.deepEqual(parseSearchQuery('tag:react').filters.tags, ['react']);
});

await test('tags are lowercased and trailing punctuation stripped', () => {
  const r = parseSearchQuery('#React,');
  assert.deepEqual(r.filters.tags, ['react']);
});

await test('duplicate tags are deduplicated', () => {
  const r = parseSearchQuery('#react #React tag:react');
  assert.deepEqual(r.filters.tags, ['react']);
});

await test('multiple distinct tags all collected', () => {
  const r = parseSearchQuery('#react #typescript notes');
  assert.deepEqual(r.filters.tags, ['react', 'typescript']);
  assert.equal(r.text, 'notes');
});

// ── 8. Quoted phrases ────────────────────────────────────────────────────────

console.log('\n=== 8. Quoted phrases ===');

await test('quoted phrase extracted from text', () => {
  const r = parseSearchQuery('resume "exact phrase" here');
  assert.equal(r.phrase, 'exact phrase');
  assert.equal(r.text, 'resume here');
});

await test('only the first phrase is used', () => {
  const r = parseSearchQuery('"first phrase" and "second phrase"');
  assert.equal(r.phrase, 'first phrase');
});

await test('empty quotes produce no phrase', () => {
  const r = parseSearchQuery('"" nothing');
  assert.equal(r.phrase, null);
  assert.equal(r.text, 'nothing');
});

// ── 9. Combined queries (the pitch queries) ──────────────────────────────────

console.log('\n=== 9. Combined queries ===');

await test('type + modified + text + phrase all together', () => {
  const r = parseSearchQuery('type:pdf modified:2024 invoice "amazon order"');
  assert.equal(r.filters.kind, 'pdf');
  assert.equal(r.filters.dateFrom, '2024-01-01');
  assert.equal(r.filters.dateTo, '2024-12-31');
  assert.equal(r.phrase, 'amazon order');
  assert.equal(r.text, 'invoice');
});

await test('natural query leaves everything as text', () => {
  const r = parseSearchQuery('machine learning notes from last semester');
  assert.equal(r.text, 'machine learning notes from last semester');
  assert.equal(r.filters.kind, null);
  assert.equal(r.filters.dateFrom, null);
});

await test('category + type combo', () => {
  const r = parseSearchQuery('category:"Research Papers" type:md transformers');
  assert.equal(r.filters.category, 'Research Papers');
  assert.equal(r.filters.kind, 'md');
  assert.equal(r.text, 'transformers');
});

// ── 10. isValidIsoDate ───────────────────────────────────────────────────────

console.log('\n=== 10. isValidIsoDate ===');

await test('accepts a valid date', () => {
  assert.equal(isValidIsoDate('2024-06-15'), true);
});

await test('rejects bad month and bad day', () => {
  assert.equal(isValidIsoDate('2024-13-01'), false);
  assert.equal(isValidIsoDate('2024-02-30'), false);
});

await test('knows leap years', () => {
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('2023-02-29'), false);
});

await test('rejects garbage and wrong shapes', () => {
  assert.equal(isValidIsoDate('banana'), false);
  assert.equal(isValidIsoDate('2024/06/15'), false);
  assert.equal(isValidIsoDate('2024-6-15'), false);
});

// ── 11. resolveModified (direct) ─────────────────────────────────────────────

console.log('\n=== 11. resolveModified ===');

await test('yesterday is a single-day range', () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const r = resolveModified('yesterday');
  assert.deepEqual(r, { from: iso(d), to: iso(d) });
});

await test('this-year spans Jan 1 to today', () => {
  const now = new Date();
  const r = resolveModified('this-year');
  assert.equal(r?.from, iso(new Date(now.getFullYear(), 0, 1)));
  assert.equal(r?.to, iso(now));
});

await test('last-1-day is today', () => {
  const r = resolveModified('last-1-day');
  assert.deepEqual(r, { from: iso(new Date()), to: iso(new Date()) });
});

await test('unknown value returns null', () => {
  assert.equal(resolveModified('someday'), null);
  assert.equal(resolveModified(''), null);
});

// ── 12. splitTerms ───────────────────────────────────────────────────────────

console.log('\n=== 12. splitTerms ===');

await test('drops pure-punctuation tokens', () => {
  assert.deepEqual(splitTerms('hello - world !!!'), ['hello', 'world']);
});

await test('keeps tokens containing letters or digits', () => {
  assert.deepEqual(splitTerms('c++ file-2 name'), ['c++', 'file-2', 'name']);
});

await test('empty text gives no terms', () => {
  assert.deepEqual(splitTerms(''), []);
});

// ── 13. describeFilters (chip labels) ────────────────────────────────────────

console.log('\n=== 13. describeFilters ===');

await test('chips for kind, category, range, tag, phrase', () => {
  const parsed = parseSearchQuery('type:pdf category:Finance modified:2024 #tax "quarterly report"');
  const chips = describeFilters(parsed);
  assert.ok(chips.some((c) => c.key === 'kind'));
  assert.ok(chips.some((c) => c.key === 'category'));
  assert.ok(chips.some((c) => c.key === 'range'));
  assert.ok(chips.some((c) => c.key === 'tag:tax'));
  assert.ok(chips.some((c) => c.key === 'phrase'));
});

await test('open-ended date renders After/Before chip', () => {
  const parsed = parseSearchQuery('after:2024-01-01');
  const chips = describeFilters(parsed);
  assert.equal(chips.length, 1);
  assert.equal(chips[0]!.key, 'dateFrom');
  assert.ok(chips[0]!.label.includes('2024-01-01'));
});

await test('no filters means no chips', () => {
  assert.deepEqual(describeFilters(parseSearchQuery('budget proposals')), []);
});

// ── 14. buildFtsMatch (FTS5 query builder) ───────────────────────────────────

console.log('\n=== 14. buildFtsMatch ===');

await test('single term becomes a quoted prefix query', () => {
  const m = buildFtsMatch(parseSearchQuery('invoice'));
  assert.equal(m, '"invoice"*');
});

await test('terms are OR-joined for recall', () => {
  const m = buildFtsMatch(parseSearchQuery('machine learning notes'));
  assert.equal(m, '"machine"* OR "learning"* OR "notes"*');
});

await test('phrase is appended without prefix wildcard', () => {
  const m = buildFtsMatch(parseSearchQuery('resume "next.js experience"'));
  assert.equal(m, '"resume"* OR "next.js experience"');
});

await test('phrase-only query builds just the phrase', () => {
  const m = buildFtsMatch(parseSearchQuery('"exact phrase"'));
  assert.equal(m, '"exact phrase"');
});

await test('double quotes inside terms are escaped', () => {
  const parsed = parseSearchQuery('say "hello"');
  // phrase extraction removes "hello"; craft the edge via a bare weird term:
  const m = buildFtsMatch({ ...parsed, terms: ['a"b'], phrase: null });
  assert.equal(m, '"a""b"*');
});

await test('no terms and no phrase returns null', () => {
  assert.equal(buildFtsMatch(parseSearchQuery('type:pdf')), null);
  assert.equal(buildFtsMatch(parseSearchQuery('')), null);
});

await test('filters alone produce no MATCH (filter browsing path)', () => {
  const parsed = parseSearchQuery('category:Finance modified:2024');
  assert.equal(buildFtsMatch(parsed), null);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(56)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);

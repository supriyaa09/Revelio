/**
 * Tests for the search query parser.
 *
 * No network, no Supabase, no side effects — these verify the deterministic
 * parser in isolation.
 *
 *   npm run test:search
 */
import assert from 'node:assert/strict';
import { parseSearchQuery, isValidIsoDate, describeFilters } from '../src/lib/search/parse.ts';

// ── Test harness (same pattern as test-processing.mts) ───────────────────────

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

// ── 1. Basic parsing ─────────────────────────────────────────────────────────

console.log('\n=== 1. Basic parsing ===');

await test('empty string returns all-null result', () => {
  const r = parseSearchQuery('');
  assert.equal(r.text, '');
  assert.equal(r.status, null);
  assert.equal(r.uploaderName, null);
  assert.equal(r.documentType, null);
  assert.deepEqual(r.tags, []);
  assert.equal(r.dateFrom, null);
  assert.equal(r.dateTo, null);
});

await test('whitespace-only returns all-null result', () => {
  const r = parseSearchQuery('   \t  \n  ');
  assert.equal(r.text, '');
  assert.equal(r.status, null);
});

await test('plain text passes through unchanged', () => {
  const r = parseSearchQuery('budget proposals');
  assert.equal(r.text, 'budget proposals');
  assert.equal(r.status, null);
  assert.equal(r.uploaderName, null);
});

await test('extra whitespace is normalised', () => {
  const r = parseSearchQuery('  hello   world  ');
  assert.equal(r.text, 'hello world');
});

// ── 2. Status detection ──────────────────────────────────────────────────────

console.log('\n=== 2. Status detection ===');

await test('status: prefix extracts approved', () => {
  const r = parseSearchQuery('status:approved');
  assert.equal(r.status, 'approved');
  assert.equal(r.text, '');
});

await test('status: prefix is case insensitive', () => {
  const r = parseSearchQuery('STATUS:REJECTED');
  assert.equal(r.status, 'rejected');
});

await test('status: with snake_case value', () => {
  const r = parseSearchQuery('documents status:faculty_review');
  assert.equal(r.status, 'faculty_review');
  assert.equal(r.text, 'documents');
});

await test('status: with unknown value is ignored', () => {
  const r = parseSearchQuery('status:unknown documents');
  assert.equal(r.status, null);
  assert.equal(r.text, 'documents');
});

await test('bare "approved" word extracts status', () => {
  const r = parseSearchQuery('approved documents');
  assert.equal(r.status, 'approved');
  assert.equal(r.text, 'documents');
});

await test('bare "rejected" word extracts status', () => {
  const r = parseSearchQuery('rejected');
  assert.equal(r.status, 'rejected');
  assert.equal(r.text, '');
});

await test('bare "draft" word extracts status', () => {
  const r = parseSearchQuery('draft budget');
  assert.equal(r.status, 'draft');
  assert.equal(r.text, 'budget');
});

await test('bare "submitted" word extracts status', () => {
  const r = parseSearchQuery('submitted proposals');
  assert.equal(r.status, 'submitted');
  assert.equal(r.text, 'proposals');
});

await test('multi-word "faculty review" extracts status', () => {
  const r = parseSearchQuery('faculty review documents');
  assert.equal(r.status, 'faculty_review');
  assert.equal(r.text, 'documents');
});

await test('multi-word "hod review" extracts status', () => {
  const r = parseSearchQuery('hod review');
  assert.equal(r.status, 'hod_review');
  assert.equal(r.text, '');
});

await test('multi-word "changes requested" extracts status', () => {
  const r = parseSearchQuery('changes requested documents');
  assert.equal(r.status, 'changes_requested');
  assert.equal(r.text, 'documents');
});

await test('non-status words are not extracted', () => {
  const r = parseSearchQuery('budget proposals');
  assert.equal(r.status, null);
  assert.equal(r.text, 'budget proposals');
});

await test('"drafting" does not match as "draft"', () => {
  const r = parseSearchQuery('drafting a proposal');
  assert.equal(r.status, null);
  assert.equal(r.text, 'drafting a proposal');
});

// ── 3. Uploader detection ────────────────────────────────────────────────────

console.log('\n=== 3. Uploader detection ===');

await test('"by Name" at end extracts uploader', () => {
  const r = parseSearchQuery('documents by Sohail');
  assert.equal(r.uploaderName, 'Sohail');
  assert.equal(r.text, 'documents');
});

await test('"uploaded by Name" extracts uploader', () => {
  const r = parseSearchQuery('documents uploaded by Sohail');
  assert.equal(r.uploaderName, 'Sohail');
  assert.equal(r.text, 'documents');
});

await test('multi-word name captured', () => {
  const r = parseSearchQuery('by Sohail Ahmed');
  assert.equal(r.uploaderName, 'Sohail Ahmed');
  assert.equal(r.text, '');
});

await test('uploaded by multi-word name', () => {
  const r = parseSearchQuery('uploaded by Sohail Ahmed');
  assert.equal(r.uploaderName, 'Sohail Ahmed');
  assert.equal(r.text, '');
});

await test('"by" inside a word does not match', () => {
  // "standby" contains "by" but \b prevents matching
  const r = parseSearchQuery('standby documents');
  assert.equal(r.uploaderName, null);
  assert.equal(r.text, 'standby documents');
});

await test('"by" followed by status word is not extracted as uploader', () => {
  const r = parseSearchQuery('by approved');
  // "approved" is a status word, so "by approved" is not treated as uploader
  assert.equal(r.uploaderName, null);
  assert.equal(r.status, 'approved');
});

await test('approved documents by Sohail → status + uploader + text', () => {
  const r = parseSearchQuery('approved documents by Sohail');
  assert.equal(r.uploaderName, 'Sohail');
  assert.equal(r.status, 'approved');
  assert.equal(r.text, 'documents');
});

// ── 4. Date ranges ───────────────────────────────────────────────────────────

console.log('\n=== 4. Date ranges ===');

await test('after: extracts dateFrom', () => {
  const r = parseSearchQuery('after:2026-01-15');
  assert.equal(r.dateFrom, '2026-01-15');
  assert.equal(r.text, '');
});

await test('before: extracts dateTo', () => {
  const r = parseSearchQuery('before:2026-06-30');
  assert.equal(r.dateTo, '2026-06-30');
  assert.equal(r.text, '');
});

await test('since: extracts dateFrom', () => {
  const r = parseSearchQuery('since:2026-03-01');
  assert.equal(r.dateFrom, '2026-03-01');
});

await test('until: extracts dateTo', () => {
  const r = parseSearchQuery('until:2026-12-31');
  assert.equal(r.dateTo, '2026-12-31');
});

await test('both after and before in one query', () => {
  const r = parseSearchQuery('after:2026-01-01 before:2026-06-30 documents');
  assert.equal(r.dateFrom, '2026-01-01');
  assert.equal(r.dateTo, '2026-06-30');
  assert.equal(r.text, 'documents');
});

await test('invalid date is ignored', () => {
  const r = parseSearchQuery('after:not-a-date documents');
  assert.equal(r.dateFrom, null);
  assert.equal(r.text, 'documents');
});

await test('impossible calendar date is ignored', () => {
  const r = parseSearchQuery('after:2026-02-30');
  assert.equal(r.dateFrom, null);
});

// ── 5. Document type ─────────────────────────────────────────────────────────

console.log('\n=== 5. Document type ===');

await test('type: prefix extracts document type', () => {
  const r = parseSearchQuery('type:circular');
  assert.equal(r.documentType, 'circular');
  assert.equal(r.text, '');
});

await test('type: with quoted multi-word value', () => {
  const r = parseSearchQuery('type:"meeting minutes"');
  assert.equal(r.documentType, 'meeting minutes');
  assert.equal(r.text, '');
});

await test('type: mixed with text', () => {
  const r = parseSearchQuery('budget type:memo proposals');
  assert.equal(r.documentType, 'memo');
  assert.equal(r.text, 'budget proposals');
});

// ── 6. Tags ──────────────────────────────────────────────────────────────────

console.log('\n=== 6. Tags ===');

await test('tag: prefix extracts tag', () => {
  const r = parseSearchQuery('tag:budget');
  assert.deepEqual(r.tags, ['budget']);
  assert.equal(r.text, '');
});

await test('# shorthand extracts tag', () => {
  const r = parseSearchQuery('#budget');
  assert.deepEqual(r.tags, ['budget']);
});

await test('multiple tags', () => {
  const r = parseSearchQuery('#budget tag:finance documents');
  assert.deepEqual(r.tags, ['budget', 'finance']);
  assert.equal(r.text, 'documents');
});

await test('duplicate tags are deduplicated', () => {
  const r = parseSearchQuery('#budget #budget tag:budget');
  assert.deepEqual(r.tags, ['budget']);
});

await test('tags are lowercased', () => {
  const r = parseSearchQuery('#Budget tag:FINANCE');
  assert.deepEqual(r.tags, ['budget', 'finance']);
});

await test('trailing punctuation stripped from tags', () => {
  const r = parseSearchQuery('#budget, #finance.');
  assert.deepEqual(r.tags, ['budget', 'finance']);
});

// ── 7. Combined queries ──────────────────────────────────────────────────────

console.log('\n=== 7. Combined queries ===');

await test('all filters in one query', () => {
  const r = parseSearchQuery(
    'status:approved type:circular #budget after:2026-01-01 before:2026-12-31 proposals by Sohail',
  );
  assert.equal(r.status, 'approved');
  assert.equal(r.documentType, 'circular');
  assert.deepEqual(r.tags, ['budget']);
  assert.equal(r.dateFrom, '2026-01-01');
  assert.equal(r.dateTo, '2026-12-31');
  assert.equal(r.uploaderName, 'Sohail');
  assert.equal(r.text, 'proposals');
});

await test('meeting agendas → plain text', () => {
  const r = parseSearchQuery('meeting agendas');
  assert.equal(r.text, 'meeting agendas');
  assert.equal(r.status, null);
});

await test('documents uploaded by Sohail → uploader only', () => {
  const r = parseSearchQuery('documents uploaded by Sohail');
  assert.equal(r.uploaderName, 'Sohail');
  assert.equal(r.text, 'documents');
  assert.equal(r.status, null);
});

await test('approved budget proposals by Sohail after:2026-08-01', () => {
  const r = parseSearchQuery('approved budget proposals by Sohail after:2026-08-01');
  assert.equal(r.status, 'approved');
  assert.equal(r.uploaderName, 'Sohail');
  assert.equal(r.dateFrom, '2026-08-01');
  assert.equal(r.text, 'budget proposals');
});

// ── 8. Edge cases ────────────────────────────────────────────────────────────

console.log('\n=== 8. Edge cases ===');

await test('special characters in text are preserved', () => {
  const r = parseSearchQuery('Q&A session (2026)');
  assert.equal(r.text, 'Q&A session (2026)');
});

await test('status prefix takes priority over bare word', () => {
  const r = parseSearchQuery('status:rejected approved documents');
  assert.equal(r.status, 'rejected');
  // "approved" stays in text because status was already set via prefix
  assert.ok(r.text.includes('approved'));
});

await test('only first status prefix is used', () => {
  const r = parseSearchQuery('status:approved status:rejected');
  assert.equal(r.status, 'approved');
});

await test('only first type prefix is used', () => {
  const r = parseSearchQuery('type:circular type:memo');
  assert.equal(r.documentType, 'circular');
});

// ── 9. Date validation ───────────────────────────────────────────────────────

console.log('\n=== 9. Date validation ===');

await test('valid ISO date', () => {
  assert.equal(isValidIsoDate('2026-08-23'), true);
});

await test('valid leap-year date', () => {
  assert.equal(isValidIsoDate('2024-02-29'), true);
});

await test('invalid leap-year date', () => {
  assert.equal(isValidIsoDate('2025-02-29'), false);
});

await test('non-ISO format is invalid', () => {
  assert.equal(isValidIsoDate('23-08-2026'), false);
});

await test('text is invalid', () => {
  assert.equal(isValidIsoDate('not-a-date'), false);
});

await test('impossible month is invalid', () => {
  assert.equal(isValidIsoDate('2026-13-01'), false);
});

await test('impossible day is invalid', () => {
  assert.equal(isValidIsoDate('2026-04-31'), false);
});

// ── 10. Filter chip generation ───────────────────────────────────────────────

console.log('\n=== 10. Filter chip generation ===');

await test('describeFilters generates chips for all active filters', () => {
  const parsed = parseSearchQuery('approved type:circular #budget by Sohail after:2026-01-01');
  const labels: Record<string, string> = {
    approved: 'Approved',
    rejected: 'Rejected',
    draft: 'Draft',
  };
  const chips = describeFilters(parsed, labels);
  assert.ok(chips.length >= 4, `expected at least 4 chips, got ${chips.length}`);
  assert.ok(chips.some((c) => c.label === 'Approved'), 'should have status chip');
  assert.ok(chips.some((c) => c.label.includes('Sohail')), 'should have uploader chip');
  assert.ok(chips.some((c) => c.label.includes('circular')), 'should have type chip');
  assert.ok(chips.some((c) => c.label.includes('budget')), 'should have tag chip');
});

await test('describeFilters returns empty for no-filter query', () => {
  const parsed = parseSearchQuery('budget proposals');
  const chips = describeFilters(parsed, {});
  assert.equal(chips.length, 0);
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

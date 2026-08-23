/**
 * Tests for the bulk-organize planner.
 *
 * No network, no Supabase, no side effects — planOrganize() is pure, which is
 * exactly why it can be re-run server-side on apply to re-derive targets rather
 * than trusting what the browser sends back. These tests pin the rules that
 * make that safe.
 *
 *   npm run test:organize
 */
import assert from 'node:assert/strict';
import {
  CONFIDENCE_FLOOR,
  LOW_CONFIDENCE_BAR,
  effectiveYear,
  groupByTarget,
  planOrganize,
  type OrganizeCandidate,
} from '../src/lib/organize.ts';
import type { Category } from '../src/lib/types.ts';

// ── Test harness (same pattern as test-search.mts) ───────────────────────────

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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { id: 'dept-fin', name: 'Finance' },
  { id: 'dept-hr', name: 'HR' },
];

function category(over: Partial<Category> & Pick<Category, 'id' | 'department_id' | 'name' | 'slug'>): Category {
  return {
    description: null,
    match_keywords: [],
    is_active: true,
    sort_order: 1,
    ...over,
  } as Category;
}

const CATEGORIES: Category[] = [
  category({
    id: 'cat-invoices',
    department_id: 'dept-fin',
    name: 'Invoices',
    slug: 'invoices',
    match_keywords: ['invoice', 'bill', 'payment', 'gst'],
  }),
  category({
    id: 'cat-budgets',
    department_id: 'dept-fin',
    name: 'Budgets',
    slug: 'budgets',
    match_keywords: ['budget', 'allocation', 'expenditure'],
  }),
  category({
    id: 'cat-leave',
    department_id: 'dept-hr',
    name: 'Leave',
    slug: 'leave',
    match_keywords: ['leave', 'casual leave', 'medical leave', 'absence'],
  }),
];

function candidate(over: Partial<OrganizeCandidate> = {}): OrganizeCandidate {
  return {
    id: 'doc-1',
    title: 'Untitled',
    filename: 'file.pdf',
    text: null,
    currentCategoryId: null,
    currentConfidence: null,
    currentSource: 'system',
    ...over,
  };
}

// ── 1. Thresholds agree with the pipeline ────────────────────────────────────

console.log('\n=== 1. Thresholds ===');

await test('CONFIDENCE_FLOOR matches the pipeline keyword guard (0.35)', () => {
  // pipeline.ts refuses to write a keyword classification below 0.35. If these
  // drift, a bulk sweep and a per-document reprocess disagree about the same file.
  assert.equal(CONFIDENCE_FLOOR, 0.35);
});

await test('LOW_CONFIDENCE_BAR sits above the floor', () => {
  assert.ok(LOW_CONFIDENCE_BAR > CONFIDENCE_FLOOR);
});

// ── 2. Never touch a user-chosen folder ──────────────────────────────────────

console.log('\n=== 2. User-filed documents are untouchable ===');

await test("a 'user' source is skipped even with an obvious match", () => {
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({
      title: 'GST invoice for March payment',
      currentSource: 'user',
      currentCategoryId: 'cat-leave',
    }),
  ]);
  assert.equal(proposals.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]!.reason, 'user_filed');
});

await test("a 'user' source is skipped even when unfiled", () => {
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'invoice bill payment', currentSource: 'user', currentCategoryId: null }),
  ]);
  assert.equal(proposals.length, 0);
  assert.equal(skipped[0]!.reason, 'user_filed');
});

// ── 3. Matching and basis ────────────────────────────────────────────────────

console.log('\n=== 3. Matching ===');

await test('unfiled document with a clear title match is proposed', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'GST Invoice', filename: 'invoice-march-payment.pdf' }),
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.toCategoryId, 'cat-invoices');
  assert.equal(proposals[0]!.toDepartmentId, 'dept-fin');
});

await test('label is "Department / Category"', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'GST Invoice', filename: 'invoice-bill.pdf' }),
  ]);
  assert.equal(proposals[0]!.toLabel, 'Finance / Invoices');
});

await test('basis is title_and_filename when there is no text', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'GST Invoice', filename: 'invoice-bill.pdf', text: null }),
  ]);
  assert.equal(proposals[0]!.basis, 'title_and_filename');
});

await test('basis is extracted_text when text is present', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({
      title: 'Scan 001',
      filename: 'scan001.pdf',
      text: 'This invoice covers the GST payment and bill for March. Invoice total due.',
    }),
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.basis, 'extracted_text');
  assert.equal(proposals[0]!.toCategoryId, 'cat-invoices');
});

await test('whitespace-only text falls back to title_and_filename', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'GST Invoice', filename: 'invoice-bill.pdf', text: '   \n\t ' }),
  ]);
  assert.equal(proposals[0]!.basis, 'title_and_filename');
});

await test('fromLabel is null for an unfiled document', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'GST Invoice', filename: 'invoice-bill.pdf' }),
  ]);
  assert.equal(proposals[0]!.fromLabel, null);
});

await test('fromLabel names the current folder when misfiled', () => {
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({
      title: 'GST Invoice',
      filename: 'invoice-bill-payment.pdf',
      currentCategoryId: 'cat-leave',
      currentConfidence: 0.2,
    }),
  ]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.fromLabel, 'HR / Leave');
  assert.equal(proposals[0]!.toLabel, 'Finance / Invoices');
});

// ── 4. Skips ─────────────────────────────────────────────────────────────────

console.log('\n=== 4. Skips ===');

await test('no keyword match is skipped as no_match', () => {
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: 'zzz', filename: 'qqq.pdf' }),
  ]);
  assert.equal(proposals.length, 0);
  assert.equal(skipped[0]!.reason, 'no_match');
});

await test('empty title and filename is skipped, not crashed on', () => {
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({ title: '', filename: '', text: null }),
  ]);
  assert.equal(proposals.length, 0);
  assert.equal(skipped[0]!.reason, 'no_match');
});

await test('a document already in the proposed folder is skipped', () => {
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({
      title: 'GST Invoice',
      filename: 'invoice-bill.pdf',
      currentCategoryId: 'cat-invoices',
      currentConfidence: 0.1, // low, so it is in scope, but the target is unchanged
    }),
  ]);
  assert.equal(proposals.length, 0, 'a no-op move must not be proposed');
  assert.equal(skipped[0]!.reason, 'already_correct');
});

await test('a confidently filed document is left alone', () => {
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({
      title: 'GST Invoice',
      filename: 'invoice-bill.pdf',
      currentCategoryId: 'cat-leave',
      currentConfidence: 0.9,
    }),
  ]);
  assert.equal(proposals.length, 0);
  assert.equal(skipped[0]!.reason, 'confidently_filed');
});

await test('a category whose department is missing is not proposed', () => {
  // Guards against filing into an id the caller cannot render or resolve.
  const { proposals, skipped } = planOrganize(CATEGORIES, [{ id: 'dept-hr', name: 'HR' }], [
    candidate({ title: 'GST Invoice', filename: 'invoice-bill.pdf' }),
  ]);
  assert.equal(proposals.length, 0);
  assert.equal(skipped[0]!.reason, 'no_match');
});

// ── 5. Ordering and grouping ─────────────────────────────────────────────────

console.log('\n=== 5. Ordering and grouping ===');

await test('proposals are sorted strongest first', () => {
  // Both fixtures must clear CONFIDENCE_FLOOR or there is nothing to sort. A
  // single bare keyword scores ~0.30 and would be dropped, so each gets enough
  // distinct terms to pass, with the second scoring clearly higher.
  const { proposals } = planOrganize(CATEGORIES, DEPARTMENTS, [
    candidate({
      id: 'weaker',
      title: 'Scan A',
      filename: 'a.pdf',
      text: 'invoice bill payment',
    }),
    candidate({
      id: 'stronger',
      title: 'Scan B',
      filename: 'b.pdf',
      text: 'casual leave medical leave absence leave leave leave',
    }),
  ]);

  assert.equal(proposals.length, 2, 'both fixtures should clear the confidence floor');
  assert.equal(proposals[0]!.documentId, 'stronger');
  for (let i = 1; i < proposals.length; i++) {
    assert.ok(
      proposals[i - 1]!.confidence >= proposals[i]!.confidence,
      'confidence must be non-increasing',
    );
  }
});

await test('groupByTarget buckets by folder, largest group first', () => {
  const groups = groupByTarget([
    { toLabel: 'Finance / Invoices' } as any,
    { toLabel: 'HR / Leave' } as any,
    { toLabel: 'Finance / Invoices' } as any,
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.label, 'Finance / Invoices');
  assert.equal(groups[0]!.items.length, 2);
});

await test('every candidate is either proposed or skipped, never dropped', () => {
  const candidates = [
    candidate({ id: 'a', title: 'GST Invoice', filename: 'invoice.pdf' }),
    candidate({ id: 'b', title: 'zzz', filename: 'qqq.pdf' }),
    candidate({ id: 'c', currentSource: 'user' }),
    candidate({ id: 'd', title: 'budget allocation expenditure', filename: 'budget.pdf' }),
  ];
  const { proposals, skipped } = planOrganize(CATEGORIES, DEPARTMENTS, candidates);
  assert.equal(proposals.length + skipped.length, candidates.length);
});

// ── 6. Derived year ──────────────────────────────────────────────────────────

console.log('\n=== 6. effectiveYear ===');

await test('prefers document_date over created_at', () => {
  assert.equal(effectiveYear('2024-03-11', '2026-08-23T10:00:00Z'), 2024);
});

await test('falls back to created_at when document_date is null', () => {
  assert.equal(effectiveYear(null, '2026-08-23T10:00:00Z'), 2026);
});

await test('a nonsense document_date falls back rather than returning garbage', () => {
  assert.equal(effectiveYear('not-a-date', '2026-08-23T10:00:00Z'), 2026);
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

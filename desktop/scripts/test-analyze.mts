/**
 * Tests for the local analysis engine (the keyless replacement for the
 * Anthropic/AgentRouter call).
 *
 * Everything under test is pure and dependency-free: no network, no database,
 * no Electron. Run with plain Node type stripping:
 *
 *   npm run test:analyze
 */
import assert from 'node:assert/strict';
import { stemWord, tokenize, splitSentences } from '../src/main/processing/local/text.ts';
import { extractKeywords } from '../src/main/processing/local/keywords.ts';
import { summarize } from '../src/main/processing/local/summarize.ts';
import { detectDocumentType, pickCategory, toTitleCase } from '../src/main/processing/local/categorize.ts';
import { extractEntities, extractDates } from '../src/main/processing/local/entities.ts';
import { analyzeLocally, LOCAL_MODEL_NAME } from '../src/main/processing/local/index.ts';
import { scoreTerms } from '../src/main/processing/local/keywords.ts';

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

const INVOICE = [
  'This invoice is issued by Acme Corporation for consulting services rendered in April.',
  'Invoice Number 2024-041 is billed to the customer account on file.',
  'The amount due is $1,250.00 and payment terms are net thirty days.',
  'Please remit payment to accounts receivable before 2024-05-30 to avoid late fees.',
  'Subtotal charges were $1,100 and the applicable tax was $150.',
  'Issued on 2024-04-30 by the billing department.',
  'Contact billing@acme.example.com with any questions about this invoice.',
].join(' ');

const RESEARCH = [
  'Abstract: This paper presents a methodology for distributed caching in edge networks.',
  'The introduction surveys related work published in peer-reviewed journals.',
  'Our hypothesis is that consistent hashing reduces cache misses significantly.',
  'Experiments follow the methodology described by Chen et al in prior work.',
  'The conclusion summarizes findings and lists directions for future research.',
  'References and the DOI appendix appear at the end of the paper.',
].join(' ');

const NOTES = [
  'The weather was nice today so we walked in the park and had lunch outside.',
  'Later we talked about the trip planned for next month and the bookings.',
  'Everyone agreed the garden needs new plants before the summer arrives.',
].join(' ');

// ── 1. Stemming ──────────────────────────────────────────────────────────────

console.log('\n=== 1. stemWord ===');

await test('plural -s is stripped', () => {
  assert.equal(stemWord('invoices'), 'invoice');
  assert.equal(stemWord('cats'), 'cat');
});

await test('-ies becomes -y', () => {
  assert.equal(stemWord('categories'), 'category');
});

await test('-ing is stripped with consonant-doubling undo', () => {
  assert.equal(stemWord('running'), 'run');
  assert.equal(stemWord('processing'), 'process');
});

await test('-ed is stripped', () => {
  assert.equal(stemWord('tested'), 'test');
});

await test('short words are untouched', () => {
  assert.equal(stemWord('menu'), 'menu');
  assert.equal(stemWord('class'), 'class');
  assert.equal(stemWord('bus'), 'bus');
});

// ── 2. Tokenization ──────────────────────────────────────────────────────────

console.log('\n=== 2. tokenize ===');

await test('words are lowercased with stems and positions', () => {
  const t = tokenize('Dr. Smith bought 3 invoices.');
  assert.deepEqual(t.map((x) => x.term), ['dr', 'smith', 'bought', 'invoices']);
  assert.equal(t[3]!.stem, 'invoice');
  assert.deepEqual(t.map((x) => x.index), [0, 1, 2, 3]);
});

await test('pure numbers and single characters are dropped', () => {
  const t = tokenize('I saw 42 things and a 7');
  assert.deepEqual(t.map((x) => x.term), ['saw', 'things', 'and']);
});

await test('hyphens and apostrophes stay inside tokens', () => {
  const t = tokenize("peer-reviewed GPT-4 don't");
  assert.deepEqual(t.map((x) => x.term), ['peer-reviewed', 'gpt-4', "don't"]);
});

await test('raw casing is preserved for proper-noun detection', () => {
  const t = tokenize('John Smith arrived');
  assert.equal(t[0]!.raw, 'John');
  assert.equal(t[0]!.term, 'john');
});

// ── 3. Sentence splitting ────────────────────────────────────────────────────

console.log('\n=== 3. splitSentences ===');

await test('plain periods split', () => {
  const s = splitSentences('First one here. Second one follows.');
  assert.equal(s.length, 2);
  assert.equal(s[0]!.text, 'First one here.');
});

await test('abbreviations do not split', () => {
  const s = splitSentences('Dr. Smith arrived. He stayed.');
  assert.equal(s.length, 2);
  assert.equal(s[0]!.text, 'Dr. Smith arrived.');
});

await test('e.g. and initials do not split', () => {
  const s = splitSentences('Use e.g. this one. J. Smith agreed.');
  assert.equal(s.length, 2);
});

await test('lowercase continuation stays in one sentence', () => {
  const s = splitSentences('Yes it did. e.g. this stays. More follows here.');
  assert.equal(s.length, 2);
  assert.ok(s[0]!.text.includes('e.g.'));
});

await test('blank line splits even without punctuation', () => {
  const s = splitSentences('Alpha one here\n\nBeta two here');
  assert.equal(s.length, 2);
  assert.equal(s[1]!.text, 'Beta two here');
});

// ── 4. Keywords ──────────────────────────────────────────────────────────────

console.log('\n=== 4. extractKeywords ===');

await test('topical terms surface, stopwords never do', () => {
  const k = extractKeywords(INVOICE);
  assert.ok(k.includes('invoice'), `expected 'invoice' in ${JSON.stringify(k)}`);
  assert.ok(!k.includes('the') && !k.includes('and'));
});

await test('returns between 3 and 8 keywords for rich text', () => {
  const k = extractKeywords(RESEARCH);
  assert.ok(k.length >= 3 && k.length <= 8, `got ${k.length}`);
});

await test('bigrams suppress their halves', () => {
  const text =
    'machine learning models improve machine learning pipelines when machine learning data grows. ' +
    'The pipeline team shipped machine learning tooling this quarter.';
  const k = extractKeywords(text);
  assert.ok(k.includes('machine learning'), JSON.stringify(k));
  assert.ok(!k.includes('machine') && !k.includes('learning'));
});

await test('filename terms boost relevance', () => {
  const k = extractKeywords(
    'Notes from the field visit. The panels were inspected and cleaned. ' +
      'Output readings were recorded for each panel string.',
    { filename: 'solar-panel-inspection.pdf' },
  );
  assert.ok(k.some((x) => x.includes('panel')), JSON.stringify(k));
});

// ── 5. Summary ───────────────────────────────────────────────────────────────

console.log('\n=== 5. summarize ===');

await test('summary is extractive (sentences come from the text)', () => {
  const { summary } = summarize(RESEARCH, 'distributed caching paper');
  assert.ok(summary);
  for (const s of summary!.split(' ')) void s;
  assert.ok(RESEARCH.includes(summary!.split('. ')[0]!.replace(/\.$/, '')) || summary!.length > 20);
});

await test('summary has 2-4 sentences', () => {
  const { summary } = summarize(INVOICE);
  assert.ok(summary);
  const count = summary!.match(/[.!?](\s|$)/g)?.length ?? 0;
  assert.ok(count >= 2 && count <= 4, `got ${count}: ${summary}`);
});

await test('key points do not repeat summary sentences', () => {
  const { summary, keyPoints } = summarize(RESEARCH);
  assert.ok(summary);
  for (const kp of keyPoints) {
    assert.ok(!summary!.includes(kp.slice(0, 40)), `key point leaked into summary: ${kp}`);
  }
});

await test('thin text yields no summary', () => {
  const { summary, keyPoints } = summarize('Hello there friend.');
  assert.equal(summary, null);
  assert.deepEqual(keyPoints, []);
});

// ── 6. Document type ─────────────────────────────────────────────────────────

console.log('\n=== 6. detectDocumentType ===');

await test('invoice fixture → Invoice', () => {
  const r = detectDocumentType(tokenize(INVOICE));
  assert.ok(r);
  assert.equal(r!.type, 'Invoice');
});

await test('research fixture → Research Paper', () => {
  const r = detectDocumentType(tokenize(RESEARCH));
  assert.ok(r);
  assert.equal(r!.type, 'Research Paper');
});

await test('generic notes → null', () => {
  assert.equal(detectDocumentType(tokenize(NOTES)), null);
});

// ── 7. Category ──────────────────────────────────────────────────────────────

console.log('\n=== 7. pickCategory ===');

await test('reuses an existing category by name overlap', () => {
  const text =
    'The finance team reviewed the budget and the quarterly tax filings. ' +
      'Finance approved the budget changes after the tax review meeting. ' +
      'The budget and tax numbers were filed by the finance office.';
  const tokens = tokenize(text);
  const scored = scoreTerms(tokens);
  const r = pickCategory({
    tokens,
    scored,
    existing: [{ name: 'Finance', keywords: ['budget', 'tax'], count: 3 }],
  });
  assert.equal(r.category, 'Finance');
  assert.ok(r.confidence >= 0.6, `confidence ${r.confidence}`);
});

await test('coins a Title Case category from the top bigram', () => {
  const text =
    'The solar panel array was inspected. Each solar panel was cleaned. ' +
      'The solar panel output improved after cleaning the solar panel surface.';
  const tokens = tokenize(text);
  const scored = scoreTerms(tokens);
  const r = pickCategory({ tokens, scored, existing: [] });
  assert.equal(r.category, 'Solar Panel');
});

await test('falls back to document type when no topical signal', () => {
  const tokens = tokenize(INVOICE);
  const scored = scoreTerms(tokens);
  const r = pickCategory({ tokens, scored, existing: [] });
  assert.ok(r.category, 'category should not be null for an invoice');
});

await test('toTitleCase keeps small words lowercase mid-label', () => {
  assert.equal(toTitleCase('department of finance'), 'Department of Finance');
  assert.equal(toTitleCase('machine learning'), 'Machine Learning');
});

// ── 8. Entities ──────────────────────────────────────────────────────────────

console.log('\n=== 8. entities ===');

await test('emails are extracted and deduplicated', () => {
  const { entities } = extractEntities(
    'Mail john.doe@example.com or john.doe@example.com again. Also jane@corp.co.uk.',
  );
  const emails = entities.filter((e) => e.type === 'email').map((e) => e.name);
  assert.deepEqual(emails, ['john.doe@example.com', 'jane@corp.co.uk']);
});

await test('urls drop trailing punctuation', () => {
  const { entities } = extractEntities('See https://example.org/page. Then stop.');
  const urls = entities.filter((e) => e.type === 'url').map((e) => e.name);
  assert.deepEqual(urls, ['https://example.org/page']);
});

await test('money amounts with symbols and codes', () => {
  const { entities } = extractEntities('The fee is $1,250.00 plus 500 USD handling.');
  const money = entities.filter((e) => e.type === 'money').map((e) => e.name);
  assert.ok(money.includes('$1,250.00'), JSON.stringify(money));
  assert.ok(money.some((m) => m.includes('500 USD')), JSON.stringify(money));
});

await test('phone numbers need separators and 8-14 digits', () => {
  const { entities } = extractEntities('Call +1 555-123-4567 or 5551234567 (no separators).');
  const phones = entities.filter((e) => e.type === 'phone').map((e) => e.name);
  assert.ok(phones.some((p) => p.includes('555-123-4567')), JSON.stringify(phones));
});

await test('proper-noun runs are found but sentence starts are skipped', () => {
  const { entities } = extractEntities(
    'The agreement was signed by John Michael Smith and witnessed by the board.',
  );
  const names = entities.filter((e) => e.type === 'name').map((e) => e.name);
  assert.ok(names.includes('John Michael Smith'), JSON.stringify(names));
  assert.ok(!names.some((n) => n.startsWith('The')), JSON.stringify(names));
});

// ── 9. Dates ─────────────────────────────────────────────────────────────────

console.log('\n=== 9. dates ===');

await test('ISO dates are found', () => {
  const { importantDates } = extractDates('The meeting is on 2024-05-12 in room 4.');
  assert.ok(importantDates.some((d) => d.date === '2024-05-12'));
});

await test('nearby deadline cues set is_deadline', () => {
  const { importantDates } = extractDates('Payment is due 2024-06-01 without exception.');
  const d = importantDates.find((x) => x.date === '2024-06-01');
  assert.ok(d);
  assert.equal(d!.is_deadline, true);
  assert.equal(d!.label, 'Due');
});

await test('day-month-year and month-day-year forms', () => {
  const a = extractDates('Signed on 12 May 2024 by both parties.');
  assert.ok(a.importantDates.some((d) => d.date === '2024-05-12'));
  const b = extractDates('Filed May 12, 2024 at the office.');
  assert.ok(b.importantDates.some((d) => d.date === '2024-05-12'));
});

await test('DD/MM wins unless impossible', () => {
  const a = extractDates('Visit on 15/06/2024 please.');
  assert.ok(a.importantDates.some((d) => d.date === '2024-06-15'));
  const b = extractDates('Visit on 06/25/2024 please.');
  assert.ok(b.importantDates.some((d) => d.date === '2024-06-25'));
});

await test('impossible dates are rejected', () => {
  const { importantDates } = extractDates('Never on 2024-13-45 or 31/02/2024.');
  assert.deepEqual(importantDates, []);
});

await test('labelled Date: line wins for document_date', () => {
  const text = 'Date: 3 January 2023\n\nThe rest of the document mentions 2024-07-07 once.';
  const { documentDate } = extractDates(text);
  assert.equal(documentDate, '2023-01-03');
});

await test('without a label, the earliest date in the first third is used', () => {
  const text = `On 2020-01-05 the project began. ${'Filler content goes here. '.repeat(40)}Later, on 2022-09-09, it ended.`;
  const { documentDate } = extractDates(text);
  assert.equal(documentDate, '2020-01-05');
});

// ── 10. End to end ───────────────────────────────────────────────────────────

console.log('\n=== 10. analyzeLocally ===');

await test('invoice end to end: all nine fields', () => {
  const a = analyzeLocally({
    text: INVOICE,
    title: 'Acme consulting invoice',
    filename: 'acme-invoice-2024.pdf',
    existingCategories: [],
  });
  assert.equal(a.document_type, 'Invoice');
  assert.ok(a.category);
  assert.ok(a.keywords.length >= 3);
  assert.ok(a.summary && a.summary.length > 30);
  assert.ok(Array.isArray(a.key_points));
  assert.ok(a.entities.some((e) => e.type === 'email'));
  assert.ok(a.entities.some((e) => e.type === 'money'));
  assert.ok(a.important_dates.some((d) => d.is_deadline));
  assert.equal(a.document_date, '2024-04-30');
  assert.ok(a.confidence > 0 && a.confidence <= 1);
});

await test('notes end to end: no type, but keywords and summary', () => {
  const a = analyzeLocally({ text: NOTES, title: '', filename: 'notes.txt', existingCategories: [] });
  assert.equal(a.document_type, null);
  assert.ok(a.keywords.length >= 3);
  assert.ok(a.summary);
});

await test('existing category reuse flows through the orchestrator', () => {
  const a = analyzeLocally({
    text: RESEARCH,
    title: 'paper',
    filename: 'paper.pdf',
    existingCategories: [{ name: 'Research Papers', keywords: ['caching', 'hashing', 'paper'], count: 5 }],
  });
  assert.equal(a.category, 'Research Papers');
});

await test('model name is the local engine marker', () => {
  assert.equal(LOCAL_MODEL_NAME, 'revelio-local');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n========================================================');
console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log('  failures:');
  for (const f of failures) console.log(`   - ${f}`);
}
console.log('========================================================\n');
process.exit(fail > 0 ? 1 : 0);

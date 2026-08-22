/**
 * Live Anthropic Claude probe.
 *
 * Calls the real analysis path against a synthetic institutional document, so
 * the provider integration is proven rather than asserted. Reports the
 * structured contract field by field.
 *
 * Requires ANTHROPIC_API_KEY. Nothing is written to the database.
 *
 *   npm run probe:ai
 */
import { analyseDocument, DEFAULT_ANTHROPIC_MODEL } from '../src/lib/processing/analyze.ts';

const DEPARTMENTS = [
  { slug: 'academic', name: 'Academic' },
  { slug: 'administration', name: 'Administration' },
  { slug: 'finance', name: 'Finance' },
  { slug: 'hr', name: 'HR' },
  { slug: 'procurement', name: 'Procurement' },
];

const CATEGORIES = [
  { slug: 'notices', name: 'Notices', description: 'Announcements and circulars', department_slug: 'academic' },
  { slug: 'reports', name: 'Reports', description: 'Academic reports', department_slug: 'academic' },
  { slug: 'policies', name: 'Policies', description: 'Academic policies', department_slug: 'academic' },
  { slug: 'budgets', name: 'Budgets', description: 'Budget documents', department_slug: 'finance' },
  { slug: 'invoices', name: 'Invoices', description: 'Vendor invoices', department_slug: 'finance' },
  { slug: 'approvals', name: 'Approvals', description: 'Finance approvals', department_slug: 'finance' },
  { slug: 'quotations', name: 'Quotations', description: 'Vendor quotations', department_slug: 'procurement' },
];

// Synthetic, so nothing real is sent, but dense enough to exercise every field:
// a classifiable subject, named entities, a deadline and a document date.
const DOCUMENT = `
OFFICE OF THE REGISTRAR
Sri Venkateswara Institute of Technology

CIRCULAR No. SVIT/FIN/2026/114                        Date: 12 August 2026

Subject: Sanction of the Annual Departmental Budget for the Financial Year 2026-27

The Finance Committee, chaired by Dr. Lakshmi Narayanan, met on 05 August 2026 and
approved the departmental budget allocation for the financial year 2026-27 as set out
below. The total sanctioned outlay is Rs. 4,85,00,000.

  Computer Science and Engineering        Rs. 1,20,00,000
  Electronics and Communication          Rs.   95,00,000
  Mechanical Engineering                 Rs.   88,00,000
  Central Library                        Rs.   62,00,000
  Laboratory Equipment and Consumables   Rs. 1,20,00,000

Heads of Department are directed to submit consolidated procurement plans against
their sanctioned allocation to the Finance Office. The last date for submission of
procurement plans is 30 September 2026. Plans received after this date will be
carried over to the next quarter.

Utilisation certificates for the first quarter must reach the Accounts Section by
15 October 2026, countersigned by the Head of Department.

This circular is issued with the approval of the Principal, Dr. Anitha Rao.

                                                        (K. Srinivasan)
                                                        Registrar
`.trim();

const key = process.env.ANTHROPIC_API_KEY;
const base = process.env.ANTHROPIC_BASE_URL;
console.log(`\nANTHROPIC_API_KEY  ${key ? `present (${key.length} chars, prefix ${key.slice(0, 7)}…)` : 'ABSENT'}`);
if (key && !key.startsWith('sk-ant-')) {
  console.log('                   WARNING: an Anthropic API key starts with "sk-ant-".');
}
console.log(`endpoint           ${base ?? 'https://api.anthropic.com (default)'}`);
if (base) {
  console.log('                   WARNING: ANTHROPIC_BASE_URL routes document text to a third party.');
}
console.log(`model              ${process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL}`);
console.log(`document           ${DOCUMENT.length} chars\n`);

const started = Date.now();
const outcome = await analyseDocument({
  text: DOCUMENT,
  title: 'Annual Departmental Budget Sanction 2026-27',
  filename: 'circular-svit-fin-2026-114.pdf',
  departments: DEPARTMENTS,
  categories: CATEGORIES,
});
const elapsed = Date.now() - started;

if (!outcome.ok || !outcome.analysis) {
  console.log(`FAILED after ${elapsed} ms`);
  console.log(`  reason  ${outcome.reason}`);
  console.log(`  detail  ${outcome.detail ?? '(none)'}`);
  console.log(
    '\nThe pipeline treats this as a non-fatal skip: extraction, chunking and',
    '\ndeterministic keyword classification still run, and the UI states that no',
    '\nAI analysis exists rather than showing invented output.\n',
  );
  process.exit(1);
}

const a = outcome.analysis;
const knownCategory = CATEGORIES.some((c) => c.slug === a.category_slug);
const knownDepartment = DEPARTMENTS.some((d) => d.slug === a.department_slug);

console.log(`OK in ${elapsed} ms  (model: ${outcome.model})\n`);
console.log(`document_type    ${a.document_type ?? '(null)'}`);
console.log(`department_slug   ${a.department_slug ?? '(null)'}  ${knownDepartment ? '[in taxonomy]' : '[NOT IN TAXONOMY]'}`);
console.log(`category_slug     ${a.category_slug ?? '(null)'}  ${knownCategory ? '[in taxonomy]' : '[NOT IN TAXONOMY]'}`);
console.log(`confidence        ${a.confidence}`);
console.log(`document_date     ${a.document_date ?? '(null)'}`);
console.log(`tags              ${a.tags.join(', ') || '(none)'}`);
console.log(`\nsummary\n  ${a.summary ?? '(null)'}`);
console.log(`\nkey_points (${a.key_points.length})`);
for (const p of a.key_points) console.log(`  - ${p}`);
console.log(`\nentities (${a.entities.length})`);
for (const e of a.entities) console.log(`  - ${e.name}  [${e.type}]`);
console.log(`\nimportant_dates (${a.important_dates.length})`);
for (const d of a.important_dates) {
  console.log(`  - ${d.date}  ${d.label}${d.is_deadline ? '  (deadline)' : ''}`);
}

// Contract checks the UI depends on. A slug outside the taxonomy would resolve
// to no folder in pipeline.ts, and a non-ISO date would be dropped by coerce().
const problems: string[] = [];
if (a.category_slug && !knownCategory) problems.push('category_slug is outside the seeded taxonomy');
if (a.department_slug && !knownDepartment) problems.push('department_slug is outside the seeded taxonomy');
if (a.confidence < 0 || a.confidence > 1) problems.push(`confidence out of range: ${a.confidence}`);
for (const d of a.important_dates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) problems.push(`non-ISO date survived: ${d.date}`);
}
if (!a.summary) problems.push('no summary returned for a document that clearly has one');
if (a.important_dates.length === 0) problems.push('no dates extracted, though the document states three');

console.log(`\n${'='.repeat(56)}`);
if (problems.length === 0) {
  console.log('  Structured contract satisfied.');
} else {
  console.log('  Contract problems:');
  for (const p of problems) console.log(`    - ${p}`);
}
console.log(`${'='.repeat(56)}\n`);
process.exit(problems.length === 0 ? 0 : 1);

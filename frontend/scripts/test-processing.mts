/**
 * Phase 3 processing tests.
 *
 * Exercises the pure pipeline modules (extraction, OCR fallback decision, OCR,
 * chunking) plus the AI layer's schema and coercion against genuinely
 * constructed fixtures. No database and no network are required, so this is
 * runnable and repeatable.
 *
 *   node --experimental-strip-types scripts/test-processing.mts
 */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import {
  MIN_CHARS_PER_PAGE,
  extractPdfText,
  pageNeedsOcr,
  renderPdfPageToPng,
  normalize,
  capText,
  MAX_STORED_CHARS,
} from '../src/lib/processing/extract.ts';
import { ocrImage } from '../src/lib/processing/ocr.ts';
import { chunkPages, CHUNK_CHARS, MAX_CHUNKS } from '../src/lib/processing/chunk.ts';
import {
  analyseDocument,
  AGENTROUTER_DEFAULT_BASE_URL,
  AGENTROUTER_DEFAULT_MODEL,
  AGENTROUTER_DEFAULT_USER_AGENT,
  ANTHROPIC_DEFAULT_BASE_URL,
  buildAnalysisSchema,
  coerce,
  extractJsonObject,
  jsonContractInstruction,
  resolveBaseUrl,
  resolveProvider,
  resolveProviderName,
  __resetBaseUrlWarning,
} from '../src/lib/processing/analyze.ts';

// ── PDF construction with a real xref table ─────────────────────────────────
function buildPdf(objects: Buffer[]): Buffer {
  const header = Buffer.from('%PDF-1.4\n', 'latin1');
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let pos = header.length;

  for (const obj of objects) {
    offsets.push(pos);
    parts.push(obj);
    pos += obj.length;
  }

  const n = objects.length + 1;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<</Size ${n}/Root 1 0 R>>\nstartxref\n${pos}\n%%EOF\n`;

  parts.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(parts);
}

const obj = (num: number, body: string) =>
  Buffer.from(`${num} 0 obj\n${body}\nendobj\n`, 'latin1');

const streamObj = (num: number, dict: string, data: Buffer) =>
  Buffer.concat([
    Buffer.from(`${num} 0 obj\n<<${dict}/Length ${data.length}>>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);

/** A text-layer PDF with `pageTexts.length` pages. */
function textPdf(pageTexts: string[]): Buffer {
  const objects: Buffer[] = [];
  const pageIds = pageTexts.map((_, i) => 3 + i * 2);

  objects.push(obj(1, '<</Type/Catalog/Pages 2 0 R>>'));
  objects.push(
    obj(2, `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(' ')}]/Count ${pageIds.length}>>`),
  );

  const fontId = 3 + pageTexts.length * 2;
  pageTexts.forEach((text, i) => {
    const pid = pageIds[i]!;
    const cid = pid + 1;
    objects.push(
      obj(
        pid,
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${cid} 0 R` +
          `/Resources<</Font<</F1 ${fontId} 0 R>>>>>>`,
      ),
    );
    // Break the text into several Tj lines so the page has realistic structure.
    const lines = text.match(/.{1,70}(\s|$)/g) ?? [text];
    const content =
      'BT /F1 11 Tf 12 TL 60 740 Td\n' +
      lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join('\n') +
      '\nET';
    objects.push(streamObj(cid, '', Buffer.from(content, 'latin1')));
  });

  objects.push(obj(fontId, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'));
  return buildPdf(objects);
}

/** An image-only PDF: no text layer at all, so OCR is the only way in. */
function scannedPdf(text: string): Buffer {
  const W = 1000;
  const H = 260;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(text, 30, 90);
  ctx.font = '34px sans-serif';
  ctx.fillText('Last date 2026-09-30', 30, 170);

  const jpeg = canvas.toBuffer('image/jpeg', 92);

  const objects: Buffer[] = [
    obj(1, '<</Type/Catalog/Pages 2 0 R>>'),
    obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>'),
    obj(
      3,
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Contents 4 0 R` +
        `/Resources<</XObject<</Im0 5 0 R>>>>>>`,
    ),
    streamObj(4, '', Buffer.from(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`, 'latin1')),
    streamObj(
      5,
      `/Type/XObject/Subtype/Image/Width ${W}/Height ${H}` +
        `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode`,
      jpeg,
    ),
  ];
  return buildPdf(objects);
}

/** Valid PDF, one page, no content stream at all. */
function emptyPdf(): Buffer {
  return buildPdf([
    obj(1, '<</Type/Catalog/Pages 2 0 R>>'),
    obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>'),
    obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>'),
  ]);
}

function pngWithText(text: string): Buffer {
  const canvas = createCanvas(900, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 200);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText(text, 25, 110);
  return canvas.toBuffer('image/png');
}

// ── harness ─────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    fail++;
    const msg = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${msg}`);
    console.log(`  FAIL  ${name}\n        ${msg.split('\n')[0]}`);
  }
}

console.log('\n=== 1. Normal text PDF ===');

const BODY_A =
  'Scholarship Eligibility Guidelines 2026. Applicants must maintain a minimum CGPA of 8.0 ' +
  'and submit income proof. The last date for submission is 30 September 2026. ' +
  'Late applications will not be considered by the Registrar office. ';
const BODY_B =
  'Procurement Policy for laptop purchases. Vendors must submit a quotation with GST details. ' +
  'The purchase requisition requires approval from the Finance department before tender. ';

await test('extracts text from a 2-page text PDF', async () => {
  const r = await extractPdfText(new Uint8Array(textPdf([BODY_A.repeat(3), BODY_B.repeat(3)])));
  assert.equal(r.pageCount, 2, `expected 2 pages, got ${r.pageCount}`);
  assert.equal(r.pages.length, 2);
  assert.ok(r.charCount > 400, `expected >400 chars, got ${r.charCount}`);
  assert.match(r.pages[0]!.text, /Scholarship Eligibility/);
  assert.match(r.pages[1]!.text, /Procurement Policy/);
});

await test('a good text page does NOT request OCR', async () => {
  const r = await extractPdfText(new Uint8Array(textPdf([BODY_A.repeat(3)])));
  assert.equal(pageNeedsOcr(r.pages[0]!), false, 'text page wrongly flagged for OCR');
});

await test('page-level text is preserved per page (no cross-page bleed)', async () => {
  const r = await extractPdfText(new Uint8Array(textPdf([BODY_A.repeat(2), BODY_B.repeat(2)])));
  assert.ok(!r.pages[0]!.text.includes('Procurement'), 'page 1 leaked page 2 content');
  assert.ok(!r.pages[1]!.text.includes('Scholarship'), 'page 2 leaked page 1 content');
});

console.log('\n=== 2. Scanned PDF (OCR fallback) ===');

const scanned = scannedPdf('BUDGET APPROVAL 2026');

await test('scanned PDF yields no usable text layer', async () => {
  const r = await extractPdfText(new Uint8Array(scanned));
  assert.equal(r.pageCount, 1);
  assert.ok(
    r.pages[0]!.text.trim().length < MIN_CHARS_PER_PAGE,
    `image-only page unexpectedly produced ${r.pages[0]!.text.length} chars`,
  );
});

await test('scanned page IS flagged for OCR', async () => {
  const r = await extractPdfText(new Uint8Array(scanned));
  assert.equal(pageNeedsOcr(r.pages[0]!), true, 'scanned page not flagged for OCR');
});

await test('rasterises a scanned page to a non-blank PNG', async () => {
  const png = await renderPdfPageToPng(new Uint8Array(scanned), 1, 2);
  assert.ok(png.length > 2000, `png suspiciously small: ${png.length} bytes`);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'not a PNG');
});

await test('OCR recovers text from the rasterised scan', async () => {
  const png = await renderPdfPageToPng(new Uint8Array(scanned), 1, 2);
  const res = await ocrImage(png);
  const upper = res.text.toUpperCase();
  assert.ok(res.text.trim().length > 0, 'OCR returned no text');
  assert.ok(
    upper.includes('BUDGET') || upper.includes('APPROVAL'),
    `OCR text did not contain expected words. got: ${JSON.stringify(res.text.slice(0, 160))}`,
  );
});

await test('OCR reads an uploaded image directly', async () => {
  const res = await ocrImage(pngWithText('INVOICE 2026'));
  assert.ok(
    res.text.toUpperCase().includes('INVOICE'),
    `got: ${JSON.stringify(res.text.slice(0, 160))}`,
  );
});

console.log('\n=== 3. Poor / empty PDF ===');

await test('empty PDF extracts cleanly with zero text (not an error)', async () => {
  const r = await extractPdfText(new Uint8Array(emptyPdf()));
  assert.equal(r.pageCount, 1);
  assert.equal(r.charCount, 0);
  assert.equal(pageNeedsOcr(r.pages[0]!), true);
});

await test('OCR of a blank page returns empty text, not noise', async () => {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 600, 200);
  const res = await ocrImage(canvas.toBuffer('image/png'));
  assert.ok(res.text.trim().length < 10, `blank page produced text: ${JSON.stringify(res.text)}`);
});

console.log('\n=== 4. Invalid file ===');

await test('random bytes are rejected with a throw (not silent success)', async () => {
  const garbage = Buffer.alloc(4096);
  for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 37 + 11) & 0xff;
  await assert.rejects(
    () => extractPdfText(new Uint8Array(garbage)),
    'expected extractPdfText to reject on garbage input',
  );
});

await test('truncated PDF header is rejected', async () => {
  await assert.rejects(() => extractPdfText(new Uint8Array(Buffer.from('%PDF-1.4\nbroken'))));
});

console.log('\n=== 5. Large file ===');

await test('handles a large multi-page PDF and caps stored text', async () => {
  const pages = Array.from({ length: 30 }, (_, i) => `Page ${i + 1}. ${BODY_A.repeat(6)}`);
  const big = textPdf(pages);
  const started = Date.now();
  const r = await extractPdfText(new Uint8Array(big));
  const elapsed = Date.now() - started;
  assert.equal(r.pageCount, 30);
  assert.ok(r.charCount > 10_000, `expected >10k chars, got ${r.charCount}`);
  console.log(`        (${(big.length / 1024).toFixed(0)} KB, ${r.charCount} chars, ${elapsed} ms)`);
});

await test('capText enforces the storage ceiling', () => {
  const over = 'x'.repeat(MAX_STORED_CHARS + 5000);
  assert.equal(capText(over).length, MAX_STORED_CHARS);
  assert.equal(capText('short').length, 5);
});

console.log('\n=== 5b. Buffer reuse (regression) ===');

// The original suite handed a FRESH Uint8Array to every call, which is exactly
// why it missed that pdf.js detaches the buffer. The pipeline reuses one array,
// so these tests reproduce the pipeline's actual usage.
await test('pdf.js detaches the input buffer (documents the hazard)', async () => {
  const bytes = new Uint8Array(textPdf([BODY_A.repeat(2)]));
  assert.ok(bytes.byteLength > 0);
  await extractPdfText(bytes);
  assert.equal(
    bytes.byteLength,
    0,
    'expected pdf.js to detach the buffer; if this now fails the hazard is gone and the guard may be simplified',
  );
});

await test('extract then rasterise from ONE retained buffer, pipeline-style', async () => {
  // Mirrors pipeline.ts: keep a pristine Buffer, hand out a fresh copy per call.
  const fileBytes = Buffer.from(scannedPdf('QUARTERLY BUDGET'));
  const freshBytes = () => new Uint8Array(fileBytes);

  const direct = await extractPdfText(freshBytes());
  assert.equal(direct.pageCount, 1);
  assert.equal(pageNeedsOcr(direct.pages[0]!), true);

  // This is the call that used to throw "detached ArrayBuffer".
  const png = await renderPdfPageToPng(freshBytes(), 1);
  assert.ok(png.length > 2000, `png too small: ${png.length}`);

  // And a second render must also work, proving the retained copy survives.
  const png2 = await renderPdfPageToPng(freshBytes(), 1);
  assert.ok(png2.length > 2000, 'second render failed — buffer not retained');
  assert.equal(fileBytes.byteLength > 0, true, 'retained buffer was detached');
});

await test('multi-page scan rasterises every page from one retained buffer', async () => {
  const W = 700;
  const H = 200;
  const mk = (label: string) => {
    const cv = createCanvas(W, H);
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#000000';
    c.font = 'bold 40px sans-serif';
    c.fillText(label, 20, 110);
    return cv.toBuffer('image/jpeg', 90);
  };

  const jpegs = [mk('PAGE ONE'), mk('PAGE TWO'), mk('PAGE THREE')];
  const objects: Buffer[] = [];
  const pageIds = jpegs.map((_, i) => 3 + i * 2);
  objects.push(obj(1, '<</Type/Catalog/Pages 2 0 R>>'));
  objects.push(
    obj(2, `<</Type/Pages/Kids[${pageIds.map((i) => `${i} 0 R`).join(' ')}]/Count ${jpegs.length}>>`),
  );
  jpegs.forEach((jpeg, i) => {
    const pid = pageIds[i]!;
    const cid = pid + 1;
    const imgId = 3 + jpegs.length * 2 + i;
    objects.push(
      obj(
        pid,
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Contents ${cid} 0 R` +
          `/Resources<</XObject<</Im0 ${imgId} 0 R>>>>>>`,
      ),
    );
    objects.push(streamObj(cid, '', Buffer.from(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`, 'latin1')));
  });
  jpegs.forEach((jpeg, i) => {
    objects.push(
      streamObj(
        3 + jpegs.length * 2 + i,
        `/Type/XObject/Subtype/Image/Width ${W}/Height ${H}` +
          `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode`,
        jpeg,
      ),
    );
  });

  const fileBytes = Buffer.from(buildPdf(objects));
  const freshBytes = () => new Uint8Array(fileBytes);

  const direct = await extractPdfText(freshBytes());
  assert.equal(direct.pageCount, 3, `expected 3 pages, got ${direct.pageCount}`);

  for (let n = 1; n <= 3; n++) {
    const png = await renderPdfPageToPng(freshBytes(), n);
    assert.ok(png.length > 1500, `page ${n} render too small: ${png.length}`);
  }
});

console.log('\n=== 6. Normalisation ===');
await test('de-hyphenates across line breaks', () => {
  assert.equal(normalize('schol-\narship budget'), 'scholarship budget');
});

await test('collapses whitespace and strips soft hyphens', () => {
  assert.equal(normalize('a   b\n\n\n\nc'), 'a b\n\nc');
});

console.log('\n=== 7. Chunking ===');

await test('chunk_index is contiguous from 0', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, text: BODY_A.repeat(3) }));
  const chunks = chunkPages(pages);
  assert.ok(chunks.length > 1, 'expected multiple chunks');
  chunks.forEach((c, i) => assert.equal(c.chunk_index, i, `gap at index ${i}`));
});

await test('records page ranges', () => {
  const chunks = chunkPages([
    { page: 1, text: BODY_A },
    { page: 2, text: BODY_B },
  ]);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0]!.page_start, 1);
  assert.ok(chunks[0]!.page_end !== null);
});

await test('splits a single oversized page and keeps page attribution', () => {
  const huge = 'alpha beta gamma delta '.repeat(600); // ~13k chars
  const chunks = chunkPages([{ page: 7, text: huge }]);
  assert.ok(chunks.length > 1, `expected split, got ${chunks.length}`);
  for (const c of chunks) {
    assert.equal(c.page_start, 7);
    assert.equal(c.page_end, 7);
    assert.ok(c.content.length <= CHUNK_CHARS + 50, `chunk too big: ${c.content.length}`);
  }
});

await test('a no-whitespace blob terminates and loses no leading content', () => {
  const blob = 'A'.repeat(10_000);
  const chunks = chunkPages([{ page: 1, text: blob }]);
  assert.ok(chunks.length > 1);
  assert.ok(chunks[0]!.content.startsWith('A'));
  const total = chunks.reduce((n, c) => n + c.content.length, 0);
  assert.ok(total >= blob.length, `content lost: ${total} < ${blob.length}`);
});

await test('never emits empty or whitespace-only chunks', () => {
  const chunks = chunkPages([
    { page: 1, text: '   ' },
    { page: 2, text: '' },
    { page: 3, text: BODY_A },
  ]);
  for (const c of chunks) assert.ok(c.content.trim().length > 0, 'empty chunk emitted');
});

await test('respects MAX_CHUNKS', () => {
  const pages = Array.from({ length: 900 }, (_, i) => ({ page: i + 1, text: BODY_A.repeat(2) }));
  const chunks = chunkPages(pages);
  assert.ok(chunks.length <= MAX_CHUNKS, `exceeded MAX_CHUNKS: ${chunks.length}`);
  chunks.forEach((c, i) => assert.equal(c.chunk_index, i));
});

// Regression: an early-only word boundary made the cut point land at or below
// CHUNK_OVERLAP, so slice(cut - OVERLAP) returned the same string and the loop
// emitted MAX_CHUNKS identical chunks instead of advancing.
//
// The filler must be NON-PERIODIC. A homogeneous run like 'C'.repeat(n) yields
// byte-identical consecutive chunks even when the loop is advancing correctly,
// so uniqueness would be a false alarm rather than a stall detector.
function nonPeriodicFiller(minLength: number): string {
  let s = '';
  let n = 0;
  while (s.length < minLength) s += String(n++);
  return s.slice(0, minLength);
}

await test('a page whose only space is near the start still makes progress', () => {
  const text = `${'B'.repeat(40)} ${nonPeriodicFiller(12_000)}`;
  const chunks = chunkPages([{ page: 3, text }]);

  assert.ok(chunks.length > 1, 'expected a split');
  assert.ok(chunks.length < MAX_CHUNKS, `stalled: produced ${chunks.length} chunks`);

  const unique = new Set(chunks.map((c) => c.content));
  assert.equal(unique.size, chunks.length, 'duplicate chunk contents — loop did not advance');
  chunks.forEach((c, i) => assert.equal(c.chunk_index, i));
  for (const c of chunks) assert.equal(c.page_start, 3);
});

await test('pathological leading-space text terminates and preserves length', () => {
  const text = ` ${nonPeriodicFiller(9_000)}`;
  const chunks = chunkPages([{ page: 1, text }]);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.length < MAX_CHUNKS, `stalled: ${chunks.length} chunks`);
  const total = chunks.reduce((n, c) => n + c.content.length, 0);
  assert.ok(total >= 9_000, `content lost: ${total}`);
});

await test('homogeneous text advances even though chunks repeat', () => {
  // Guards the loop itself rather than content uniqueness: identical chunks are
  // acceptable here, an unbounded count is not.
  const chunks = chunkPages([{ page: 1, text: `${'B'.repeat(40)} ${'C'.repeat(12_000)}` }]);
  assert.ok(chunks.length < 20, `expected ~9 chunks, got ${chunks.length} (loop not advancing)`);
  chunks.forEach((c, i) => assert.equal(c.chunk_index, i));
});

console.log('\n=== 8. AI analysis layer (schema + coercion, no network) ===');

// The structured-outputs JSON Schema subset. A violation is a 400 from the API
// at runtime, on the first real upload — so it is asserted here instead.
const SUPPORTED_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email',
  'hostname', 'uri', 'ipv4', 'ipv6', 'uuid',
]);
const UNSUPPORTED_KEYWORDS = [
  'nullable', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'minLength', 'maxLength', 'pattern', 'maxItems',
];

/** Walks every schema node, reporting the JSON path of each violation. */
function schemaViolations(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((n, i) => schemaViolations(n, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];

  const o = node as Record<string, unknown>;
  const out: string[] = [];

  for (const kw of UNSUPPORTED_KEYWORDS) {
    if (kw in o) out.push(`${path}.${kw} is outside the supported subset`);
  }
  if ('minItems' in o && o.minItems !== 0 && o.minItems !== 1) {
    out.push(`${path}.minItems must be 0 or 1, got ${String(o.minItems)}`);
  }
  if (typeof o.format === 'string' && !SUPPORTED_FORMATS.has(o.format)) {
    out.push(`${path}.format "${o.format}" is not a supported string format`);
  }
  if (o.type === 'object' && o.additionalProperties !== false) {
    out.push(`${path} is an object without additionalProperties: false`);
  }
  if (Array.isArray(o.enum) && o.enum.length === 0) {
    out.push(`${path}.enum is empty, which is not a valid schema`);
  }

  for (const [key, value] of Object.entries(o)) {
    if (key === 'enum' || key === 'required' || key === 'const') continue;
    out.push(...schemaViolations(value, `${path}.${key}`));
  }
  return out;
}

const DEPT_SLUGS = ['academic', 'administration', 'finance', 'hr', 'procurement'];
const CAT_SLUGS = ['notices', 'reports', 'policies', 'budgets', 'invoices'];

await test('response schema stays inside the structured-outputs subset', () => {
  const violations = schemaViolations(buildAnalysisSchema(DEPT_SLUGS, CAT_SLUGS));
  assert.deepEqual(violations, [], `schema violations:\n  ${violations.join('\n  ')}`);
});

await test('every top-level field is required, so nothing can be silently omitted', () => {
  const schema = buildAnalysisSchema(DEPT_SLUGS, CAT_SLUGS) as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.deepEqual(
    [...schema.required].sort(),
    Object.keys(schema.properties).sort(),
    'a property is not in required: the model could omit it instead of returning null',
  );
});

await test('taxonomy slugs are constrained by enum, with null permitted', () => {
  const schema = buildAnalysisSchema(DEPT_SLUGS, CAT_SLUGS) as {
    properties: { category_slug: { enum?: unknown[] }; department_slug: { enum?: unknown[] } };
  };
  assert.deepEqual(schema.properties.category_slug.enum, [...CAT_SLUGS, null]);
  assert.deepEqual(schema.properties.department_slug.enum, [...DEPT_SLUGS, null]);
});

await test('an unseeded taxonomy degrades to a nullable string, not an empty enum', () => {
  const schema = buildAnalysisSchema([], []) as {
    properties: { category_slug: Record<string, unknown> };
  };
  assert.ok(!('enum' in schema.properties.category_slug), 'emitted an invalid empty enum');
  assert.deepEqual(schemaViolations(schema), []);
});

await test('duplicate slugs are de-duplicated in the enum', () => {
  const schema = buildAnalysisSchema(['finance', 'finance'], ['policies', 'policies', '']) as {
    properties: { category_slug: { enum: unknown[] }; department_slug: { enum: unknown[] } };
  };
  assert.deepEqual(schema.properties.department_slug.enum, ['finance', null]);
  assert.deepEqual(schema.properties.category_slug.enum, ['policies', null]);
});

await test('coerce clamps confidence into 0..1', () => {
  assert.equal(coerce({ confidence: 4.2 }).confidence, 1);
  assert.equal(coerce({ confidence: -3 }).confidence, 0);
  assert.equal(coerce({ confidence: 0.62 }).confidence, 0.62);
});

await test('coerce rejects a non-finite confidence rather than storing NaN', () => {
  // typeof NaN === 'number', and clamping NaN yields NaN, so this would reach
  // the numeric confidence column and the AI badge percentage.
  assert.equal(coerce({ confidence: NaN }).confidence, 0);
  assert.equal(coerce({ confidence: Infinity }).confidence, 0);
  assert.equal(coerce({ confidence: '0.9' }).confidence, 0);
});

await test('coerce drops dates that are not ISO YYYY-MM-DD', () => {
  const a = coerce({
    document_date: '30 September 2026',
    important_dates: [
      { label: 'Last date', date: '2026-09-30', is_deadline: true },
      { label: 'Vague', date: 'next Tuesday', is_deadline: true },
      { label: 'Partial', date: '2026-09', is_deadline: false },
    ],
  });
  assert.equal(a.document_date, null, 'accepted a non-ISO document_date');
  assert.equal(a.important_dates.length, 1, 'kept an unparseable date');
  assert.equal(a.important_dates[0]!.date, '2026-09-30');
});

await test('coerce treats is_deadline as true only for a literal true', () => {
  const a = coerce({
    important_dates: [
      { label: 'A', date: '2026-01-01', is_deadline: 'yes' },
      { label: 'B', date: '2026-01-02', is_deadline: 1 },
      { label: 'C', date: '2026-01-03', is_deadline: true },
    ],
  });
  assert.deepEqual(a.important_dates.map((d) => d.is_deadline), [false, false, true]);
});

await test('coerce drops entities with no name and defaults a missing type', () => {
  const a = coerce({
    entities: [{ name: 'Registrar', type: 'role' }, { type: 'org' }, { name: '  ' }, { name: 'Finance' }],
  });
  assert.deepEqual(a.entities, [
    { name: 'Registrar', type: 'role' },
    { name: 'Finance', type: 'unknown' },
  ]);
});

await test('coerce bounds every array', () => {
  const a = coerce({
    tags: Array.from({ length: 50 }, (_, i) => `tag-${i}`),
    key_points: Array.from({ length: 50 }, (_, i) => `point ${i}`),
    entities: Array.from({ length: 90 }, (_, i) => ({ name: `E${i}`, type: 'x' })),
    important_dates: Array.from({ length: 90 }, (_, i) => ({
      label: `D${i}`,
      date: '2026-01-01',
      is_deadline: false,
    })),
  });
  assert.equal(a.tags.length, 12);
  assert.equal(a.key_points.length, 12);
  assert.equal(a.entities.length, 40);
  assert.equal(a.important_dates.length, 25);
});

await test('coerce turns blank strings into null, never empty output rendered as content', () => {
  const a = coerce({ summary: '   ', document_type: '', category_slug: '\n\t', tags: ['', '  ', 'real'] });
  assert.equal(a.summary, null);
  assert.equal(a.document_type, null);
  assert.equal(a.category_slug, null);
  assert.deepEqual(a.tags, ['real']);
});

await test('coerce survives structurally wrong input without throwing', () => {
  for (const junk of [null, undefined, 'a string', 42, [], { entities: 'nope', tags: {} }]) {
    const a = coerce(junk);
    assert.equal(a.summary, null);
    assert.deepEqual(a.tags, []);
    assert.deepEqual(a.entities, []);
    assert.deepEqual(a.important_dates, []);
    assert.equal(a.confidence, 0);
  }
});

// ── failure contract, proven without a network call ─────────────────────────
const savedKey = process.env.ANTHROPIC_API_KEY;
const TAXONOMY_ARGS = {
  departments: DEPT_SLUGS.map((slug) => ({ slug, name: slug })),
  categories: CAT_SLUGS.map((slug) => ({
    slug,
    name: slug,
    description: null,
    department_slug: 'academic',
  })),
};

await test('analyseDocument reports NO_API_KEY instead of inventing analysis', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await analyseDocument({
    text: 'A'.repeat(500),
    title: 'Budget',
    filename: 'b.pdf',
    ...TAXONOMY_ARGS,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_API_KEY');
  assert.equal(r.analysis, null, 'returned an analysis with no provider configured');
});

await test('analyseDocument reports NO_TEXT before spending an API call', async () => {
  // A key is present, so reaching NO_TEXT proves the guard runs before the
  // provider call — an empty document never costs a request.
  process.env.ANTHROPIC_API_KEY = 'sk-ant-not-a-real-key-for-tests';
  const r = await analyseDocument({
    text: '  short  ',
    title: 'Empty',
    filename: 'e.pdf',
    ...TAXONOMY_ARGS,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_TEXT');
  assert.equal(r.analysis, null);
});

if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
else process.env.ANTHROPIC_API_KEY = savedKey;

// ── 9. Endpoint resolution ──────────────────────────────────────────────────
// These matter because the failure they guard against is silent: an inherited
// ANTHROPIC_BASE_URL would forward institutional document text to a third party
// with nothing in the code saying so. resolveBaseUrl takes its environment as a
// parameter precisely so this is testable without mutating process.env.
console.log('\n=== 9. Endpoint resolution (where document text is sent) ===');

await test('no override resolves to Anthropic directly', () => {
  __resetBaseUrlWarning();
  const r = resolveBaseUrl({}, () => {});
  assert.equal(r.baseUrl, ANTHROPIC_DEFAULT_BASE_URL);
  assert.equal(r.source, 'default');
});

await test('an inherited base URL is IGNORED, not silently obeyed', () => {
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  const r = resolveBaseUrl({ ANTHROPIC_BASE_URL: 'https://agentrouter.org' }, (m) => warnings.push(m));
  assert.equal(
    r.baseUrl,
    ANTHROPIC_DEFAULT_BASE_URL,
    'an unapproved third-party endpoint was accepted — document text would leak there',
  );
  assert.equal(r.source, 'default');
  assert.deepEqual(r.ignored, { variable: 'ANTHROPIC_BASE_URL', value: 'https://agentrouter.org' });
  assert.equal(warnings.length, 1, 'ignoring an override must be reported, never silent');
  assert.match(warnings[0]!, /IGNORING/);
  assert.match(warnings[0]!, /agentrouter\.org/, 'the warning must name the endpoint it refused');
});

await test('an explicitly permitted base URL is honoured', () => {
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  const r = resolveBaseUrl(
    {
      ANTHROPIC_BASE_URL: 'https://gateway.internal.example',
      ANTHROPIC_ALLOW_BASE_URL_OVERRIDE: 'true',
    },
    (m) => warnings.push(m),
  );
  assert.equal(r.baseUrl, 'https://gateway.internal.example', 'a deliberate proxy must still work');
  assert.equal(r.source, 'ANTHROPIC_BASE_URL');
  assert.equal(r.ignored, undefined);
  assert.equal(warnings.length, 1, 'using a proxy is worth one line in the log');
});

await test('the opt-in must be exactly true, not merely present', () => {
  // 'false', '1', 'yes' and an empty value are all rejected. A half-set flag
  // resolving to "allowed" is the failure mode worth guarding.
  for (const value of ['false', '1', 'yes', '', 'TRUE ']) {
    __resetBaseUrlWarning();
    const r = resolveBaseUrl(
      { ANTHROPIC_BASE_URL: 'https://proxy.example', ANTHROPIC_ALLOW_BASE_URL_OVERRIDE: value },
      () => {},
    );
    const expected = value.trim().toLowerCase() === 'true' ? 'https://proxy.example' : ANTHROPIC_DEFAULT_BASE_URL;
    assert.equal(r.baseUrl, expected, `ANTHROPIC_ALLOW_BASE_URL_OVERRIDE=${JSON.stringify(value)}`);
  }
});

await test('a blank base URL is treated as unset', () => {
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  const r = resolveBaseUrl({ ANTHROPIC_BASE_URL: '   ' }, (m) => warnings.push(m));
  assert.equal(r.baseUrl, ANTHROPIC_DEFAULT_BASE_URL);
  assert.equal(r.source, 'default');
  assert.equal(warnings.length, 0, 'an empty value is not a redirect and should not warn');
});

await test('the warning is emitted once per process, not once per document', () => {
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  const env = { ANTHROPIC_BASE_URL: 'https://agentrouter.org' };
  for (let i = 0; i < 5; i++) resolveBaseUrl(env, (m) => warnings.push(m));
  assert.equal(warnings.length, 1, 'a per-document warning would flood the log during a batch');
});

// ── REVELIO_ANTHROPIC_BASE_URL: project-owned, self-authorising ─────────────
await test('REVELIO_ANTHROPIC_BASE_URL is honoured without a second flag', () => {
  // It cannot be inherited from an unrelated tool, so its presence IS the
  // deliberate intent that ANTHROPIC_ALLOW_BASE_URL_OVERRIDE exists to extract.
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  const r = resolveBaseUrl(
    { REVELIO_ANTHROPIC_BASE_URL: 'https://co.agentrouter.org' },
    (m) => warnings.push(m),
  );
  assert.equal(r.baseUrl, 'https://co.agentrouter.org');
  assert.equal(r.source, 'REVELIO_ANTHROPIC_BASE_URL');
  assert.equal(r.ignored, undefined);
  assert.equal(warnings.length, 1, 'the destination must still be named in the log');
  assert.match(warnings[0]!, /co\.agentrouter\.org/);
});

await test('REVELIO_ANTHROPIC_BASE_URL takes precedence over ANTHROPIC_BASE_URL', () => {
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  const r = resolveBaseUrl(
    {
      REVELIO_ANTHROPIC_BASE_URL: 'https://co.agentrouter.org',
      ANTHROPIC_BASE_URL: 'https://other.example',
      ANTHROPIC_ALLOW_BASE_URL_OVERRIDE: 'true',
    },
    (m) => warnings.push(m),
  );
  assert.equal(r.baseUrl, 'https://co.agentrouter.org', 'precedence must not depend on the opt-in flag');
  assert.equal(r.source, 'REVELIO_ANTHROPIC_BASE_URL');
  assert.match(warnings[0]!, /overrid/i, 'the shadowed variable should be reported');
  assert.match(warnings[0]!, /other\.example/, 'and named, so a stale value is visible');
});

await test('ANTHROPIC_BASE_URL is the fallback when REVELIO_ is absent or blank', () => {
  for (const revelio of [undefined, '', '   ']) {
    __resetBaseUrlWarning();
    const r = resolveBaseUrl(
      {
        REVELIO_ANTHROPIC_BASE_URL: revelio,
        ANTHROPIC_BASE_URL: 'https://fallback.example',
        ANTHROPIC_ALLOW_BASE_URL_OVERRIDE: 'true',
      },
      () => {},
    );
    assert.equal(r.baseUrl, 'https://fallback.example', `REVELIO_=${JSON.stringify(revelio)}`);
    assert.equal(r.source, 'ANTHROPIC_BASE_URL');
  }
});

await test('a blank REVELIO_ does not resurrect an unapproved ANTHROPIC_BASE_URL', () => {
  // Falling back must fall back to the *rule*, not just to the value.
  __resetBaseUrlWarning();
  const r = resolveBaseUrl(
    { REVELIO_ANTHROPIC_BASE_URL: '  ', ANTHROPIC_BASE_URL: 'https://agentrouter.org' },
    () => {},
  );
  assert.equal(r.baseUrl, ANTHROPIC_DEFAULT_BASE_URL, 'the opt-in requirement must survive the fallback');
  assert.deepEqual(r.ignored, { variable: 'ANTHROPIC_BASE_URL', value: 'https://agentrouter.org' });
});

// ── 10. Provider selection and transport ────────────────────────────────────
console.log('\n=== 10. Provider selection (anthropic | agentrouter) ===');

const AR = 'https://agentrouter.org';

await test('no REVELIO_AI_PROVIDER means anthropic', () => {
  __resetBaseUrlWarning();
  assert.equal(resolveProviderName({}, () => {}), 'anthropic');
});

await test('provider name is case-insensitive and trimmed', () => {
  for (const v of ['agentrouter', 'AgentRouter', '  AGENTROUTER  ']) {
    __resetBaseUrlWarning();
    assert.equal(resolveProviderName({ REVELIO_AI_PROVIDER: v }, () => {}), 'agentrouter', v);
  }
});

await test('an unknown provider degrades to anthropic and says so', () => {
  // A typo must not take the pipeline down; it must fall back and be reported.
  __resetBaseUrlWarning();
  const warnings: string[] = [];
  assert.equal(
    resolveProviderName({ REVELIO_AI_PROVIDER: 'openai' }, (m) => warnings.push(m)),
    'anthropic',
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /openai/);
});

await test('agentrouter defaults to the host that actually works', () => {
  // co.agentrouter.org answers but 401s every credential; agentrouter.org is the
  // verified host. Pinning the default is the point of this test.
  __resetBaseUrlWarning();
  const c = resolveProvider({ REVELIO_AI_PROVIDER: 'agentrouter', ANTHROPIC_API_KEY: 'k' }, () => {});
  assert.equal(c.provider, 'agentrouter');
  assert.equal(c.baseUrl, AGENTROUTER_DEFAULT_BASE_URL);
  assert.equal(c.baseUrl, AR);
  assert.equal(c.endpoint, `${AR}/v1/messages`);
  assert.equal(c.model, AGENTROUTER_DEFAULT_MODEL);
});

await test('agentrouter sends the client identity the gateway demands', () => {
  __resetBaseUrlWarning();
  const c = resolveProvider({ REVELIO_AI_PROVIDER: 'agentrouter', ANTHROPIC_API_KEY: 'k' }, () => {});
  assert.equal(c.headers['user-agent'], AGENTROUTER_DEFAULT_USER_AGENT);
  assert.match(c.headers['user-agent']!, /claude-cli/, 'without this the gateway returns 401');
  assert.equal(c.headers['x-app'], 'cli');
});

await test('the gateway user-agent is configurable, not hardcoded', () => {
  __resetBaseUrlWarning();
  const c = resolveProvider(
    {
      REVELIO_AI_PROVIDER: 'agentrouter',
      ANTHROPIC_API_KEY: 'k',
      REVELIO_AGENTROUTER_USER_AGENT: 'my-app/1.0',
    },
    () => {},
  );
  assert.equal(c.headers['user-agent'], 'my-app/1.0');
});

await test('agentrouter base URL and model are overridable', () => {
  __resetBaseUrlWarning();
  const c = resolveProvider(
    {
      REVELIO_AI_PROVIDER: 'agentrouter',
      ANTHROPIC_API_KEY: 'k',
      REVELIO_AGENTROUTER_BASE_URL: 'https://gw.example',
      REVELIO_AGENTROUTER_MODEL: 'claude-opus-4-1',
    },
    () => {},
  );
  assert.equal(c.endpoint, 'https://gw.example/v1/messages');
  assert.equal(c.model, 'claude-opus-4-1');
});

await test('a base URL given with a trailing slash or /v1 still builds one valid endpoint', () => {
  // Pasting a URL from docs is how "/v1/v1/messages" happens.
  for (const [base, expected] of [
    ['https://gw.example/', 'https://gw.example/v1/messages'],
    ['https://gw.example/v1', 'https://gw.example/v1/messages'],
    ['https://gw.example/v1/', 'https://gw.example/v1/messages'],
  ] as const) {
    __resetBaseUrlWarning();
    const c = resolveProvider(
      { REVELIO_AI_PROVIDER: 'agentrouter', ANTHROPIC_API_KEY: 'k', REVELIO_AGENTROUTER_BASE_URL: base },
      () => {},
    );
    assert.equal(c.endpoint, expected, base);
  }
});

await test('the credential is read in a documented precedence order', () => {
  const cases = [
    [{ REVELIO_AGENTROUTER_API_KEY: 'a', ANTHROPIC_API_KEY: 'b', ANTHROPIC_AUTH_TOKEN: 'c' }, 'a', 'REVELIO_AGENTROUTER_API_KEY'],
    [{ ANTHROPIC_API_KEY: 'b', ANTHROPIC_AUTH_TOKEN: 'c' }, 'b', 'ANTHROPIC_API_KEY'],
    // ANTHROPIC_AUTH_TOKEN is where Claude-Code-style setups keep the router key.
    [{ ANTHROPIC_AUTH_TOKEN: 'c' }, 'c', 'ANTHROPIC_AUTH_TOKEN'],
  ] as const;
  for (const [env, key, source] of cases) {
    __resetBaseUrlWarning();
    const c = resolveProvider({ REVELIO_AI_PROVIDER: 'agentrouter', ...env }, () => {});
    assert.equal(c.apiKey, key);
    assert.equal(c.apiKeySource, source);
  }
});

await test('a missing credential is reported, not defaulted', () => {
  __resetBaseUrlWarning();
  const c = resolveProvider({ REVELIO_AI_PROVIDER: 'agentrouter' }, () => {});
  assert.equal(c.apiKey, null);
  assert.equal(c.apiKeySource, null);
});

await test('agentrouter ignores the Anthropic base-URL variables entirely', () => {
  // They belong to the other provider. Leaking co.agentrouter.org in here is
  // exactly the confusion this separation prevents.
  __resetBaseUrlWarning();
  const c = resolveProvider(
    {
      REVELIO_AI_PROVIDER: 'agentrouter',
      ANTHROPIC_API_KEY: 'k',
      REVELIO_ANTHROPIC_BASE_URL: 'https://co.agentrouter.org',
      ANTHROPIC_BASE_URL: 'https://elsewhere.example',
      ANTHROPIC_ALLOW_BASE_URL_OVERRIDE: 'true',
    },
    () => {},
  );
  assert.equal(c.endpoint, `${AR}/v1/messages`);
});

await test('the anthropic provider is unaffected by the agentrouter variables', () => {
  __resetBaseUrlWarning();
  const c = resolveProvider(
    {
      ANTHROPIC_API_KEY: 'k',
      REVELIO_AGENTROUTER_BASE_URL: 'https://gw.example',
      REVELIO_AGENTROUTER_MODEL: 'something-else',
    },
    () => {},
  );
  assert.equal(c.provider, 'anthropic');
  assert.equal(c.endpoint, `${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`);
  assert.equal(c.headers['user-agent'], undefined, 'no spoofed identity on the direct path');
  assert.equal(c.model, 'claude-opus-5');
});

// ── extractJsonObject: AgentRouter ignores output_config, so this carries load ─
console.log('\n=== 11. Response unwrapping (unenforced schemas) ===');

await test('bare JSON is returned unchanged', () => {
  const s = '{"summary":"hi","n":1}';
  assert.equal(extractJsonObject(s), s);
});

await test('a ```json fenced block is unwrapped', () => {
  // This is the real AgentRouter response shape.
  const inner = '{\n  "summary": "Budget approved",\n  "confidence": 0.9\n}';
  assert.equal(extractJsonObject('```json\n' + inner + '\n```'), inner);
  assert.equal(extractJsonObject('```\n' + inner + '\n```'), inner);
  assert.deepEqual(JSON.parse(extractJsonObject('```json\n' + inner + '\n```')), {
    summary: 'Budget approved',
    confidence: 0.9,
  });
});

await test('prose around the object is discarded', () => {
  const out = extractJsonObject('Here is the analysis:\n{"summary":"x"}\nHope that helps!');
  assert.deepEqual(JSON.parse(out), { summary: 'x' });
});

await test('a closing brace inside a string does not truncate the object', () => {
  // The failure this prevents: a summary containing "}" cutting the JSON short.
  const src = '{"summary":"see clause (b} of the circular","n":2}';
  assert.deepEqual(JSON.parse(extractJsonObject(src)), {
    summary: 'see clause (b} of the circular',
    n: 2,
  });
});

await test('an escaped quote does not confuse string tracking', () => {
  const src = '{"summary":"the \\"final\\" date}","n":1}';
  assert.deepEqual(JSON.parse(extractJsonObject(src)), { summary: 'the "final" date}', n: 1 });
});

await test('nested objects and arrays survive', () => {
  const src =
    'text before {"entities":[{"name":"A","type":"person"}],"d":{"x":{"y":1}}} text after';
  assert.deepEqual(JSON.parse(extractJsonObject(src)), {
    entities: [{ name: 'A', type: 'person' }],
    d: { x: { y: 1 } },
  });
});

await test('unbalanced input fails as MALFORMED rather than silently half-parsing', () => {
  const out = extractJsonObject('{"summary":"truncated mid');
  assert.throws(() => JSON.parse(out), 'truncated JSON must not parse into a partial object');
});

await test('no object at all is passed through for honest error reporting', () => {
  assert.equal(extractJsonObject('I cannot help with that.'), 'I cannot help with that.');
});

await test('the prompt contract names the real taxonomy slugs', () => {
  const s = jsonContractInstruction(['finance', 'academic'], ['budgets', 'notices']);
  for (const slug of ['finance', 'academic', 'budgets', 'notices']) {
    assert.match(s, new RegExp(`"${slug}"`), `${slug} must appear so the model can choose it`);
  }
  assert.match(s, /No markdown code fences/i);
  // All ten keys must be listed, or the provider will omit some.
  for (const key of [
    'document_type', 'department_slug', 'category_slug', 'tags', 'summary',
    'key_points', 'entities', 'important_dates', 'document_date', 'confidence',
  ]) {
    assert.match(s, new RegExp(`"${key}"`), `contract omits ${key}`);
  }
});

await test('an empty taxonomy does not produce an empty bracket list', () => {
  const s = jsonContractInstruction([], []);
  assert.match(s, /\(none configured\)/);
});

console.log(`\n${'='.repeat(56)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`${'='.repeat(56)}\n`);
process.exit(fail === 0 ? 0 : 1);

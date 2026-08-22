import type { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from '@/lib/constants';
import { classify } from '@/lib/classify';
import type { Category } from '@/lib/types';
import {
  capText,
  extractPdfText,
  pageNeedsOcr,
  renderPdfPageToPng,
  type PageText,
} from './extract';
import { MAX_OCR_PAGES, MIN_OCR_CONFIDENCE, ocrImage, ocrImages } from './ocr';
import { chunkPages } from './chunk';
import { analyseDocument } from './analyze';

export type Stage = 'uploaded' | 'extracting' | 'analyzing' | 'indexing' | 'ready' | 'failed';
export type ExtractionMethod = 'text' | 'ocr' | 'mixed';

export interface ProcessOutcome {
  ok: boolean;
  stage: Stage;
  method: ExtractionMethod | null;
  pageCount: number;
  charCount: number;
  chunks: number;
  aiApplied: boolean;
  aiSkippedReason?: string;
  error?: string;
}

/** Errors we surface with a stable code, so the UI can be specific. */
const CODES = {
  UNSUPPORTED: 'UNSUPPORTED_FILE_TYPE',
  DOWNLOAD: 'DOWNLOAD_FAILED',
  INVALID_PDF: 'INVALID_PDF',
  NO_TEXT: 'NO_TEXT_EXTRACTED',
  OCR: 'OCR_FAILED',
} as const;

/**
 * Runs the full pipeline for one version, persisting through SECURITY DEFINER
 * RPCs so no service-role key is required and authorization is re-checked in
 * the database on every write.
 *
 * Contract: the uploaded document is NEVER destroyed by a processing failure.
 * Every failure path marks the version `failed` with a reason and returns; the
 * file and the document row stay intact and the run can be retried.
 */
export async function processVersion(
  supabase: SupabaseClient,
  version: {
    id: string;
    document_id: string;
    storage_path: string;
    mime_type: string;
    original_filename: string;
  },
  documentTitle: string,
): Promise<ProcessOutcome> {
  const setStage = async (
    status: 'processing' | 'completed' | 'failed',
    stage: Stage,
    extra: Record<string, unknown> = {},
  ) => {
    const { error } = await supabase.rpc('set_version_processing', {
      p_version_id: version.id,
      p_status: status,
      p_stage: stage,
      p_error: null,
      p_method: null,
      p_text: null,
      p_page_count: null,
      p_char_count: null,
      ...extra,
    });
    if (error) console.error(`[process] set_version_processing(${stage}) failed:`, error.message);
  };

  const failWith = async (code: string, detail?: string): Promise<ProcessOutcome> => {
    const message = detail ? `${code}: ${detail}` : code;
    console.error(`[process] version=${version.id} ${message}`);
    await supabase.rpc('set_version_processing', {
      p_version_id: version.id,
      p_status: 'failed',
      p_stage: 'failed',
      p_error: message,
      p_method: null,
      p_text: null,
      p_page_count: null,
      p_char_count: null,
    });
    return {
      ok: false,
      stage: 'failed',
      method: null,
      pageCount: 0,
      charCount: 0,
      chunks: 0,
      aiApplied: false,
      error: message,
    };
  };

  const isPdf = version.mime_type === 'application/pdf';
  const isImage = version.mime_type.startsWith('image/');
  if (!isPdf && !isImage) {
    return failWith(CODES.UNSUPPORTED, version.mime_type);
  }

  await setStage('processing', 'extracting');

  // ── download ──────────────────────────────────────────────────────────────
  const { data: blob, error: dlError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(version.storage_path);

  if (dlError || !blob) {
    return failWith(CODES.DOWNLOAD, dlError?.message ?? 'no data');
  }

  // pdf.js TRANSFERS (detaches) the ArrayBuffer it is handed. Reusing one array
  // across extraction and rasterisation silently killed all PDF OCR: after
  // extractPdfText() the buffer had byteLength 0, so every subsequent page
  // render threw "detached ArrayBuffer". Keep one pristine copy and hand out a
  // fresh view per call.
  const fileBytes = Buffer.from(await blob.arrayBuffer());
  const freshBytes = () => new Uint8Array(fileBytes);

  // ── extraction (+ OCR fallback) ───────────────────────────────────────────
  let pages: PageText[] = [];
  let pageCount = 0;
  let method: ExtractionMethod = 'text';

  if (isPdf) {
    let direct;
    try {
      direct = await extractPdfText(freshBytes());
    } catch (error) {
      // Encrypted or corrupt: distinguish so the user gets a useful message.
      const detail = error instanceof Error ? error.message : String(error);
      return failWith(
        /password|encrypt/i.test(detail) ? 'PASSWORD_PROTECTED_PDF' : CODES.INVALID_PDF,
        detail,
      );
    }

    pages = direct.pages;
    pageCount = direct.pageCount;

    const needOcr = pages.filter(pageNeedsOcr);
    const hadText = pages.some((p) => !pageNeedsOcr(p));

    if (needOcr.length > 0) {
      // OCR is the fallback, not the default: only the thin pages are rendered.
      const targets = needOcr.slice(0, MAX_OCR_PAGES);
      try {
        const images: Buffer[] = [];
        for (const p of targets) {
          images.push(await renderPdfPageToPng(freshBytes(), p.page));
        }
        const results = await ocrImages(images);

        let applied = 0;
        results.forEach((res, i) => {
          const target = targets[i];
          if (!target) return;
          // Reject low-confidence noise rather than polluting the index.
          if (res.confidence >= MIN_OCR_CONFIDENCE && res.text.length > target.text.length) {
            const idx = pages.findIndex((p) => p.page === target.page);
            if (idx >= 0) {
              pages[idx] = { page: target.page, text: res.text };
              applied++;
            }
          }
        });

        if (applied > 0) method = hadText ? 'mixed' : 'ocr';
      } catch (error) {
        // OCR failure must not lose a usable text layer.
        const detail = error instanceof Error ? error.message : String(error);
        if (!hadText) return failWith(CODES.OCR, detail);
        console.error(`[process] OCR failed but text layer usable: ${detail}`);
      }
    }
  } else {
    // Images have no text layer, so OCR is the only path.
    try {
      const res = await ocrImage(fileBytes);
      pages = [{ page: 1, text: res.text }];
      pageCount = 1;
      method = 'ocr';
      if (res.confidence < MIN_OCR_CONFIDENCE && res.text.trim().length === 0) {
        return failWith(CODES.NO_TEXT, `ocr confidence ${Math.round(res.confidence)}`);
      }
    } catch (error) {
      return failWith(CODES.OCR, error instanceof Error ? error.message : String(error));
    }
  }

  const fullText = capText(pages.map((p) => p.text).join('\n\n').trim());
  const charCount = fullText.length;

  // No text is not a failure: the document is still stored, versioned and
  // findable by title and metadata. It is recorded as completed-with-no-text.
  await supabase.rpc('set_version_processing', {
    p_version_id: version.id,
    p_status: 'processing',
    p_stage: 'analyzing',
    p_error: null,
    p_method: method,
    p_text: fullText,
    p_page_count: pageCount,
    p_char_count: charCount,
  });

  // ── taxonomy ──────────────────────────────────────────────────────────────
  const [{ data: categories }, { data: departments }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, department_id, name, slug, description, match_keywords, is_active, sort_order')
      .eq('is_active', true),
    supabase.from('departments').select('id, name, slug, sort_order'),
  ]);

  const catList = (categories ?? []) as Category[];
  const deptList = (departments ?? []) as { id: string; name: string; slug: string }[];

  // ── AI analysis ───────────────────────────────────────────────────────────
  let aiApplied = false;
  let aiSkippedReason: string | undefined;

  const ai = await analyseDocument({
    text: fullText,
    title: documentTitle,
    filename: version.original_filename,
    departments: deptList,
    categories: catList.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      department_slug: deptList.find((d) => d.id === c.department_id)?.slug ?? '',
    })),
  });

  if (ai.ok && ai.analysis) {
    const a = ai.analysis;

    const { error: insightErr } = await supabase.rpc('save_document_insights', {
      p_version_id: version.id,
      p_summary: a.summary,
      p_key_points: a.key_points,
      p_entities: a.entities,
      p_important_dates: a.important_dates,
      p_model: ai.model,
    });
    if (insightErr) console.error('[process] save_document_insights:', insightErr.message);
    else aiApplied = true;

    // AI-chosen folder, resolved against the real taxonomy by slug. The schema
    // already constrains the slug to the seeded set, and this second check
    // means a hallucinated name would still resolve to nothing.
    const aiCat = a.category_slug
      ? catList.find(
          (c) =>
            c.slug === a.category_slug &&
            (!a.department_slug ||
              deptList.find((d) => d.id === c.department_id)?.slug === a.department_slug),
        )
      : undefined;

    const { error: metaErr } = await supabase.rpc('apply_ai_metadata', {
      p_document_id: version.document_id,
      p_document_type: a.document_type,
      p_category_id: aiCat?.id ?? null,
      p_department_id: aiCat?.department_id ?? null,
      p_confidence: aiCat ? a.confidence : null,
      p_tags: a.tags.length ? a.tags : null,
      p_document_date: a.document_date,
      p_matched_terms: a.category_slug ? [a.category_slug] : [],
      p_source: 'ai',
    });
    if (metaErr) console.error('[process] apply_ai_metadata:', metaErr.message);
  } else {
    aiSkippedReason = ai.reason ?? 'UNKNOWN';
    console.error(`[process] AI skipped (${aiSkippedReason}): ${ai.detail ?? ''}`);

    // Deterministic content-based classification still runs. This is the
    // upgrade over the old title/filename-only pass, and it is honest: it is
    // keyword matching, recorded as such, not presented as AI output. It is
    // also the whole fallback story when Claude is unavailable, refuses, or
    // returns something malformed.
    if (fullText.length > 0) {
      const result = classify(catList, {
        title: documentTitle,
        filename: version.original_filename,
        text: fullText,
      });
      // Do not fabricate a classification when the evidence is weak.
      if (result.categoryId && result.confidence >= 0.35) {
        const { error } = await supabase.rpc('apply_ai_metadata', {
          p_document_id: version.document_id,
          p_document_type: null,
          p_category_id: result.categoryId,
          p_department_id: result.departmentId,
          p_confidence: result.confidence,
          p_tags: null,
          p_document_date: null,
          p_matched_terms: result.matchedTerms,
          // Deterministic keyword matching, NOT model output. Labelling this
          // 'ai' would attribute the filing to a model that was never called.
          p_source: 'system',
        });
        if (error) console.error('[process] keyword classification:', error.message);
      }
    }
  }

  // ── chunks + search ───────────────────────────────────────────────────────
  await setStage('processing', 'indexing');

  let chunkCount = 0;
  const chunks = chunkPages(pages);
  if (chunks.length > 0) {
    const { data, error } = await supabase.rpc('save_document_chunks', {
      p_version_id: version.id,
      p_chunks: chunks,
    });
    if (error) console.error('[process] save_document_chunks:', error.message);
    else chunkCount = typeof data === 'number' ? data : chunks.length;
  }

  // set_version_processing refreshes the document search vector.
  await supabase.rpc('set_version_processing', {
    p_version_id: version.id,
    p_status: 'completed',
    p_stage: 'ready',
    p_error: null,
    p_method: method,
    p_text: null,
    p_page_count: pageCount,
    p_char_count: charCount,
  });

  return {
    ok: true,
    stage: 'ready',
    method,
    pageCount,
    charCount,
    chunks: chunkCount,
    aiApplied,
    aiSkippedReason,
  };
}

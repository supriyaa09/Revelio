import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { processVersion } from '@/lib/processing/pipeline';

// Native modules (canvas, tesseract wasm) require the Node runtime.
export const runtime = 'nodejs';
// OCR on a multi-page scan is slow; the platform cap still applies in
// production, which is documented as a known limitation.
export const maxDuration = 300;

/**
 * POST /api/documents/:id/process
 *
 * Runs extraction, OCR fallback, AI analysis, classification and chunking for
 * the document's current version.
 *
 * Executes as the signed-in user: RLS decides whether the document is visible,
 * and the persistence RPCs re-check that the caller owns it or is the HOD.
 * Idempotent — re-running replaces insights and chunks for that version.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await requireSession();
  const supabase = await createClient();

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, title, current_version_id')
    .eq('id', id)
    .maybeSingle();

  if (docError) {
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: docError.message } },
      { status: 500 },
    );
  }
  // RLS makes an invisible document indistinguishable from a missing one.
  if (!doc) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Document not available.' } },
      { status: 404 },
    );
  }
  if (!doc.current_version_id) {
    return NextResponse.json(
      { error: { code: 'NO_VERSION', message: 'This document has no uploaded file yet.' } },
      { status: 422 },
    );
  }

  const { data: version, error: verError } = await supabase
    .from('document_versions')
    .select('id, document_id, storage_path, mime_type, original_filename')
    .eq('id', doc.current_version_id)
    .maybeSingle();

  if (verError || !version) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: verError?.message ?? 'Version not found.',
        },
      },
      { status: 404 },
    );
  }

  try {
    const outcome = await processVersion(supabase, version, doc.title);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (error) {
    // Unexpected failure: the pipeline already marks the version failed on every
    // path it controls, so this is the last-resort net. The document and its
    // stored file are untouched either way.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[process] unhandled failure for document ${id}:`, message);
    return NextResponse.json(
      { error: { code: 'PROCESSING_FAILED', message } },
      { status: 500 },
    );
  }
}

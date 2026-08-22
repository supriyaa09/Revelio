'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { classify, deriveTitle, safeFilename } from '@/lib/classify';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, STORAGE_BUCKET } from '@/lib/constants';
import { fail, mapDbError, succeed, type ActionResult } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import type { Category, WorkflowState } from '@/lib/types';

/**
 * Upload → storage → document record → automatic organization.
 *
 * Order matters: the document row is created first so its id can form the
 * storage prefix, which is what the storage RLS policy checks. If the file
 * upload then fails we delete the empty draft rather than leaving a ghost.
 */
export async function uploadDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { userId } = await requireSession();
  const supabase = await createClient();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return fail('VALIDATION_ERROR', 'Choose a file to upload.');
  }

  // Server-side validation. The bucket and database enforce these too, but
  // failing here gives the user a usable message instead of a storage error.
  if (file.size > MAX_FILE_BYTES) {
    return fail('FILE_TOO_LARGE', 'Files must be 25 MB or smaller.');
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return fail('UNSUPPORTED_FILE_TYPE', 'Only PDF, PNG and JPEG files are accepted.');
  }

  const rawTitle = String(formData.get('title') ?? '').trim();
  const title = rawTitle || deriveTitle(file.name);
  const description = String(formData.get('description') ?? '').trim() || null;
  const chosenCategoryId = String(formData.get('category_id') ?? '').trim() || null;

  // Load the taxonomy so we can auto-file the document.
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('id, department_id, name, slug, description, match_keywords, is_active, sort_order')
    .eq('is_active', true);

  if (catError) {
    const mapped = mapDbError(catError);
    return fail(mapped.code, mapped.message);
  }

  // A user-picked category always wins over the classifier.
  let categoryId: string | null = null;
  let departmentId: string | null = null;
  let categorySource: 'user' | 'system' = 'system';
  let confidence: number | null = null;
  let matchedTerms: string[] = [];

  const list = (categories ?? []) as Category[];

  if (chosenCategoryId) {
    const picked = list.find((c) => c.id === chosenCategoryId);
    if (!picked) return fail('VALIDATION_ERROR', 'That category does not exist.');
    categoryId = picked.id;
    departmentId = picked.department_id;
    categorySource = 'user';
  } else {
    const result = classify(list, { title, filename: file.name });
    categoryId = result.categoryId;
    departmentId = result.departmentId;
    confidence = result.confidence;
    matchedTerms = result.matchedTerms;
  }

  // 1. Document row (draft, owned by the caller — both enforced by RLS).
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      title,
      description,
      owner_id: userId,
      category_id: categoryId,
      department_id: departmentId,
      category_source: categorySource,
      category_confidence: confidence,
      workflow_status: 'draft' satisfies WorkflowState,
      system_metadata: {
        classification: {
          method: categorySource === 'user' ? 'user_selected' : 'keyword',
          matched_terms: matchedTerms,
          // Honest marker: no text extraction has run at this point.
          basis: 'title_and_filename',
        },
      },
    })
    .select('id')
    .single();

  if (docError || !doc) {
    const mapped = mapDbError(docError);
    return fail(mapped.code, mapped.message);
  }

  // 2. Upload to the private bucket under the document's own prefix.
  const objectKey = `${doc.id}/v1/${safeFilename(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectKey, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    // Roll back the draft so a failed upload leaves nothing behind.
    await supabase.from('documents').delete().eq('id', doc.id);
    return fail('UPLOAD_FAILED', `The file could not be stored: ${uploadError.message}`);
  }

  // 3. Version record. The RPC assigns the version number server-side and
  //    advances current_version_id only after the row commits.
  const { error: versionError } = await supabase.rpc('create_document_version', {
    p_document_id: doc.id,
    p_storage_path: objectKey,
    p_original_filename: file.name,
    p_mime_type: file.type,
    p_file_size: file.size,
    p_change_note: null,
  });

  if (versionError) {
    await supabase.storage.from(STORAGE_BUCKET).remove([objectKey]);
    await supabase.from('documents').delete().eq('id', doc.id);
    const mapped = mapDbError(versionError);
    return fail(mapped.code, mapped.message);
  }

  // 4. Audit the upload and the automatic filing decision.
  await supabase.rpc('log_audit_event', {
    p_document_id: doc.id,
    p_action: 'document_uploaded',
    p_metadata: {
      filename: file.name,
      size: file.size,
      mime_type: file.type,
      category_source: categorySource,
      matched_terms: matchedTerms,
    },
  });

  revalidatePath('/workspace');
  return succeed({ id: doc.id });
}

/** Adds a revision to an existing document. */
export async function uploadNewVersion(formData: FormData): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  const supabase = await createClient();

  const documentId = String(formData.get('document_id') ?? '');
  const changeNote = String(formData.get('change_note') ?? '').trim() || null;
  const file = formData.get('file');

  if (!documentId) return fail('VALIDATION_ERROR', 'Missing document.');
  if (!(file instanceof File) || file.size === 0) {
    return fail('VALIDATION_ERROR', 'Choose a file to upload.');
  }
  if (file.size > MAX_FILE_BYTES) return fail('FILE_TOO_LARGE', 'Files must be 25 MB or smaller.');
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return fail('UNSUPPORTED_FILE_TYPE', 'Only PDF, PNG and JPEG files are accepted.');
  }

  // Next version number is derived server-side; we only need it for the path.
  const { data: latest } = await supabase
    .from('document_versions')
    .select('version_number')
    .eq('document_id', documentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNumber = (latest?.version_number ?? 0) + 1;
  const objectKey = `${documentId}/v${nextNumber}/${safeFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectKey, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return fail('UPLOAD_FAILED', `The file could not be stored: ${uploadError.message}`);
  }

  const { error: versionError } = await supabase.rpc('create_document_version', {
    p_document_id: documentId,
    p_storage_path: objectKey,
    p_original_filename: file.name,
    p_mime_type: file.type,
    p_file_size: file.size,
    p_change_note: changeNote,
  });

  if (versionError) {
    await supabase.storage.from(STORAGE_BUCKET).remove([objectKey]);
    const mapped = mapDbError(versionError);
    return fail(mapped.code, mapped.message);
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath('/workspace');
  return succeed({ id: documentId });
}

/** Moves a document through the workflow. All rules live in the database. */
export async function transitionDocument(
  documentId: string,
  toState: WorkflowState,
  comment?: string,
): Promise<ActionResult<{ status: WorkflowState }>> {
  await requireSession();
  const supabase = await createClient();

  const { error } = await supabase.rpc('transition_document', {
    p_document_id: documentId,
    p_to_state: toState,
    p_comment: comment?.trim() || null,
  });

  if (error) {
    const mapped = mapDbError(error);
    return fail(mapped.code, mapped.message);
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath('/workspace');
  revalidatePath('/review');
  return succeed({ status: toState });
}

/** Adds a comment to a document the caller can see. */
export async function addComment(
  documentId: string,
  body: string,
): Promise<ActionResult<{ id: string }>> {
  const { userId } = await requireSession();
  const supabase = await createClient();

  const trimmed = body.trim();
  if (!trimmed) return fail('VALIDATION_ERROR', 'Comment cannot be empty.');
  if (trimmed.length > 4000) return fail('VALIDATION_ERROR', 'Comment is too long.');

  const { data, error } = await supabase
    .from('document_comments')
    .insert({ document_id: documentId, author_id: userId, body: trimmed })
    .select('id')
    .single();

  if (error || !data) {
    const mapped = mapDbError(error);
    return fail(mapped.code, mapped.message);
  }

  revalidatePath(`/documents/${documentId}`);
  return succeed({ id: data.id });
}

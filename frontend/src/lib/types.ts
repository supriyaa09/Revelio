export type AppRole = 'student' | 'faculty' | 'hod';

/**
 * Two distinct review states, not one. The tier holding the document has to be
 * part of the state, otherwise nothing can restrict HOD-tier approval to the
 * HOD or distinguish an escalated document from a normal one.
 */
export type WorkflowState =
  | 'draft'
  | 'submitted'
  | 'faculty_review'
  | 'hod_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested';

export type ProcessingState = 'pending' | 'processing' | 'completed' | 'failed';

export type MetadataSource = 'ai' | 'user' | 'system';

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  department_id: string | null;
}

export interface Department {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
}

export interface Category {
  id: string;
  department_id: string;
  name: string;
  slug: string;
  description: string | null;
  match_keywords: string[];
  is_active: boolean;
  sort_order: number;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string;
  change_note: string | null;
  processing_status: ProcessingState;
  processing_error: string | null;
  extraction_method: 'text' | 'ocr' | 'mixed' | null;
  page_count: number | null;
  char_count: number;
  created_at: string;
  processed_at: string | null;
}

export interface DocumentRecord {
  id: string;
  title: string;
  description: string | null;
  owner_id: string;
  department_id: string | null;
  category_id: string | null;
  category_source: MetadataSource;
  category_confidence: number | null;
  workflow_status: WorkflowState;
  current_version_id: string | null;
  document_type: string | null;
  document_date: string | null;
  tags: string[];
  user_metadata: Record<string, unknown>;
  system_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Shape returned by the workspace list query, with joins flattened. */
export interface DocumentListItem extends DocumentRecord {
  category: Pick<Category, 'id' | 'name' | 'slug'> | null;
  department: Pick<Department, 'id' | 'name' | 'slug'> | null;
  owner: Pick<Profile, 'id' | 'full_name'> | null;
  current_version: Pick<
    DocumentVersion,
    'id' | 'version_number' | 'processing_status' | 'original_filename' | 'file_size' | 'mime_type'
  > | null;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  document_id: string | null;
  action: string;
  from_state: WorkflowState | null;
  to_state: WorkflowState | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface ReviewEntry {
  id: string;
  document_id: string;
  reviewer_id: string;
  action:
    | 'review_started'
    | 'routed_to_hod'
    | 'approved'
    | 'rejected'
    | 'changes_requested'
    | 'commented';
  from_state: WorkflowState | null;
  to_state: WorkflowState | null;
  comment: string | null;
  created_at: string;
  reviewer: Pick<Profile, 'id' | 'full_name'> | null;
}

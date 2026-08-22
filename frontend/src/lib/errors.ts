/** Single error envelope, matching docs/api.md. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: string };
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function fail(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

export function succeed<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/**
 * Maps a Postgres/PostgREST error onto our error envelope.
 * Our SECURITY DEFINER functions raise messages prefixed with a stable code
 * (e.g. `FORBIDDEN: ...`), so we surface that code rather than a raw SQL string.
 */
export function mapDbError(error: { message?: string; code?: string } | null): {
  code: string;
  message: string;
} {
  const raw = error?.message ?? 'Unexpected database error';

  const known = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'INVALID_WORKFLOW_TRANSITION',
    'UNSUPPORTED_FILE_TYPE',
    'FILE_TOO_LARGE',
    'NO_VERSION',
  ];

  for (const code of known) {
    if (raw.includes(code)) {
      return { code, message: humanize(code, raw) };
    }
  }

  if (error?.code === '23505' || raw.includes('duplicate key')) {
    return { code: 'CONFLICT', message: 'That record already exists.' };
  }
  if (raw.includes('Illegal workflow transition')) {
    return { code: 'INVALID_WORKFLOW_TRANSITION', message: 'That status change is not allowed.' };
  }
  if (raw.includes('row-level security')) {
    return { code: 'FORBIDDEN', message: 'You do not have permission to do that.' };
  }

  // Never leak raw SQL or stack detail to the client.
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };
}

function humanize(code: string, raw: string): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Please sign in again.';
    case 'FORBIDDEN':
      // Our functions append a human-safe reason after the colon.
      return raw.split('FORBIDDEN:')[1]?.trim() || 'You do not have permission to do that.';
    case 'NOT_FOUND':
      return 'That document could not be found.';
    case 'INVALID_WORKFLOW_TRANSITION':
      return 'That status change is not allowed from the current state.';
    case 'UNSUPPORTED_FILE_TYPE':
      return 'Only PDF, PNG and JPEG files are accepted.';
    case 'FILE_TOO_LARGE':
      return 'Files must be 25 MB or smaller.';
    case 'NO_VERSION':
      return 'Upload a file before submitting this document for review.';
    default:
      return 'Something went wrong.';
  }
}

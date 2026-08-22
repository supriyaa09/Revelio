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

/** Shape of a PostgREST / Postgres error as surfaced by supabase-js. */
export interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Maps a Postgres/PostgREST error onto our error envelope.
 *
 * Our SECURITY DEFINER functions raise messages prefixed with a stable code
 * (e.g. `FORBIDDEN: ...`), so we surface that code where we recognise it.
 *
 * Everything else keeps the real SQLSTATE and message. An earlier version
 * collapsed all unrecognised errors to "Something went wrong. Please try
 * again.", which hid a `42703 record "new" has no field "document_id"` raised
 * by a broken trigger and made a one-line bug effectively undebuggable from the
 * UI. Postgres messages here describe our own schema, so they are safe to show;
 * `details` and `hint` stay server-side.
 */
export function mapDbError(error: DbErrorLike | null): { code: string; message: string } {
  const raw = error?.message ?? 'Unexpected database error';
  const sqlstate = error?.code ?? '';

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

  // Recognisable SQLSTATEs get a useful message *and* keep the detail.
  switch (sqlstate) {
    case '23505':
      return { code: 'CONFLICT', message: `That record already exists. (${raw})` };
    case '23502':
      return { code: 'NOT_NULL_VIOLATION', message: `A required field was empty. (${raw})` };
    case '23503':
      return {
        code: 'FOREIGN_KEY_VIOLATION',
        message: `A referenced record does not exist. (${raw})`,
      };
    case '23514':
      return { code: 'CHECK_VIOLATION', message: `A value failed validation. (${raw})` };
    case '42703':
      return { code: 'UNDEFINED_COLUMN', message: `Schema error: ${raw}` };
    case '42883':
      return { code: 'UNDEFINED_FUNCTION', message: `Missing database function: ${raw}` };
    case '42501':
      return { code: 'FORBIDDEN', message: `Permission denied: ${raw}` };
    case '42P01':
      return { code: 'UNDEFINED_TABLE', message: `Missing table: ${raw}` };
    case 'PGRST202':
      return { code: 'UNDEFINED_FUNCTION', message: `RPC not found: ${raw}` };
    case 'PGRST205':
      return { code: 'UNDEFINED_TABLE', message: `Table not found: ${raw}` };
    default:
      break;
  }

  if (raw.includes('duplicate key')) {
    return { code: 'CONFLICT', message: `That record already exists. (${raw})` };
  }
  if (raw.includes('Illegal workflow transition')) {
    return { code: 'INVALID_WORKFLOW_TRANSITION', message: 'That status change is not allowed.' };
  }
  if (raw.includes('row-level security')) {
    return {
      code: 'FORBIDDEN',
      message: `You do not have permission to do that. (${raw})`,
    };
  }

  // Last resort: still name the SQLSTATE and the real message.
  return {
    code: 'DATABASE_ERROR',
    message: sqlstate ? `Database error ${sqlstate}: ${raw}` : `Database error: ${raw}`,
  };
}

/**
 * Logs the full error server-side (including details/hint, which we never send
 * to the browser) and returns the mapped envelope.
 */
export function logAndMap(step: string, error: DbErrorLike | null): { code: string; message: string } {
  const mapped = mapDbError(error);
  console.error(
    `[uploadDocument] step="${step}" code=${mapped.code} sqlstate=${error?.code ?? 'n/a'} ` +
      `message=${JSON.stringify(error?.message ?? null)} ` +
      `details=${JSON.stringify(error?.details ?? null)} hint=${JSON.stringify(error?.hint ?? null)}`,
  );
  return mapped;
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

import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import type { Profile } from './types';

export interface SessionContext {
  userId: string;
  email: string;
  profile: Profile;
}

const PROFILE_COLUMNS = 'id, full_name, role, department_id';

/**
 * Resolves the signed-in user and their application profile.
 * Redirects to /login when unauthenticated, so callers can assume a session.
 *
 * A profile is normally created by the `on_auth_user_created` trigger. That
 * trigger is AFTER INSERT, so accounts that predate it have no profile row —
 * which used to throw here and lock the account out until someone inserted the
 * row by hand. We now recover by calling ensure_profile(), which creates the
 * missing row as `student` from the caller's own auth record.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (profile) {
    return { userId: user.id, email: user.email ?? '', profile: profile as Profile };
  }

  // Never swallow this error. An earlier version discarded it and fell straight
  // through to ensure_profile(), which is SECURITY DEFINER and so bypasses table
  // grants — meaning a missing GRANT on `profiles` looked like a working app
  // while every other table failed. Log it loudly and distinguish the causes.
  if (profileError) {
    console.error(
      `[requireSession] profiles select failed: sqlstate=${profileError.code ?? 'n/a'} ` +
        `message=${JSON.stringify(profileError.message)} hint=${JSON.stringify(profileError.hint ?? null)}`,
    );

    // 42501 is a table-privilege failure, not a missing row. ensure_profile()
    // would mask it, so fail with an actionable message instead.
    if (profileError.code === '42501') {
      throw new Error(
        `permission denied on public.profiles for the authenticated role. ` +
          `This is a GRANT problem, not RLS. Apply supabase/migrations/0006_table_grants.sql.`,
      );
    }
  }

  // No row: recover. ensure_profile() is scoped to auth.uid() and always
  // assigns the student role, so it cannot elevate or touch another account.
  const { data: healed, error: healError } = await supabase.rpc('ensure_profile');

  if (healError || !healed) {
    throw new Error(
      `No profile for user ${user.id} and ensure_profile() failed` +
        `${healError ? `: ${healError.message}` : ''}. ` +
        `Apply supabase/migrations/0004_profile_backfill.sql.`,
    );
  }

  const row = (Array.isArray(healed) ? healed[0] : healed) as Profile | undefined;
  if (!row) {
    throw new Error(`ensure_profile() returned no row for user ${user.id}.`);
  }

  return { userId: user.id, email: user.email ?? '', profile: row };
}

/** Returns the session, or null instead of redirecting. */
export async function getOptionalSession(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  return { userId: user.id, email: user.email ?? '', profile: profile as Profile };
}

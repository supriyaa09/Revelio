import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import type { Profile } from './types';

export interface SessionContext {
  userId: string;
  email: string;
  profile: Profile;
}

/**
 * Resolves the signed-in user and their application profile.
 * Redirects to /login when unauthenticated, so callers can assume a session.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, department_id')
    .eq('id', user.id)
    .single();

  // The profile is created by an auth trigger. If it is genuinely missing the
  // account is unusable, so fail loudly rather than inventing a default role.
  if (error || !profile) {
    throw new Error(
      `No profile found for user ${user.id}. The handle_new_user trigger may not have run — verify migration 0001 applied.`,
    );
  }

  return { userId: user.id, email: user.email ?? '', profile: profile as Profile };
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
    .select('id, full_name, role, department_id')
    .eq('id', user.id)
    .single();

  if (!profile) return null;
  return { userId: user.id, email: user.email ?? '', profile: profile as Profile };
}

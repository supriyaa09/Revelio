import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from '@/lib/env';

/**
 * Server client scoped to the signed-in user's cookies.
 * Every query made through this client is subject to RLS — this is the default
 * path for all application data access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render pass, where cookies are
          // read-only. Session refresh is handled by middleware instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so it is restricted to trusted background
 * work (the processing pipeline) and must never be constructed in response to
 * unvalidated user input.
 */
export function createServiceClient() {
  return createServerClient(supabaseUrl(), supabaseServiceRoleKey(), {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server client scoped to the signed-in user's cookies.
 * Every query made through this client is subject to RLS — this is the default
 * path for all application data access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    },
  );
}

/**
 * Service-role client. Bypasses RLS, so it is restricted to trusted background
 * work (processing pipeline writes) and must never be constructed in response
 * to unvalidated user input.
 *
 * Throws rather than silently falling back, so a missing key is loud.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Required for server-side document processing.',
    );
  }
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

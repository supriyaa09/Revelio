import { createBrowserClient } from '@supabase/ssr';

/** Browser client. Only ever receives the anon key — never the service role. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

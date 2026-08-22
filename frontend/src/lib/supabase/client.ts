import { createBrowserClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

/** Browser client. Only ever receives the anon key — never the service role. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}

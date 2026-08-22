/**
 * Fails fast with an actionable message when Supabase credentials are absent.
 * Without this, the first symptom is an opaque 500 from inside the Supabase
 * client, which sends people hunting through middleware instead of their .env.
 */
function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing environment variable ${name}.\n\n` +
        `Create frontend/.env.local from frontend/.env.example and set:\n` +
        `  NEXT_PUBLIC_SUPABASE_URL\n` +
        `  NEXT_PUBLIC_SUPABASE_ANON_KEY\n\n` +
        `Get these from your Supabase project: Settings → API.\n` +
        `For a local stack, run "npx supabase start" (requires Docker) and use the printed values.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

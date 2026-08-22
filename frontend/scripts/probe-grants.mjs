/**
 * Live grant/RLS discriminator.
 *
 * 42501 "permission denied for table X"  -> missing table-level GRANT.
 *                                           RLS is never even consulted.
 * empty result set                       -> grant present, RLS filtered rows.
 * "violates row-level security policy"   -> grant present, RLS rejected a write.
 *
 * Prints the full raw error object so nothing is guessed. Anon key only.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log(`host: ${new URL(URL_).host}`);
console.log(`service-role key in .env.local: ${env.SUPABASE_SERVICE_ROLE_KEY ? 'yes' : 'no'}\n`);

const anonClient = createClient(URL_, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── try for a real authenticated session ────────────────────────────────────
let authed = null;
const stamp = Date.now();
const email = `revelio.probe.${stamp}@example.com`;
const password = `Probe!${stamp}`;

const { data: su, error: suErr } = await anonClient.auth.signUp({
  email,
  password,
  options: { data: { full_name: 'Grant Probe' } },
});
if (!suErr) {
  let s = su.session;
  if (!s) {
    const { data: si } = await anonClient.auth.signInWithPassword({ email, password });
    s = si?.session ?? null;
  }
  if (s) {
    authed = createClient(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${s.access_token}` } },
    });
    console.log(`authenticated session: OK (${s.user.id})\n`);
  }
}
if (!authed) {
  console.log(`authenticated session: unavailable (${suErr?.message ?? 'no session returned'})`);
  console.log('falling back to anon-only probing\n');
}

const TABLES = [
  'profiles', 'departments', 'categories', 'documents', 'document_versions',
  'document_insights', 'document_chunks', 'document_comments',
  'document_reviews', 'audit_logs', 'document_search',
];

async function probe(label, client) {
  console.log(`── SELECT as ${label} ──`);
  for (const t of TABLES) {
    const { data, error } = await client.from(t).select('*').limit(1);
    if (!error) {
      console.log(`  ${t.padEnd(19)} OK  rows=${data?.length ?? 0}` + (data?.length === 0 ? '  (grant ok; RLS filtered or empty)' : '  (grant ok)'));
      continue;
    }
    const isGrant = error.code === '42501' || /permission denied for (table|relation)/i.test(error.message ?? '');
    console.log(`  ${t.padEnd(19)} ${isGrant ? 'GRANT MISSING' : 'ERROR'}  code=${error.code ?? 'n/a'}  ${JSON.stringify(error.message)}`);
    if (error.details) console.log(`  ${''.padEnd(19)}   details=${JSON.stringify(error.details)}`);
    if (error.hint) console.log(`  ${''.padEnd(19)}   hint=${JSON.stringify(error.hint)}`);
  }
  console.log();
}

await probe('anon', anonClient);
if (authed) await probe('authenticated (student)', authed);

// ── live app_role enum values, via a deliberately invalid cast ───────────────
console.log('── live app_role enum ──');
{
  const c = authed ?? anonClient;
  const { error } = await c.rpc('transition_document', {
    p_document_id: '00000000-0000-0000-0000-000000000000',
    p_to_state: '__probe_invalid__',
    p_comment: null,
  });
  console.log(`  workflow_state probe: ${error ? `${error.code ?? ''} ${error.message}` : 'no error'}`);
}

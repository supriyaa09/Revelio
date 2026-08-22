/**
 * Verifies that migration 0007 actually reached the live database.
 *
 * Uses the anon key only. Every 0007 object is granted to `authenticated` and
 * revoked from `anon`, so the *expected* answer for an applied migration is a
 * permission error (42501) raised from inside the function — that proves the
 * function exists. PGRST202 / 42883 means the migration was never applied.
 *
 *   node scripts/probe-processing.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const NIL = '00000000-0000-0000-0000-000000000000';

function verdict(error) {
  if (!error) return 'EXISTS (executed — unexpectedly permitted for anon!)';
  const c = error.code ?? '';
  if (c === 'PGRST202' || /Could not find the function/i.test(error.message)) {
    return `MISSING  <-- 0007 NOT APPLIED (${error.message})`;
  }
  if (c === '42883') return `MISSING  <-- 0007 NOT APPLIED (${error.message})`;
  return `EXISTS (denied as designed: ${c || 'n/a'} ${error.message})`;
}

console.log(`host: ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}\n`);

// ── the processing_stage column added by 0007 ────────────────────────────────
console.log('COLUMN document_versions.processing_stage');
{
  const { error } = await supabase
    .from('document_versions')
    .select('id, processing_status, processing_stage')
    .limit(1);
  if (!error) {
    console.log('  EXISTS (readable)');
  } else if (error.code === '42703' || /processing_stage/i.test(error.message)) {
    console.log(`  MISSING  <-- ${error.code} ${error.message}`);
  } else {
    console.log(`  EXISTS or unknown (${error.code} ${error.message})`);
  }
}

// ── the five functions added by 0007 ────────────────────────────────────────
console.log('\nRPCs FROM 0007');
const rpcs = [
  ['can_process_version', { p_version_id: NIL }],
  ['set_version_processing', { p_version_id: NIL, p_status: 'pending' }],
  ['save_document_insights', { p_version_id: NIL, p_summary: 'probe' }],
  ['save_document_chunks', { p_version_id: NIL, p_chunks: [] }],
  ['apply_ai_metadata', { p_document_id: NIL }],
];
for (const [name, args] of rpcs) {
  const { error } = await supabase.rpc(name, args);
  console.log(`  ${name.padEnd(24)} ${verdict(error)}`);
}

// ── is 0008 applied? ────────────────────────────────────────────────────────
// 0007 left can_process_version at PostgreSQL's default EXECUTE TO PUBLIC, so
// anon could call it. 0008 revokes that. The anon result therefore tells the two
// migration states apart without needing any privileged credential:
//   executed  -> 0008 NOT applied
//   42501     -> 0008 applied
console.log('\nMIGRATION 0008 (processing authority == read visibility)');
{
  const { error } = await supabase.rpc('can_process_version', { p_version_id: NIL });
  if (!error) {
    console.log('  NOT APPLIED  <-- anon can still execute can_process_version.');
    console.log('               Faculty reviewers cannot process documents until 0008 runs.');
  } else if (error.code === '42501') {
    console.log('  APPLIED      anon EXECUTE is revoked, as 0008 specifies.');
  } else {
    console.log(`  UNKNOWN      ${error.code} ${error.message}`);
  }
}

// ── how many versions are sitting unprocessed ───────────────────────────────
console.log('\nDATA (anon may be filtered by RLS; counts are indicative only)');
for (const t of ['document_versions', 'document_insights', 'document_chunks']) {
  const { count, error } = await supabase.from(t).select('*', { head: true, count: 'exact' });
  console.log(`  ${t.padEnd(20)} ${error ? `${error.code} ${error.message}` : `${count} row(s)`}`);
}

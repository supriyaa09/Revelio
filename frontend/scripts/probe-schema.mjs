/**
 * Unauthenticated schema reachability probe.
 *
 * Distinguishes "object does not exist" (PGRST202 / PGRST205) from "exists but
 * RLS/authorization denied" — which is enough to identify a missing table or
 * RPC without needing a user session.
 *
 * Uses the anon key only. Reads nothing sensitive; prints no secrets.
 *
 *   node scripts/probe-schema.mjs
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

const verdict = (err) => {
  if (!err) return 'EXISTS (readable)';
  const c = err.code ?? '';
  if (c === 'PGRST205' || /Could not find the table/i.test(err.message)) return `MISSING TABLE  <-- ${err.message}`;
  if (c === 'PGRST202' || /Could not find the function/i.test(err.message)) return `MISSING RPC    <-- ${err.message}`;
  if (c === '42P01') return `MISSING TABLE  <-- ${err.message}`;
  if (c === '42883') return `MISSING RPC    <-- ${err.message}`;
  return `EXISTS (denied/raised: ${c || 'n/a'} ${err.message})`;
};

console.log(`host: ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}\n`);

console.log('TABLES');
for (const t of [
  'profiles', 'departments', 'categories', 'documents', 'document_versions',
  'document_insights', 'document_chunks', 'document_comments',
  'document_reviews', 'audit_logs', 'document_search',
]) {
  const { error } = await supabase.from(t).select('*', { head: true, count: 'exact' }).limit(1);
  console.log(`  ${t.padEnd(20)} ${verdict(error)}`);
}

console.log('\nTAXONOMY ROWS (anon-readable: policies use `using (true)`)');
for (const t of ['departments', 'categories']) {
  const { count, error } = await supabase.from(t).select('*', { head: true, count: 'exact' });
  console.log(`  ${t.padEnd(20) } ${error ? verdict(error) : `${count} row(s)`}`);
}

console.log('\nRPCs (expect UNAUTHORIZED raised from inside = exists)');
const rpcs = [
  ['create_document_version', { p_document_id: '00000000-0000-0000-0000-000000000000', p_storage_path: 'x', p_original_filename: 'x.pdf', p_mime_type: 'application/pdf', p_file_size: 10, p_change_note: null }],
  ['log_audit_event', { p_document_id: null, p_action: 'probe', p_metadata: {} }],
  ['transition_document', { p_document_id: '00000000-0000-0000-0000-000000000000', p_to_state: 'submitted', p_comment: null }],
  ['ensure_profile', {}],
];
for (const [name, args] of rpcs) {
  const { error } = await supabase.rpc(name, args);
  console.log(`  ${name.padEnd(26)} ${verdict(error)}`);
}

console.log('\nSTORAGE BUCKET');
const { data: buckets, error: bErr } = await supabase.storage.listBuckets();
if (bErr) {
  console.log(`  listBuckets: ${bErr.message} (anon often cannot list; not conclusive)`);
} else {
  const d = buckets.find((b) => b.id === 'documents');
  console.log(d ? `  documents: public=${d.public} limit=${d.file_size_limit} mime=${JSON.stringify(d.allowed_mime_types)}` : '  documents bucket: NOT FOUND');
}

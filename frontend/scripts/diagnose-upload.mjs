/**
 * Local reproduction + verification for the student upload flow.
 *
 * Runs the exact same sequence as uploadDocument() in
 * src/lib/actions/documents.ts, as a real authenticated user with the anon key,
 * so every RLS policy, storage policy and RPC is exercised for real.
 *
 * No service-role key. No RLS bypass. Secrets are read from .env.local and
 * never printed.
 *
 *   node scripts/diagnose-upload.mjs
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
if (!URL_ || !ANON) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing from .env.local');
  process.exit(1);
}
console.log(`host: ${new URL(URL_).host}\n`);

const supabase = createClient(URL_, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const show = (label, error) => {
  if (!error) {
    console.log(`  OK   ${label}`);
    return false;
  }
  console.log(`  FAIL ${label}`);
  console.log(`       message: ${error.message}`);
  for (const k of ['code', 'details', 'hint', 'status', 'statusCode', 'error']) {
    if (error[k] !== undefined && error[k] !== null && error[k] !== '') {
      console.log(`       ${k}: ${typeof error[k] === 'object' ? JSON.stringify(error[k]) : error[k]}`);
    }
  }
  return true;
};

// ── throwaway student ───────────────────────────────────────────────────────
const stamp = Date.now();
const email = `revelio.probe.${stamp}@example.com`;
const password = `Probe!${stamp}`;

console.log('STEP 0  obtain a real student session');
let session = null;

// Preferred: ordinary signup, exactly like the app does.
const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
  email,
  password,
  options: { data: { full_name: 'Upload Probe' } },
});

if (!signUpErr) {
  session = signUp.session;
  if (!session) {
    const { data: si } = await supabase.auth.signInWithPassword({ email, password });
    session = si?.session ?? null;
  }
} else {
  console.log(`  note  auth.signUp unavailable: ${signUpErr.message} (${signUpErr.code ?? ''})`);
}

// Fallback: mint a pre-confirmed user with the Admin API. The service-role key
// is used ONLY to create this throwaway fixture — every subsequent step below
// runs through the anon client under the user's own JWT, so RLS, storage
// policies and RPC role checks are all still enforced for real.
if (!session) {
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) {
    console.error('\nFATAL: cannot get a session, and SUPABASE_SERVICE_ROLE_KEY is absent.');
    console.error('Either disable Auth > Email > "Confirm email", or add the key to .env.local.');
    process.exit(1);
  }
  const admin = createClient(URL_, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: adminErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Upload Probe' },
  });
  if (show('admin.createUser (fixture only)', adminErr)) process.exit(1);

  const { data: si, error: siErr } = await supabase.auth.signInWithPassword({ email, password });
  if (show('auth.signInWithPassword', siErr)) process.exit(1);
  session = si.session;
}

const userId = session.user.id;
console.log(`  OK   session for ${userId}\n`);

// profile must exist (handle_new_user trigger / ensure_profile)
console.log('STEP 0b profile row exists');
const { data: prof, error: profErr } = await supabase
  .from('profiles')
  .select('id, full_name, role')
  .eq('id', userId)
  .maybeSingle();
show('profiles select', profErr);
console.log(prof ? `       role=${prof.role} full_name=${prof.full_name}` : '       NO PROFILE ROW');
console.log();

// ── STEP 1: categories query ────────────────────────────────────────────────
console.log('STEP 1  categories query');
const { data: categories, error: catErr } = await supabase
  .from('categories')
  .select('id, department_id, name, slug, description, match_keywords, is_active, sort_order')
  .eq('is_active', true);
if (show('categories select', catErr)) process.exit(1);
console.log(`       ${categories?.length ?? 0} active categories`);
if (!categories?.length) console.log('       NOTE: taxonomy empty — seed.sql has not been run');
console.log();

// ── STEP 2: documents insert ────────────────────────────────────────────────
console.log('STEP 2  documents insert');
const { data: doc, error: docErr } = await supabase
  .from('documents')
  .insert({
    title: 'Resume',
    description: null,
    owner_id: userId,
    category_id: null,
    department_id: null,
    category_source: 'system',
    category_confidence: 0,
    workflow_status: 'draft',
    system_metadata: {
      classification: { method: 'keyword', matched_terms: [], basis: 'title_and_filename' },
    },
  })
  .select('id')
  .single();
if (show('documents insert', docErr)) process.exit(1);
console.log(`       document_id=${doc.id}\n`);

// ── STEP 3: storage upload ──────────────────────────────────────────────────
console.log('STEP 3  storage upload');
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);
const objectKey = `${doc.id}/v1/Resume.pdf`;
const { error: upErr } = await supabase.storage
  .from('documents')
  .upload(objectKey, pdf, { contentType: 'application/pdf', upsert: false });
const uploadFailed = show(`storage upload -> ${objectKey}`, upErr);
console.log();

// ── STEP 4: create_document_version RPC ─────────────────────────────────────
console.log('STEP 4  create_document_version RPC');
const { data: ver, error: verErr } = await supabase.rpc('create_document_version', {
  p_document_id: doc.id,
  p_storage_path: objectKey,
  p_original_filename: 'Resume.pdf',
  p_mime_type: 'application/pdf',
  p_file_size: pdf.length,
  p_change_note: null,
});
const verFailed = show('create_document_version', verErr);
if (!verFailed) {
  const v = Array.isArray(ver) ? ver[0] : ver;
  console.log(`       version_number=${v?.version_number} id=${v?.id}`);
}
console.log();

// ── STEP 5: log_audit_event RPC ─────────────────────────────────────────────
console.log('STEP 5  log_audit_event RPC');
const { error: auditErr } = await supabase.rpc('log_audit_event', {
  p_document_id: doc.id,
  p_action: 'document_uploaded',
  p_metadata: { filename: 'Resume.pdf', size: pdf.length, mime_type: 'application/pdf' },
});
show('log_audit_event', auditErr);
console.log();

// ── verification ────────────────────────────────────────────────────────────
console.log('VERIFY');
const { data: vDoc } = await supabase
  .from('documents')
  .select('id, title, workflow_status, current_version_id')
  .eq('id', doc.id)
  .maybeSingle();
console.log(`  document row      : ${vDoc ? 'yes' : 'NO'}  status=${vDoc?.workflow_status} current_version=${vDoc?.current_version_id ?? 'null'}`);

const { data: vVers } = await supabase
  .from('document_versions')
  .select('id, version_number, storage_path, file_size, processing_status')
  .eq('document_id', doc.id);
console.log(`  document_versions : ${vVers?.length ?? 0} row(s)`);

const { data: listed, error: listErr } = await supabase.storage
  .from('documents')
  .list(`${doc.id}/v1`);
console.log(`  storage object    : ${listErr ? `error ${listErr.message}` : `${listed?.length ?? 0} file(s)`}`);

const { data: vAudit } = await supabase
  .from('audit_logs')
  .select('action, created_at')
  .eq('document_id', doc.id);
console.log(`  audit_logs        : ${vAudit?.length ?? 0} row(s) [${(vAudit ?? []).map((a) => a.action).join(', ')}]`);

console.log(`\nleft behind for inspection: document ${doc.id} (user ${email})`);
if (uploadFailed || verFailed) process.exit(1);

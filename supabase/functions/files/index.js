import { supabase, storage, projectUrl } from '../_shared/supabase.js';

// PDFs for Job Sprint: files attached to a job, and the shared library of standard resumes.
// Files live in a private Storage bucket. The browser never gets a key: it asks this function
// for a short-lived upload or view link, one file at a time.
const USERS = ['Garima', 'Indresh'];
const BUCKET = 'documents';
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = ['resume', 'attachment'];
const VIEW_SECONDS = 600;
const PURGE_AFTER_MS = 24 * 3600 * 1000; // deleted files can be undone for a day, then they're removed
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = 'id,kind,job_id,title,role_tag,is_default,size_bytes,uploaded_by,uploaded_at,updated_at';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const bad = (message) => json(400, { error: message });
const byId = (id) => `documents?id=eq.${encodeURIComponent(id)}`;
const tidy = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const folder = (kind) => (kind === 'resume' ? 'resumes' : 'attachments');

async function getDoc(id) {
  const rows = await supabase(`${byId(id)}&select=*`);
  return rows?.[0] || null;
}
async function patchDoc(filter, patch) {
  const rows = await supabase(filter, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch });
  return rows?.[0] || null;
}
const publicDoc = (d) => Object.fromEntries(COLUMNS.split(',').map((k) => [k, d[k]]));

// A signed link the browser can PUT one PDF to. Valid for one upload of that exact path.
async function signUpload(path) {
  const out = await storage(`object/upload/sign/${BUCKET}/${encPath(path)}`, { method: 'POST' });
  return `${projectUrl()}/storage/v1${out.url}`;
}
// Checks the upload really landed and is a PDF within the size limit.
async function storedObject(path) {
  const slash = path.lastIndexOf('/');
  const list = await storage(`object/list/${BUCKET}`, { method: 'POST', body: { prefix: path.slice(0, slash), search: path.slice(slash + 1), limit: 5 } });
  return (list || []).find((o) => o.name === path.slice(slash + 1)) || null;
}
async function removeObjects(paths) {
  if (!paths.length) return;
  await storage(`object/${BUCKET}`, { method: 'DELETE', body: { prefixes: paths } });
}

// Housekeeping on each list: drop deleted files after a day, and uploads that never finished.
async function purge() {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS).toISOString();
  const old = await supabase(`documents?select=id,path,pending_path&or=(deleted_at.lt.${cutoff},and(ready.is.false,uploaded_at.lt.${cutoff}))&limit=50`);
  if (!old?.length) return;
  await removeObjects(old.flatMap((d) => [d.path, d.pending_path].filter(Boolean)));
  await supabase(`documents?id=in.(${old.map((d) => d.id).join(',')})`, { method: 'DELETE' });
}

async function handleGet(query = {}) {
  if (query.open) {
    if (!UUID.test(query.open)) return bad('Invalid file.');
    const doc = await getDoc(query.open);
    if (!doc || !doc.ready || doc.deleted_at) return json(404, { error: 'That file is gone.' });
    const download = query.download === '1' ? `&download=${encodeURIComponent(`${doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'file'}.pdf`)}` : '';
    const out = await storage(`object/sign/${BUCKET}/${encPath(doc.path)}`, { method: 'POST', body: { expiresIn: VIEW_SECONDS } });
    return json(200, { url: `${projectUrl()}/storage/v1${out.signedURL}${download}` });
  }
  try { await purge(); } catch { /* never block the list on housekeeping */ }
  const documents = await supabase(`documents?select=${COLUMNS}&ready=is.true&deleted_at=is.null&order=uploaded_at.desc`);
  return json(200, { documents });
}

async function handlePost(body) {
  const { action, actor } = body;
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');
  const now = new Date().toISOString();

  if (action === 'start') {
    const kind = body.kind;
    if (!KINDS.includes(kind)) return bad('Invalid file type.');
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return bad('That file looks empty.');
    if (size > MAX_BYTES) return bad('PDFs can be up to 10 MB.');
    const title = tidy(body.title, 200);
    if (!title) return bad('Give the file a name.');
    let jobId = null;
    let roleTag = null;
    if (kind === 'attachment') {
      if (!UUID.test(body.job_id || '')) return bad('Missing job.');
      const job = await supabase(`jobs?id=eq.${body.job_id}&select=id`);
      if (!job?.length) return json(404, { error: 'Job not found.' });
      jobId = body.job_id;
    } else {
      roleTag = tidy(body.role_tag, 80) || null;
      if (!roleTag) return bad('Pick the role this resume is for.');
    }
    const id = crypto.randomUUID();
    const path = `${folder(kind)}/${id}.pdf`;
    const created = await supabase('documents', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [{ id, kind, job_id: jobId, title, role_tag: roleTag, path, size_bytes: size, ready: false, uploaded_by: actor, uploaded_at: now, updated_at: now }],
    });
    return json(201, { document: publicDoc(created[0]), upload_url: await signUpload(path) });
  }

  if (action === 'replace') {
    if (!UUID.test(body.id || '')) return bad('Invalid file.');
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return bad('That file looks empty.');
    if (size > MAX_BYTES) return bad('PDFs can be up to 10 MB.');
    const doc = await getDoc(body.id);
    if (!doc || !doc.ready || doc.deleted_at) return json(404, { error: 'That file is gone.' });
    const pending = `${folder(doc.kind)}/${doc.id}-${Date.now()}.pdf`;
    await patchDoc(byId(doc.id), { pending_path: pending });
    return json(200, { document: publicDoc(doc), upload_url: await signUpload(pending) });
  }

  if (action === 'finish') {
    if (!UUID.test(body.id || '')) return bad('Invalid file.');
    const doc = await getDoc(body.id);
    if (!doc || doc.deleted_at) return json(404, { error: 'That file is gone.' });
    const replacing = doc.ready && doc.pending_path;
    const path = replacing ? doc.pending_path : doc.path;
    if (doc.ready && !replacing) return json(200, { document: publicDoc(doc) });
    const obj = await storedObject(path);
    if (!obj) return json(409, { error: 'The upload didn’t arrive. Try again.' });
    const size = Number(obj.metadata?.size) || doc.size_bytes;
    const mime = obj.metadata?.mimetype || 'application/pdf';
    if (size > MAX_BYTES || mime !== 'application/pdf') {
      await removeObjects([path]);
      return bad('Only PDFs up to 10 MB.');
    }
    const patch = { ready: true, size_bytes: size, updated_at: now, pending_path: null };
    if (replacing) { patch.path = path; patch.uploaded_by = actor; patch.uploaded_at = now; }
    // The first resume for a role becomes that role's go-to.
    if (doc.kind === 'resume' && !replacing) {
      const peers = await supabase(`documents?select=id&kind=eq.resume&ready=is.true&deleted_at=is.null&is_default=is.true&role_tag=eq.${encodeURIComponent(doc.role_tag)}`);
      if (!peers?.length) patch.is_default = true;
    }
    const saved = await patchDoc(byId(doc.id), patch);
    if (replacing) { try { await removeObjects([doc.path]); } catch { /* old copy is harmless */ } }
    return json(200, { document: publicDoc(saved) });
  }

  return bad('Unknown action.');
}

async function handlePatch(body) {
  const { id, action, actor } = body;
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');
  if (!UUID.test(id || '')) return bad('Invalid file.');
  const now = new Date().toISOString();
  const doc = await getDoc(id);
  if (!doc || !doc.ready) return json(404, { error: 'That file is gone.' });

  if (action === 'edit') {
    const patch = { updated_at: now };
    if (body.title !== undefined) {
      const title = tidy(body.title, 200);
      if (!title) return bad('Give the file a name.');
      patch.title = title;
    }
    if (body.role_tag !== undefined && doc.kind === 'resume') {
      const role = tidy(body.role_tag, 80);
      if (!role) return bad('Pick the role this resume is for.');
      if (role !== doc.role_tag) { patch.role_tag = role; patch.is_default = false; }
    }
    return json(200, { document: publicDoc(await patchDoc(byId(id), patch)) });
  }
  if (action === 'default') {
    if (doc.kind !== 'resume') return bad('Only resumes can be the go-to.');
    await supabase(`documents?kind=eq.resume&role_tag=eq.${encodeURIComponent(doc.role_tag)}&is_default=is.true`, { method: 'PATCH', body: { is_default: false } });
    return json(200, { document: publicDoc(await patchDoc(byId(id), { is_default: true, updated_at: now })) });
  }
  if (action === 'delete') {
    await patchDoc(byId(id), { deleted_at: now, is_default: false });
    return json(200, { ok: true });
  }
  if (action === 'restore') {
    if (!doc.deleted_at) return json(200, { document: publicDoc(doc) });
    return json(200, { document: publicDoc(await patchDoc(byId(id), { deleted_at: null, updated_at: now })) });
  }
  return bad('Unknown action.');
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') return await handleGet(event.queryStringParameters || {});
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad('Invalid request.'); }
    if (event.httpMethod === 'POST') return await handlePost(body);
    if (event.httpMethod === 'PATCH') return await handlePatch(body);
    return json(405, { error: 'Method not allowed.' });
  } catch (err) {
    return json(500, { error: err.message || 'Server error.' });
  }
};

// Runs as a Supabase Edge Function; does nothing when imported by the tests.
import { serve } from '../_shared/serve.js';
serve(handler);

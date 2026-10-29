const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const files = require('../supabase/functions/files/index.js').handler;
const jobs = require('../supabase/functions/jobs/index.js').handler;

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const JOB = '0b3a6a3e-1111-4c0b-9d0a-3f0c2b9a7e22';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

// A tiny fake of PostgREST + Storage, enough to follow each request.
function mock({ doc = null, stored = { size: 2048, mimetype: 'application/pdf' }, peers = [], job = true } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const u = decodeURIComponent(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: u, method, body });
    if (u.includes('/storage/v1/object/upload/sign/')) return reply({ url: `/object/upload/sign/documents/x?token=up` });
    if (u.includes('/storage/v1/object/sign/')) return reply({ signedURL: '/object/sign/documents/x?token=view' });
    if (u.includes('/storage/v1/object/list/')) return reply(stored ? [{ name: body.search, metadata: stored }] : []);
    if (u.includes('/storage/v1/object/documents') && method === 'DELETE') return reply([]);
    if (u.includes('/rest/v1/jobs')) {
      if (method === 'GET') return reply(job ? [{ id: JOB }] : []);
      return reply([{ id: JOB, ...body }]);
    }
    if (u.includes('/rest/v1/documents')) {
      if (method === 'GET' && u.includes('is_default=is.true')) return reply(peers);
      if (method === 'GET' && u.includes('select=*')) return reply(doc ? [doc] : []);
      if (method === 'GET') return reply([]);
      if (method === 'POST') return reply(body, 201);
      if (method === 'PATCH') return reply([{ ...(doc || {}), ...body }]);
      if (method === 'DELETE') return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method} ${u}`);
  };
  return calls;
}
const post = (body) => files({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', ...body }) });
const patch = (body) => files({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });
const readyDoc = (over = {}) => ({ id: ID, kind: 'resume', job_id: null, title: 'CoS resume', role_tag: 'Chief of Staff', is_default: false, path: `resumes/${ID}.pdf`, pending_path: null, size_bytes: 2048, ready: true, uploaded_by: 'Garima', uploaded_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:00Z', deleted_at: null, ...over });

test('Starting an upload makes a hidden row and returns a one-time upload link', async () => {
  const calls = mock();
  const res = await post({ action: 'start', kind: 'resume', title: '  CoS   resume v3 ', role_tag: 'Chief of Staff', size: 120000 });
  assert.equal(res.statusCode, 201);
  const out = JSON.parse(res.body);
  assert.equal(out.upload_url, 'https://example.supabase.co/storage/v1/object/upload/sign/documents/x?token=up');
  const row = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/documents')).body[0];
  assert.equal(row.title, 'CoS resume v3');
  assert.equal(row.ready, false);
  assert.match(row.path, /^resumes\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(out.document.path, undefined, 'storage paths stay on the server');
});

test('Job attachments need a real job; bad uploads are refused', async () => {
  let calls = mock();
  const res = await post({ action: 'start', kind: 'attachment', job_id: JOB, title: 'Offer letter', size: 5000 });
  assert.equal(res.statusCode, 201);
  assert.match(calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/documents')).body[0].path, /^attachments\//);
  mock({ job: false });
  assert.equal((await post({ action: 'start', kind: 'attachment', job_id: JOB, title: 'x', size: 5 })).statusCode, 404);
  mock();
  assert.equal((await post({ action: 'start', kind: 'attachment', job_id: 'nope', title: 'x', size: 5 })).statusCode, 400);
  assert.equal((await post({ action: 'start', kind: 'resume', title: 'x', size: 5 })).statusCode, 400, 'resume needs a role');
  assert.equal((await post({ action: 'start', kind: 'resume', title: 'x', role_tag: 'CoS', size: 11 * 1024 * 1024 })).statusCode, 400, 'over 10 MB');
  assert.equal((await post({ action: 'start', kind: 'resume', title: 'x', role_tag: 'CoS', size: 0 })).statusCode, 400);
  assert.equal((await post({ action: 'start', kind: 'video', title: 'x', size: 5 })).statusCode, 400);
  assert.equal((await post({ action: 'start', kind: 'resume', title: '  ', role_tag: 'CoS', size: 5 })).statusCode, 400);
  assert.equal((await files({ httpMethod: 'POST', body: JSON.stringify({ action: 'start', kind: 'resume', title: 'x', role_tag: 'CoS', size: 5, actor: 'Eve' }) })).statusCode, 400);
});

test('Finishing checks the file really arrived, and the first resume for a role becomes the go-to', async () => {
  let calls = mock({ doc: readyDoc({ ready: false }) });
  let res = await post({ action: 'finish', id: ID });
  assert.equal(res.statusCode, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual([write.body.ready, write.body.size_bytes, write.body.is_default], [true, 2048, true]);
  calls = mock({ doc: readyDoc({ ready: false }), peers: [{ id: 'other' }] });
  await post({ action: 'finish', id: ID });
  assert.equal(calls.find((c) => c.method === 'PATCH').body.is_default, undefined);
  mock({ doc: readyDoc({ ready: false }), stored: null });
  assert.equal((await post({ action: 'finish', id: ID })).statusCode, 409);
  calls = mock({ doc: readyDoc({ ready: false }), stored: { size: 900, mimetype: 'text/html' } });
  assert.equal((await post({ action: 'finish', id: ID })).statusCode, 400);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/storage/')), 'non-PDF is removed');
});

test('Replacing a file swaps it in and removes the old copy', async () => {
  let calls = mock({ doc: readyDoc() });
  const res = await post({ action: 'replace', id: ID, size: 3000 });
  assert.equal(res.statusCode, 200);
  assert.match(calls.find((c) => c.method === 'PATCH').body.pending_path, new RegExp(`^resumes/${ID}-\\d+\\.pdf$`));
  calls = mock({ doc: readyDoc({ pending_path: `resumes/${ID}-1.pdf` }) });
  assert.equal((await post({ action: 'finish', id: ID })).statusCode, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.equal(write.body.path, `resumes/${ID}-1.pdf`);
  assert.equal(write.body.pending_path, null);
  const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('/storage/'));
  assert.deepEqual(del.body.prefixes, [`resumes/${ID}.pdf`]);
});

test('Opening a file returns a short-lived link; deleted or missing files are 404', async () => {
  let calls = mock({ doc: readyDoc() });
  let res = await files({ httpMethod: 'GET', queryStringParameters: { open: ID } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).url, 'https://example.supabase.co/storage/v1/object/sign/documents/x?token=view');
  assert.equal(calls.find((c) => c.url.includes('/object/sign/')).body.expiresIn, 600);
  mock({ doc: readyDoc() });
  res = await files({ httpMethod: 'GET', queryStringParameters: { open: ID, download: '1' } });
  assert.match(JSON.parse(res.body).url, /&download=CoS%20resume\.pdf$/);
  mock({ doc: readyDoc({ deleted_at: '2026-10-28T00:00:00Z' }) });
  assert.equal((await files({ httpMethod: 'GET', queryStringParameters: { open: ID } })).statusCode, 404);
  mock();
  assert.equal((await files({ httpMethod: 'GET', queryStringParameters: { open: 'x' } })).statusCode, 400);
});

test('The list hides unfinished and deleted files and never exposes storage paths', async () => {
  const calls = mock();
  const res = await files({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 200);
  const list = calls.find((c) => c.method === 'GET' && c.url.includes('ready=is.true'));
  assert.match(list.url, /deleted_at=is\.null/);
  assert.deepEqual(JSON.parse(res.body).documents, []);
});

test('Rename, change role, go-to, delete and undo', async () => {
  let calls = mock({ doc: readyDoc({ is_default: true }) });
  await patch({ action: 'edit', title: ' New name ', role_tag: 'Operations' });
  let w = calls.find((c) => c.method === 'PATCH').body;
  assert.deepEqual([w.title, w.role_tag, w.is_default], ['New name', 'Operations', false]);
  mock({ doc: readyDoc() });
  assert.equal((await patch({ action: 'edit', title: '' })).statusCode, 400);
  calls = mock({ doc: readyDoc() });
  await patch({ action: 'default' });
  const writes = calls.filter((c) => c.method === 'PATCH');
  assert.match(writes[0].url, /role_tag=eq\.Chief of Staff/);
  assert.equal(writes[0].body.is_default, false);
  assert.equal(writes[1].body.is_default, true);
  calls = mock({ doc: readyDoc() });
  await patch({ action: 'delete' });
  assert.ok(Date.parse(calls.find((c) => c.method === 'PATCH').body.deleted_at));
  calls = mock({ doc: readyDoc({ deleted_at: '2026-10-28T00:00:00Z' }) });
  await patch({ action: 'restore' });
  assert.equal(calls.find((c) => c.method === 'PATCH').body.deleted_at, null);
  mock({ doc: readyDoc({ kind: 'attachment', role_tag: null }) });
  assert.equal((await patch({ action: 'default' })).statusCode, 400);
});

test('A job can record which standard resume was sent', async () => {
  let calls = mock();
  const res = await jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: JOB, actor: 'Garima', action: 'resume', resume_id: ID }) });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].body.resume_id, ID);
  calls = mock();
  await jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: JOB, actor: 'Garima', action: 'resume', resume_id: null }) });
  assert.equal(calls[0].body.resume_id, null);
  assert.equal((await jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: JOB, actor: 'Garima', action: 'resume', resume_id: 'nope' }) })).statusCode, 400);
});

test('Storage calls without a body send no JSON content-type (Storage rejects that)', async () => {
  const seen = [];
  global.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), headers: options.headers || {}, body: options.body });
    if (String(url).includes('/rest/v1/jobs')) return reply([{ id: JOB }]);
    if (String(url).includes('/rest/v1/documents')) return reply(JSON.parse(options.body), 201);
    return reply({ url: '/object/upload/sign/documents/x?token=up' });
  };
  await post({ action: 'start', kind: 'resume', title: 'x', role_tag: 'CoS', size: 5 });
  const sign = seen.find((c) => c.url.includes('/upload/sign/'));
  assert.equal(sign.body, undefined);
  assert.equal(sign.headers['Content-Type'], undefined);
});

test('Word (.docx) files: stored as .docx, checked as Word, and always download', async () => {
  let calls = mock();
  const res = await post({ action: 'start', kind: 'resume', title: 'CoS resume', role_tag: 'CoS', size: 5000, file_type: 'docx' });
  assert.equal(res.statusCode, 201);
  assert.match(calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/documents')).body[0].path, /^resumes\/[0-9a-f-]{36}\.docx$/);
  assert.equal(JSON.parse(res.body).document.file_type, 'docx');
  mock();
  assert.equal((await post({ action: 'start', kind: 'resume', title: 'x', role_tag: 'CoS', size: 5, file_type: 'exe' })).statusCode, 400);
  const docx = readyDoc({ path: `resumes/${ID}.docx`, ready: false });
  calls = mock({ doc: docx, stored: { size: 4000, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
  assert.equal((await post({ action: 'finish', id: ID })).statusCode, 200);
  mock({ doc: docx, stored: { size: 4000, mimetype: 'application/pdf' } });
  assert.equal((await post({ action: 'finish', id: ID })).statusCode, 400, 'declared .docx but stored as PDF');
  mock({ doc: readyDoc({ path: `resumes/${ID}.docx` }) });
  const open = await files({ httpMethod: 'GET', queryStringParameters: { open: ID } });
  assert.match(JSON.parse(open.body).url, /&download=CoS%20resume\.docx$/);
  calls = mock({ doc: readyDoc() });
  await post({ action: 'replace', id: ID, size: 3000, file_type: 'docx' });
  assert.match(calls.find((c) => c.method === 'PATCH').body.pending_path, new RegExp(`^resumes/${ID}-\\d+\\.docx$`));
});

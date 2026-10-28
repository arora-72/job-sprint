const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const jobs = require('../supabase/functions/jobs/index.js').handler;
const companies = require('../supabase/functions/companies/index.js').handler;

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const reply = (value, status = 200) => new Response(value === null ? null : JSON.stringify(value), { status: value === null ? 204 : status, headers: { 'content-type': 'application/json' } });

function mock({ postError } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'DELETE') return reply(null);
    if (method === 'POST') return postError ? reply({ message: postError }, 409) : reply(body, 201);
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return calls;
}

const jobRow = (o = {}) => ({
  id: ID, company: 'Faire', title: 'BizOps Lead', location: 'Remote', url: 'https://x.test/faire', status: 'applied',
  added_by: 'Indresh', added_at: '2026-10-20T10:00:00Z', applied_by: 'Garima', applied_at: '2026-10-21T10:00:00Z',
  blocked_by: null, blocked_at: null, blocked_reason: '', network_status: 'first_pass', network_updated_by: 'Garima',
  network_updated_at: '2026-10-22T10:00:00Z', network_closed_by: null, network_closed_at: null,
  notes: [{ id: 'n1', text: 'hi', by: 'Garima', at: '2026-10-22T10:00:00Z' }], updated_at: '2026-10-22T10:00:00Z', ...o,
});
const companyRow = (o = {}) => ({
  id: ID, name: 'Ramp', source: 'LinkedIn', stage: 'reached_out', stage_updated_by: 'Garima', stage_updated_at: '2026-10-22T10:00:00Z',
  people: [{ id: 'p1', name: 'Dana', role: '', link: '', status: 'messaged' }], notes: [], added_by: 'Garima',
  added_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-22T10:00:00Z', ...o,
});

test('Deleting a job removes exactly that row and needs a known person', async () => {
  const calls = mock();
  const res = await jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', action: 'delete' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].method, 'DELETE');
  assert.match(calls[0].url, /jobs\?id=eq\.6f1c1a8e/);
  const anon = await jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, action: 'delete' }) });
  assert.equal(anon.statusCode, 400);
});

test('Undo brings a deleted job back exactly as it was', async () => {
  const calls = mock();
  const res = await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: jobRow() }) });
  assert.equal(res.statusCode, 201);
  const saved = calls[0].body[0];
  assert.equal(saved.id, ID);
  assert.equal(saved.network_status, 'first_pass');
  assert.equal(saved.notes.length, 1);
});

test('Restore ignores unknown columns and rejects bad rows', async () => {
  let calls = mock();
  await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: jobRow({ evil: 'x', pending: true }) }) });
  assert.equal(calls[0].body[0].evil, undefined);
  mock();
  const post = (restore, actor = 'Garima') => jobs({ httpMethod: 'POST', body: JSON.stringify({ actor, restore }) });
  assert.equal((await post(jobRow({ id: 'not-a-uuid' }))).statusCode, 400);
  assert.equal((await post(jobRow({ status: 'hired' }))).statusCode, 400);
  assert.equal((await post(jobRow({ url: 'javascript:alert(1)' }))).statusCode, 400);
  assert.equal((await post(jobRow({ network_status: 'ghosted' }))).statusCode, 400);
  assert.equal((await post(jobRow({ added_by: 'Mallory' }))).statusCode, 400);
  assert.equal((await post(jobRow({ notes: 'x' }))).statusCode, 400);
  assert.equal((await post(jobRow(), 'Mallory')).statusCode, 400);
  calls = mock({ postError: 'duplicate key value violates unique constraint "jobs_pkey"' });
  assert.equal((await post(jobRow())).statusCode, 409);
});

test('Companies restore the same way, with people and notes intact', async () => {
  const calls = mock();
  const res = await companies({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Indresh', restore: companyRow() }) });
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].body[0].people[0].name, 'Dana');
  mock();
  const post = (restore) => companies({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore }) });
  assert.equal((await post(companyRow({ stage: 'hired' }))).statusCode, 400);
  assert.equal((await post(companyRow({ id: 'nope' }))).statusCode, 400);
  assert.equal((await post(companyRow({ people: 'x' }))).statusCode, 400);
  assert.equal((await companies({ httpMethod: 'POST', body: JSON.stringify({ restore: companyRow() }) })).statusCode, 400);
});

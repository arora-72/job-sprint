const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const jobs = require('../supabase/functions/jobs/index.js').handler;
const companies = require('../supabase/functions/companies/index.js').handler;

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function mock({ patchResult } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'PATCH') return reply(patchResult || [{ id: ID, ...body }]);
    if (method === 'POST') return reply([{ id: ID, ...body[0] }], 201);
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return calls;
}
const jobPatch = (body) => jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });
const coPatch = (body) => companies({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });

test('A job can be assigned to either person or to nobody', async () => {
  let calls = mock();
  assert.equal((await jobPatch({ action: 'assign', assigned_to: 'Indresh' })).statusCode, 200);
  assert.equal(calls[0].body.assigned_to, 'Indresh');
  calls = mock();
  assert.equal((await jobPatch({ action: 'assign', assigned_to: null })).statusCode, 200);
  assert.equal(calls[0].body.assigned_to, null);
  assert.equal((await jobPatch({ action: 'assign', assigned_to: 'Mallory' })).statusCode, 400);
  assert.equal((await jobPatch({ action: 'assign' })).statusCode, 400);
  mock({ patchResult: [] });
  assert.equal((await jobPatch({ action: 'assign', assigned_to: 'Garima' })).statusCode, 404);
});

test('A new job is assigned to the person who added it', async () => {
  const calls = mock();
  const res = await jobs({ httpMethod: 'POST', body: JSON.stringify({ company: 'Ramp', title: 'BizOps', url: 'https://ramp.com/j/1', added_by: 'Indresh' }) });
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].body[0].assigned_to, 'Indresh');
});

test('Companies can be assigned too, and start unassigned by default', async () => {
  let calls = mock();
  assert.equal((await coPatch({ action: 'assign', assigned_to: 'Garima' })).statusCode, 200);
  assert.equal(calls[0].body.assigned_to, 'Garima');
  assert.equal((await coPatch({ action: 'assign', assigned_to: 'Mallory' })).statusCode, 400);
  calls = mock();
  await companies({ httpMethod: 'POST', body: JSON.stringify({ added_by: 'Garima', name: 'Ramp' }) });
  assert.equal(calls[0].body[0].assigned_to, null);
  calls = mock();
  await companies({ httpMethod: 'POST', body: JSON.stringify({ added_by: 'Garima', name: 'Faire', assigned_to: 'Indresh' }) });
  assert.equal(calls[0].body[0].assigned_to, 'Indresh');
  assert.equal((await companies({ httpMethod: 'POST', body: JSON.stringify({ added_by: 'Garima', name: 'X', assigned_to: 'Mallory' }) })).statusCode, 400);
});

test('Undoing a delete keeps the owner', async () => {
  const calls = mock();
  const row = {
    id: ID, company: 'Faire', title: 'BizOps', url: 'https://x.test/f', status: 'pipeline', added_by: 'Indresh', assigned_to: 'Garima',
    added_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z',
  };
  assert.equal((await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: row }) })).statusCode, 201);
  assert.equal(calls[0].body[0].assigned_to, 'Garima');
  assert.equal((await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: { ...row, assigned_to: 'Mallory' } }) })).statusCode, 400);
});

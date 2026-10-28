const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const jobs = require('../netlify/functions/jobs').handler;

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
const patch = (body) => jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });

test('Setting a priority saves only the order, not updated_at', async () => {
  const calls = mock();
  const res = await patch({ action: 'priority', priority: 2.5 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0].body, { priority: 2.5 });
  assert.match(calls[0].url, /jobs\?id=eq\./);
});

test('Priority can be cleared back to "To rank", and negative numbers work for Move to top', async () => {
  let calls = mock();
  assert.equal((await patch({ action: 'priority', priority: null })).statusCode, 200);
  assert.equal(calls[0].body.priority, null);
  calls = mock();
  assert.equal((await patch({ action: 'priority', priority: -14 })).statusCode, 200);
  assert.equal(calls[0].body.priority, -14);
});

test('Bad priorities and unknown people are refused; missing jobs are 404', async () => {
  mock();
  for (const priority of ['1', 1e13, undefined, {}, true]) {
    assert.equal((await patch({ action: 'priority', priority })).statusCode, 400, String(priority));
  }
  assert.equal((await jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Eve', action: 'priority', priority: 1 }) })).statusCode, 400);
  mock({ patchResult: [] });
  assert.equal((await patch({ action: 'priority', priority: 1 })).statusCode, 404);
});

test('Undo of a delete keeps the job\'s rank, and rejects a bad one', async () => {
  const snapshot = { id: ID, company: 'Ramp', title: 'S&O', url: 'https://x.test/r', status: 'pipeline', added_by: 'Garima', added_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', notes: [], priority: 3 };
  const calls = mock();
  const res = await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: snapshot }) });
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].body[0].priority, 3);
  mock();
  const bad = await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: { ...snapshot, priority: 'first' } }) });
  assert.equal(bad.statusCode, 400);
});

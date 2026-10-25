const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const { handler } = require('../netlify/functions/discover');

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const patch = (body) => handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });

function mock({ notes = [], patchResults, role } = {}) {
  const calls = [];
  let patches = 0;
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET' && url.includes('select=notes')) return reply([{ notes, updated_at: '2026-10-24T20:00:00.123456+00:00' }]);
    if (method === 'GET' && url.startsWith('https://example.supabase.co/rest/v1/discover_jobs')) return reply([role]);
    if (method === 'GET') return reply([]);
    if (method === 'POST') return reply([{ id: 'job-1', ...body[0] }], 201);
    if (method === 'PATCH') {
      const result = patchResults ? patchResults[patches] : [{ id: ID, ...body }];
      patches += 1;
      return reply(result);
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return calls;
}

test('A note on a Discover role records who and when', async () => {
  const calls = mock();
  const res = await patch({ action: 'add-note', text: '  Ask Dana for a referral  ' });
  assert.equal(res.statusCode, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.match(write.url, /discover_jobs\?id=eq\./);
  assert.match(write.url, /updated_at=eq\./);
  assert.equal(write.body.notes[0].text, 'Ask Dana for a referral');
  assert.equal(write.body.notes[0].by, 'Garima');
});

test('Empty, long, or unknown note requests are rejected, and plain dismiss still works', async () => {
  mock();
  assert.equal((await patch({ action: 'add-note', text: '  ' })).statusCode, 400);
  assert.equal((await patch({ action: 'add-note', text: 'x'.repeat(1001) })).statusCode, 400);
  assert.equal((await patch({ action: 'explode' })).statusCode, 400);
  const calls = mock({ patchResults: [[{ id: ID, status: 'dismissed' }]] });
  const dismissed = await patch({});
  assert.equal(dismissed.statusCode, 200);
  assert.equal(calls[0].body.status, 'dismissed');
});

test('Deleting a note keeps the others, and a clash retries', async () => {
  let calls = mock({ notes: [{ id: 'keep', text: 'A' }, { id: 'drop', text: 'B' }] });
  await patch({ action: 'delete-note', note_id: 'drop' });
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body.notes.map((n) => n.id), ['keep']);
  calls = mock({ patchResults: [[], [{ id: ID }]] });
  assert.equal((await patch({ action: 'add-note', text: 'again' })).statusCode, 200);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2);
  mock({ patchResults: [[], [], []] });
  assert.equal((await patch({ action: 'add-note', text: 'never' })).statusCode, 409);
});

test('Adding a role to the pipeline copies its notes onto the new job', async () => {
  const notes = [{ id: 'n1', text: 'Dana can refer me', by: 'Garima', at: '2026-10-24T10:00:00Z' }];
  const calls = mock({ role: { id: ID, status: 'new', company: 'Ramp', title: 'BizOps', location: 'NYC', url: 'https://ramp.com/jobs/1', notes } });
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ id: ID, actor: 'Indresh' }) });
  assert.equal(res.statusCode, 201);
  const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/jobs')).body[0];
  assert.deepEqual(created.notes, notes);
  assert.equal(created.added_by, 'Indresh');
});

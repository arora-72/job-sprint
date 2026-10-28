const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const { handler } = require('../supabase/functions/companies/index.js');

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const patch = (body) => handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });
const post = (body) => handler({ httpMethod: 'POST', body: JSON.stringify({ added_by: 'Garima', ...body }) });

function mock({ row = { people: [], notes: [], updated_at: '2026-10-24T20:00:00.123456+00:00' }, patchResults, postError } = {}) {
  const calls = [];
  let patches = 0;
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET') return reply(url.includes('select=people') ? [row] : []);
    if (method === 'POST') return postError ? reply({ message: postError }, 409) : reply([{ id: ID, ...body[0] }], 201);
    if (method === 'PATCH') {
      const result = patchResults ? patchResults[patches] : [{ id: ID, ...body }];
      patches += 1;
      return reply(result);
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return calls;
}

test('Creating a company saves people and turns the remark into the first note', async () => {
  const calls = mock();
  const res = await post({
    name: '  Ramp  ', source: 'LinkedIn', remark: 'Saw their post about hiring',
    people: [{ name: 'Dana Lee', role: 'BizOps lead', link: 'linkedin.com/in/dana' }],
  });
  assert.equal(res.statusCode, 201);
  const row = calls[0].body[0];
  assert.equal(row.name, 'Ramp');
  assert.equal(row.source, 'LinkedIn');
  assert.equal(row.stage, undefined);
  assert.equal(row.people[0].link, 'https://linkedin.com/in/dana');
  assert.equal(row.people[0].status, 'not_contacted');
  assert.equal(row.notes[0].text, 'Saw their post about hiring');
  assert.equal(row.notes[0].by, 'Garima');
});

test('A company needs a name, a known person, and valid people', async () => {
  mock();
  assert.equal((await post({ name: '   ' })).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'POST', body: JSON.stringify({ name: 'Ramp' }) })).statusCode, 400);
  assert.equal((await post({ name: 'Ramp', people: [{ name: '' }] })).statusCode, 400);
  assert.equal((await post({ name: 'Ramp', people: [{ name: 'A', link: 'javascript:alert(1)' }] })).statusCode, 400);
});

test('Tracking the same company twice returns a clear 409', async () => {
  mock({ postError: 'duplicate key value violates unique constraint "companies_name_key_idx"' });
  const res = await post({ name: 'Ramp' });
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /already tracked/);
});

test('Stage changes only accept known stages and record who changed it', async () => {
  const calls = mock();
  assert.equal((await patch({ action: 'stage', stage: 'in_conversation' })).statusCode, 200);
  assert.equal(calls[0].body.stage, 'in_conversation');
  assert.equal(calls[0].body.stage_updated_by, 'Garima');
  assert.equal((await patch({ action: 'stage', stage: 'hired' })).statusCode, 400);
});

test('People can be added, updated, and removed', async () => {
  let calls = mock();
  const added = await patch({ action: 'add-person', person: { name: 'Sam Roe', role: 'Recruiter' } });
  assert.equal(added.statusCode, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.match(write.url, /updated_at=eq\./);
  assert.equal(write.body.people[0].name, 'Sam Roe');

  const row = { people: [{ id: 'p1', name: 'Sam', status: 'not_contacted' }, { id: 'p2', name: 'Kim' }], notes: [], updated_at: '2026-10-24T20:00:00Z' };
  calls = mock({ row });
  await patch({ action: 'update-person', person_id: 'p1', changes: { status: 'messaged' } });
  const people = calls.find((c) => c.method === 'PATCH').body.people;
  assert.equal(people[0].status, 'messaged');
  assert.equal(people[1].name, 'Kim');
  assert.equal((await patch({ action: 'update-person', person_id: 'p1', changes: { status: 'ghosted' } })).statusCode, 400);
  assert.equal((await patch({ action: 'update-person', person_id: 'nope', changes: { status: 'replied' } })).statusCode, 404);

  calls = mock({ row });
  await patch({ action: 'delete-person', person_id: 'p1' });
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body.people.map((p) => p.id), ['p2']);
});

test('Notes append with who and when, and bad notes are rejected', async () => {
  const calls = mock();
  const res = await patch({ action: 'add-note', text: '  Posted about a new GM role  ' });
  assert.equal(res.statusCode, 200);
  const note = calls.find((c) => c.method === 'PATCH').body.notes[0];
  assert.equal(note.text, 'Posted about a new GM role');
  assert.equal(note.by, 'Garima');
  assert.equal((await patch({ action: 'add-note', text: ' ' })).statusCode, 400);
  assert.equal((await patch({ action: 'add-note', text: 'x'.repeat(1001) })).statusCode, 400);
});

test('A write retries when the other person saved at the same moment, then gives up with 409', async () => {
  let calls = mock({ patchResults: [[], [{ id: ID }]] });
  assert.equal((await patch({ action: 'add-note', text: 'Second try' })).statusCode, 200);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2);
  calls = mock({ patchResults: [[], [], []] });
  assert.equal((await patch({ action: 'add-note', text: 'Never lands' })).statusCode, 409);
});

test('Delete removes the row, and a company cannot be renamed to nothing', async () => {
  const calls = mock();
  assert.equal((await patch({ action: 'delete' })).statusCode, 200);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal((await patch({ action: 'edit', name: ' ' })).statusCode, 400);
});

test('Every action needs a known person and a known action', async () => {
  mock();
  assert.equal((await handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, action: 'stage', stage: 'watching' }) })).statusCode, 400);
  assert.equal((await patch({ action: 'explode' })).statusCode, 400);
});

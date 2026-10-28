const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const { handler, isDay } = require('../netlify/functions/todos');

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const JOB = '0b3a6a3e-1111-4c0b-9d0a-3f0c2b9a7e22';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const patch = (body) => handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });
const post = (body) => handler({ httpMethod: 'POST', body: JSON.stringify({ added_by: 'Garima', ...body }) });

function mock({ patchResult } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET') return reply([]);
    if (method === 'POST') return reply([{ id: ID, ...body[0] }], 201);
    if (method === 'PATCH') return reply(patchResult === undefined ? [{ id: ID, ...body }] : patchResult);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return calls;
}

test('The list hides done items older than a week, ordered by position', async () => {
  const calls = mock();
  const res = await handler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 200);
  const url = decodeURIComponent(calls[0].url);
  assert.match(url, /or=\(done\.is\.false,done_at\.gte\.\d{4}-\d{2}-\d{2}T/);
  assert.match(url, /order=position\.asc/);
  const since = Date.parse(url.match(/gte\.([^)]+)\)/)[1]);
  assert.ok(Math.abs(Date.now() - 7 * 86400000 - since) < 5000);
});

test('Adding a to-do goes on your own list by default, with tidy text', async () => {
  const calls = mock();
  const res = await post({ text: '  Follow up   with Priya ', position: -3 });
  assert.equal(res.statusCode, 201);
  const row = calls[0].body[0];
  assert.equal(row.owner, 'Garima');
  assert.equal(row.added_by, 'Garima');
  assert.equal(row.text, 'Follow up with Priya');
  assert.equal(row.position, -3);
  assert.equal(row.link_kind, null);
  assert.equal(row.id, undefined);
});

test('You can add to the other person\'s list, with a link, a due date and your own id', async () => {
  const calls = mock();
  const res = await post({ owner: 'Indresh', text: 'Send me the Ramp contact', id: ID, due_on: '2026-10-30', link_kind: 'job', link_id: JOB, link_label: 'Ramp' });
  assert.equal(res.statusCode, 201);
  const row = calls[0].body[0];
  assert.deepEqual([row.owner, row.added_by, row.id, row.due_on, row.link_kind, row.link_id, row.link_label], ['Indresh', 'Garima', ID, '2026-10-30', 'job', JOB, 'Ramp']);
});

test('Bad to-dos are refused', async () => {
  mock();
  assert.equal((await post({ text: '   ' })).statusCode, 400);
  assert.equal((await post({ text: 'x'.repeat(501) })).statusCode, 400);
  assert.equal((await post({ text: 'ok', owner: 'Someone' })).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'POST', body: JSON.stringify({ text: 'ok' }) })).statusCode, 400);
  assert.equal((await post({ text: 'ok', position: 'top' })).statusCode, 400);
  assert.equal((await post({ text: 'ok', due_on: '2026-02-30' })).statusCode, 400);
  assert.equal((await post({ text: 'ok', link_kind: 'job' })).statusCode, 400);
  assert.equal((await post({ text: 'ok', link_kind: 'url', link_id: JOB })).statusCode, 400);
  assert.equal((await post({ text: 'ok', id: 'abc' })).statusCode, 400);
});

test('Ticking records who and when; unticking clears it and can set a new position', async () => {
  let calls = mock();
  let res = await patch({ action: 'toggle', done: true });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].body.done, true);
  assert.equal(calls[0].body.done_by, 'Garima');
  assert.ok(Date.parse(calls[0].body.done_at));
  calls = mock();
  res = await patch({ action: 'toggle', done: false, position: 9.5 });
  assert.deepEqual([calls[0].body.done, calls[0].body.done_at, calls[0].body.done_by, calls[0].body.position], [false, null, null, 9.5]);
  assert.equal((await patch({ action: 'toggle', done: 'yes' })).statusCode, 400);
});

test('Edit, move, move to the other list, due date and unlink', async () => {
  let calls = mock();
  await patch({ action: 'edit', text: ' New words ' });
  assert.equal(calls[0].body.text, 'New words');
  assert.equal((await patch({ action: 'edit', text: '' })).statusCode, 400);

  calls = mock();
  await patch({ action: 'move', position: 1.25 });
  assert.equal(calls[0].body.position, 1.25);
  assert.equal(calls[0].body.owner, undefined);
  calls = mock();
  await patch({ action: 'move', position: -1, owner: 'Indresh' });
  assert.equal(calls[0].body.owner, 'Indresh');
  assert.equal((await patch({ action: 'move', position: Infinity })).statusCode, 400);
  assert.equal((await patch({ action: 'move', position: 1, owner: 'Bob' })).statusCode, 400);

  calls = mock();
  await patch({ action: 'due', due_on: '2026-11-02' });
  assert.equal(calls[0].body.due_on, '2026-11-02');
  calls = mock();
  await patch({ action: 'due', due_on: null });
  assert.equal(calls[0].body.due_on, null);
  assert.equal((await patch({ action: 'due', due_on: 'tomorrow' })).statusCode, 400);

  calls = mock();
  await patch({ action: 'unlink' });
  assert.deepEqual([calls[0].body.link_kind, calls[0].body.link_id, calls[0].body.link_label], [null, null, null]);
});

test('Unknown people, ids and actions are refused; missing rows are 404', async () => {
  mock();
  assert.equal((await handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Eve', action: 'edit', text: 'x' }) })).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: 'x', actor: 'Garima', action: 'edit', text: 'x' }) })).statusCode, 400);
  assert.equal((await patch({ action: 'explode' })).statusCode, 400);
  mock({ patchResult: [] });
  assert.equal((await patch({ action: 'edit', text: 'x' })).statusCode, 404);
});

test('Delete removes the row; Undo restores only valid columns', async () => {
  let calls = mock();
  assert.equal((await patch({ action: 'delete' })).statusCode, 200);
  assert.equal(calls[0].method, 'DELETE');

  calls = mock();
  const snapshot = { id: ID, owner: 'Indresh', text: 'Prep stories', done: false, done_at: null, done_by: null, position: 2, due_on: '2026-10-30', link_kind: 'company', link_id: JOB, link_label: 'Notion', added_by: 'Garima', added_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:00Z', evil: 'drop table' };
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: snapshot }) });
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].body[0].evil, undefined);
  assert.equal(calls[0].body[0].owner, 'Indresh');
  const badRestore = (over) => handler({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: { ...snapshot, ...over } }) });
  assert.equal((await badRestore({ owner: 'Eve' })).statusCode, 400);
  assert.equal((await badRestore({ done: 'no' })).statusCode, 400);
  assert.equal((await badRestore({ position: null })).statusCode, 400);
  assert.equal((await badRestore({ link_id: 'nope' })).statusCode, 400);
});

test('Due dates must be real calendar days', () => {
  assert.equal(isDay('2026-10-31'), true);
  assert.equal(isDay('2028-02-29'), true);
  assert.equal(isDay('2026-02-29'), false);
  assert.equal(isDay('2026-13-01'), false);
  assert.equal(isDay('10/31/2026'), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const jobs = require('../supabase/functions/jobs/index.js').handler;

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const STAMP = '2026-10-27T10:00:00.000Z';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function mock({ row = { notes: [], status: 'pipeline', updated_at: STAMP }, patchResult } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: decodeURIComponent(url), method, body });
    if (method === 'GET') return reply(row ? [row] : []);
    if (method === 'PATCH') return reply(patchResult || [{ id: ID, ...body }]);
    if (method === 'POST') return reply([{ id: ID, ...body[0] }], 201);
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return calls;
}
const patch = (body) => jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });

test('Putting a job on hold saves the reason, who and when, and logs a note', async () => {
  const calls = mock();
  const res = await patch({ action: 'hold', hold_reason: '  Asked   for referral ' });
  assert.equal(res.statusCode, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.equal(write.body.hold_reason, 'Asked for referral');
  assert.equal(write.body.hold_by, 'Garima');
  assert.ok(Date.parse(write.body.hold_since));
  assert.equal(write.body.notes.length, 1);
  assert.equal(write.body.notes[0].text, 'On hold: Asked for referral');
  assert.match(write.url, new RegExp(`updated_at=eq.${STAMP.replace(/\./g, '\\.')}`));
  assert.equal(JSON.parse(res.body).note.text, 'On hold: Asked for referral');
});

test('Only To apply jobs can go on hold; bad reasons are refused', async () => {
  mock({ row: { notes: [], status: 'applied', updated_at: STAMP } });
  assert.equal((await patch({ action: 'hold', hold_reason: 'Referral' })).statusCode, 409);
  mock();
  assert.equal((await patch({ action: 'hold', hold_reason: '   ' })).statusCode, 400);
  assert.equal((await patch({ action: 'hold', hold_reason: 'x'.repeat(121) })).statusCode, 400);
  assert.equal((await patch({ action: 'hold' })).statusCode, 400);
  mock({ row: null });
  assert.equal((await patch({ action: 'hold', hold_reason: 'Referral' })).statusCode, 404);
});

test('Undo of Resume puts the old hold back without a new note', async () => {
  const calls = mock();
  const res = await patch({ action: 'hold', hold_reason: 'Coffee chats', restore: { since: STAMP, by: 'Indresh' } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].body.hold_reason, calls[0].body.hold_since, calls[0].body.hold_by, calls[0].body.notes], ['Coffee chats', STAMP, 'Indresh', undefined]);
  assert.match(calls[0].url, /status=eq\.pipeline/);
  mock();
  assert.equal((await patch({ action: 'hold', hold_reason: 'x', restore: { since: 'nope', by: 'Indresh' } })).statusCode, 400);
  assert.equal((await patch({ action: 'hold', hold_reason: 'x', restore: { since: STAMP, by: 'Eve' } })).statusCode, 400);
});

test('Resume clears the hold', async () => {
  const calls = mock();
  assert.equal((await patch({ action: 'unhold' })).statusCode, 200);
  assert.deepEqual([calls[0].body.hold_reason, calls[0].body.hold_since, calls[0].body.hold_by], [null, null, null]);
});

test('Undo of Delete keeps a valid hold and refuses a bad one', async () => {
  const row = { id: ID, company: 'Ramp', title: 'S&O', url: 'https://x.test/r', status: 'pipeline', added_by: 'Garima', added_at: STAMP, updated_at: STAMP, hold_reason: 'Asked for referral', hold_since: STAMP, hold_by: 'Garima' };
  let calls = mock();
  const res = await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: row }) });
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].body[0].hold_reason, 'Asked for referral');
  calls = mock();
  assert.equal((await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: { ...row, hold_by: 'Eve' } }) })).statusCode, 400);
  assert.equal((await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: { ...row, hold_since: 'soon' } }) })).statusCode, 400);
});

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const jobs = require('../supabase/functions/jobs/index.js').handler;

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const STAMP = '2026-10-20T10:00:00.000Z';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function mock({ interviewAt = null, patchResult } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: decodeURIComponent(url), method, body });
    if (method === 'GET') return reply([{ interview_at: interviewAt }]);
    if (method === 'PATCH') return reply(patchResult || [{ id: ID, ...body }]);
    if (method === 'POST') return reply([{ id: ID, ...body[0] }], 201);
    throw new Error(`Unexpected ${method}`);
  };
  return calls;
}
const patch = (body) => jobs({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', action: 'outcome', ...body }) });

test('Interview stamps who, when, and the first interview date', async () => {
  const calls = mock();
  const res = await patch({ outcome: 'interview' });
  assert.equal(res.statusCode, 200);
  const w = calls.find((c) => c.method === 'PATCH');
  assert.equal(w.body.outcome, 'interview');
  assert.equal(w.body.outcome_by, 'Garima');
  assert.ok(Date.parse(w.body.interview_at));
  assert.match(w.url, /status=neq\.pipeline/);
});

test('A later rejection keeps the interview date; an offer keeps the first interview date', async () => {
  let calls = mock({ interviewAt: STAMP });
  await patch({ outcome: 'rejected' });
  let w = calls.find((c) => c.method === 'PATCH');
  assert.equal(w.body.outcome, 'rejected');
  assert.equal(w.body.interview_at, undefined);
  calls = mock({ interviewAt: STAMP });
  await patch({ outcome: 'offer' });
  w = calls.find((c) => c.method === 'PATCH');
  assert.equal(w.body.interview_at, undefined, 'already set, left alone');
});

test('Clearing and Undo restore exact values; bad values and To apply jobs are refused', async () => {
  let calls = mock();
  await patch({ outcome: null });
  assert.deepEqual([calls[0].body.outcome, calls[0].body.outcome_at, calls[0].body.outcome_by], [null, null, null]);
  calls = mock();
  await patch({ outcome: 'interview', restore: { outcome_at: STAMP, outcome_by: 'Indresh', interview_at: STAMP } });
  assert.deepEqual([calls[0].body.outcome_at, calls[0].body.outcome_by, calls[0].body.interview_at], [STAMP, 'Indresh', STAMP]);
  mock();
  assert.equal((await patch({ outcome: 'hired' })).statusCode, 400);
  assert.equal((await patch({ outcome: 'offer', restore: { outcome_at: 'x', outcome_by: null, interview_at: null } })).statusCode, 400);
  mock({ patchResult: [] });
  assert.equal((await patch({ outcome: 'interview' })).statusCode, 409);
});

test('Undo of Delete keeps a valid outcome', async () => {
  const row = { id: ID, company: 'Ramp', title: 'S&O', url: 'https://x.test/r', status: 'applied', added_by: 'Garima', added_at: STAMP, updated_at: STAMP, outcome: 'offer', outcome_at: STAMP, outcome_by: 'Garima', interview_at: STAMP };
  let calls = mock();
  assert.equal((await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: row }) })).statusCode, 201);
  assert.equal(calls[0].body[0].outcome, 'offer');
  mock();
  assert.equal((await jobs({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', restore: { ...row, outcome: 'hired' } }) })).statusCode, 400);
});

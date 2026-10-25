const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const { handler } = require('../netlify/functions/jobs');

const JOB_ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const patch = (body) => handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: JOB_ID, actor: 'Garima', ...body }) });

// Records every request and answers PATCHes by echoing the patch back as the saved row.
function mockSupabase({ rows = [{ notes: [], updated_at: '2026-10-24T20:00:00.123456+00:00' }], patchResults } = {}) {
  const calls = [];
  let patchCount = 0;
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET') return reply(rows);
    if (method === 'PATCH') {
      const result = patchResults ? patchResults[patchCount] : [{ id: JOB_ID, ...body }];
      patchCount += 1;
      return reply(result);
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  return calls;
}

test('Marking a job applied starts it in Networking as not networked', async () => {
  const calls = mockSupabase();
  const result = await patch({ status: 'applied' });
  assert.equal(result.statusCode, 200);
  const saved = calls[0].body;
  assert.equal(saved.status, 'applied');
  assert.equal(saved.applied_by, 'Garima');
  assert.equal(saved.network_status, 'not_networked');
  assert.equal(saved.network_closed_at, null);
});

test('The old request shape without an action still works', async () => {
  mockSupabase();
  const blocked = await patch({ status: 'blocked', blocked_reason: 'Needs referral' });
  assert.equal(blocked.statusCode, 200);
  const invalid = await patch({ status: 'hired' });
  assert.equal(invalid.statusCode, 400);
});

test('Moving back to To apply clears applied, blocked, and networking details', async () => {
  const calls = mockSupabase();
  await patch({ status: 'pipeline' });
  const saved = calls[0].body;
  for (const key of ['applied_at', 'blocked_at', 'network_status', 'network_closed_at']) assert.equal(saved[key], null);
});

test('Networking status only changes applied jobs and records who changed it', async () => {
  const calls = mockSupabase();
  const result = await patch({ action: 'network', network_status: 'first_pass' });
  assert.equal(result.statusCode, 200);
  assert.match(calls[0].url, /status=eq\.applied/);
  assert.equal(calls[0].body.network_status, 'first_pass');
  assert.equal(calls[0].body.network_updated_by, 'Garima');

  const invalid = await patch({ action: 'network', network_status: 'third_pass' });
  assert.equal(invalid.statusCode, 400);

  mockSupabase({ patchResults: [[]] });
  const notApplied = await patch({ action: 'network', network_status: 'stale' });
  assert.equal(notApplied.statusCode, 409);
});

test('Undoing a networking change restores the previous update stamp', async () => {
  const calls = mockSupabase();
  await patch({ action: 'network', network_status: 'not_networked', restore: { by: null, at: null } });
  assert.equal(calls[0].body.network_updated_by, null);
  assert.equal(calls[0].body.network_updated_at, null);
  const bad = await patch({ action: 'network', network_status: 'first_pass', restore: { by: 'Someone', at: 'later' } });
  assert.equal(bad.statusCode, 400);
});

test('Done moves a job to History and reopen brings it back', async () => {
  let calls = mockSupabase();
  await patch({ action: 'close' });
  assert.equal(calls[0].body.network_closed_by, 'Garima');
  assert.ok(calls[0].body.network_closed_at);
  calls = mockSupabase();
  await patch({ action: 'reopen' });
  assert.equal(calls[0].body.network_closed_at, null);
});

test('Notes are appended with who and when, and empty or long notes are rejected', async () => {
  const calls = mockSupabase({ rows: [{ notes: [{ id: 'a', text: 'Earlier', by: 'Indresh', at: '2026-10-24T10:00:00Z' }], updated_at: '2026-10-24T20:00:00.123456+00:00' }] });
  const result = await patch({ action: 'add-note', text: '  Messaged the hiring manager  ' });
  assert.equal(result.statusCode, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.match(write.url, /updated_at=eq\.2026-10-24T20%3A00%3A00\.123456%2B00%3A00/);
  assert.equal(write.body.notes.length, 2);
  assert.equal(write.body.notes[1].text, 'Messaged the hiring manager');
  assert.equal(write.body.notes[1].by, 'Garima');

  assert.equal((await patch({ action: 'add-note', text: '   ' })).statusCode, 400);
  assert.equal((await patch({ action: 'add-note', text: 'x'.repeat(1001) })).statusCode, 400);
});

test('A note write retries when the other person saved at the same moment', async () => {
  const calls = mockSupabase({ patchResults: [[], [{ id: JOB_ID, notes: [] }]] });
  const result = await patch({ action: 'add-note', text: 'Second try' });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2);
});

test('Deleting a note removes only that note', async () => {
  const calls = mockSupabase({ rows: [{ notes: [{ id: 'keep', text: 'A' }, { id: 'drop', text: 'B' }], updated_at: '2026-10-24T20:00:00Z' }] });
  const result = await patch({ action: 'delete-note', note_id: 'drop' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body.notes.map((n) => n.id), ['keep']);
});

test('Actions need a known person and a known action', async () => {
  mockSupabase();
  const noActor = await handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: JOB_ID, status: 'applied' }) });
  assert.equal(noActor.statusCode, 400);
  assert.equal((await patch({ action: 'delete-everything' })).statusCode, 400);
});

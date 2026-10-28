const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
process.env.DISCOVER_INGEST_TOKEN = 'test-import-token';
const { handler } = require('../supabase/functions/discover/index.js');
const { sourceKey } = require('../supabase/functions/_shared/job-url.js');

const role = {
  id: 'b6abf7c3-28b8-46b6-84f4-223e3cad44f8',
  company: 'Example', title: 'Strategy Lead', location: 'New York',
  url: 'https://jobs.example.com/123?utm_source=watch', fit_tier: 'A', fit_score: 94,
  why_fit: 'Relevant strategy work', found_at: '2026-10-24', status: 'new',
};
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('Discover hides jobs already in Pipeline or History, ignoring tracking parameters', async () => {
  global.fetch = async (url) => {
    if (url.includes('/discover_jobs?')) return reply([role]);
    if (url.includes('/jobs?')) return reply([{ url: 'https://jobs.example.com/123' }]);
    throw new Error(`Unexpected request ${url}`);
  };
  const result = await handler({ httpMethod: 'GET' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body).roles, []);
});

test('Add to Pipeline creates a normal job and marks the match added', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (url.includes('/discover_jobs?id=') && options.method === 'GET') return reply([role]);
    if (url.includes('/jobs?')) return reply([]);
    if (url.endsWith('/jobs') && options.method === 'POST') return reply([{ id: 'new-job', ...JSON.parse(options.body)[0] }], 201);
    if (url.includes('/discover_jobs?id=') && options.method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error(`Unexpected request ${url}`);
  };
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ id: role.id, actor: 'Garima' }) });
  assert.equal(result.statusCode, 201);
  assert.equal(calls.find((call) => call.method === 'POST').body[0].added_by, 'Garima');
  assert.equal(calls.find((call) => call.method === 'PATCH').body.status, 'added');
});

test('Import requires its token and accepts only S or A matches', async () => {
  const unauthorized = await handler({ httpMethod: 'PUT', headers: {}, body: JSON.stringify({ roles: [role] }) });
  assert.equal(unauthorized.statusCode, 401);
  const invalid = await handler({
    httpMethod: 'PUT', headers: { authorization: 'Bearer test-import-token' },
    body: JSON.stringify({ roles: [{ ...role, fit_tier: 'B' }] }),
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(sourceKey(role.url), sourceKey('https://jobs.example.com/123'));
});

test('Dismiss records who reviewed the role', async () => {
  let saved;
  global.fetch = async (url, options) => {
    if (url.includes('/discover_jobs?id=') && options.method === 'PATCH') {
      saved = JSON.parse(options.body);
      return reply([{ ...role, ...saved }]);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const result = await handler({ httpMethod: 'PATCH', body: JSON.stringify({ id: role.id, actor: 'Indresh' }) });
  assert.equal(result.statusCode, 200);
  assert.equal(saved.status, 'dismissed');
  assert.equal(saved.acted_by, 'Indresh');
});

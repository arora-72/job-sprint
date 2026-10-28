const test = require('node:test');
const assert = require('node:assert/strict');

const { toResponse, corsHeaders } = require('../supabase/functions/_shared/serve.js');

const echo = async (event) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });

test('Preflight from the GitHub Pages site gets CORS headers and no body', async () => {
  const res = await toResponse(echo, new Request('https://x.supabase.co/functions/v1/jobs', { method: 'OPTIONS', headers: { origin: 'https://arora-72.github.io' } }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://arora-72.github.io');
  assert.match(res.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(res.headers.get('access-control-allow-headers'), /content-type/);
});

test('Other websites are not allowed to read responses', () => {
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], 'https://arora-72.github.io');
  assert.equal(corsHeaders('http://localhost:8080')['Access-Control-Allow-Origin'], 'http://localhost:8080');
  assert.equal(corsHeaders(null)['Access-Control-Allow-Origin'], 'https://arora-72.github.io');
});

test('Requests become the same event the handlers were written for', async () => {
  const res = await toResponse(echo, new Request('https://x.supabase.co/functions/v1/discover?a=1', {
    method: 'PUT', headers: { origin: 'https://arora-72.github.io', Authorization: 'Bearer t', 'content-type': 'application/json' }, body: '{"roles":[]}',
  }));
  const event = await res.json();
  assert.equal(event.httpMethod, 'PUT');
  assert.equal(event.body, '{"roles":[]}');
  assert.equal(event.headers.authorization, 'Bearer t');
  assert.deepEqual(event.queryStringParameters, { a: '1' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://arora-72.github.io');
  const get = await (await toResponse(echo, new Request('https://x.supabase.co/functions/v1/jobs'))).json();
  assert.equal(get.body, null);
});

test('A crash returns JSON 500 with CORS so the page can show the error', async () => {
  const res = await toResponse(async () => { throw new Error('boom'); }, new Request('https://x/functions/v1/jobs', { headers: { origin: 'https://arora-72.github.io' } }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'boom' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://arora-72.github.io');
});

test('Server key: custom key first, then the modern secret key, then the legacy one; legacy also goes in Authorization', async () => {
  const { supabase } = require('../supabase/functions/_shared/supabase.js');
  const seen = [];
  global.fetch = async (url, opts) => { seen.push(opts.headers); return new Response('[]', { status: 200 }); };
  const saved = { ...process.env };
  try {
    process.env.SUPABASE_URL = 'https://db.test';
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: 'sb_secret_abc' });
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJlegacy';
    await supabase('jobs');
    assert.equal(seen[0].apikey, 'sb_secret_abc');
    assert.equal(seen[0].Authorization, undefined);
    delete process.env.SUPABASE_SECRET_KEYS;
    await supabase('jobs');
    assert.equal(seen[1].apikey, 'eyJlegacy');
    assert.equal(seen[1].Authorization, 'Bearer eyJlegacy');
    process.env.SUPABASE_SECRET_KEY = 'custom';
    await supabase('jobs');
    assert.equal(seen[2].apikey, 'custom');
  } finally {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

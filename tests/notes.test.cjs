const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only';
const notes = require('../supabase/functions/notes/index.js').handler;
const { cleanHtml, htmlText } = require('../supabase/functions/_shared/clean-html.js');

const ID = '6f1c1a8e-8d55-4c0b-9d0a-3f0c2b9a7e11';
const JOB = '0b3a6a3e-1111-4c0b-9d0a-3f0c2b9a7e22';
const BASE = '2026-11-01T10:00:00.000Z';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function mock({ patchResult, current } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: decodeURIComponent(url), method, body });
    if (method === 'GET') return reply(current ? [current] : []);
    if (method === 'POST') return reply(body, 201);
    if (method === 'PATCH') return reply(patchResult === undefined ? [{ id: ID, ...body }] : patchResult);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected ${method}`);
  };
  return calls;
}
const post = (body) => notes({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Garima', ...body }) });
const patch = (body) => notes({ httpMethod: 'PATCH', body: JSON.stringify({ id: ID, actor: 'Garima', ...body }) });

test('The cleaner keeps simple formatting and checklists', () => {
  const html = '<h2>Prep</h2><p>Hi <b>there</b> <i>you</i></p><ul data-type="todo"><li data-checked="true">Done</li><li>Next</li></ul><ol><li>One</li></ol><a href="https://ramp.com/x?a=1&b=2">Ramp</a>';
  assert.equal(cleanHtml(html), '<h2>Prep</h2><p>Hi <strong>there</strong> <em>you</em></p><ul data-type="todo"><li data-checked="true">Done</li><li>Next</li></ul><ol><li>One</li></ol><a href="https://ramp.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Ramp</a>');
});

test('The cleaner removes anything dangerous', () => {
  const evil = [
    '<script>alert(1)</script>ok',
    '<img src=x onerror=alert(1)>ok',
    '<p onclick="alert(1)" style="color:red">ok</p>',
    '<a href="javascript:alert(1)">ok</a>',
    '<a href="java\tscript:alert(1)">ok</a>',
    '<a href=" JaVaScRiPt:alert(1)">ok</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">ok</a>',
    '<svg><script>alert(1)</script></svg>ok',
    '<iframe src="https://evil"></iframe>ok',
    '<style>body{display:none}</style>ok',
    '<<script>script>alert(1)<</script>/script>ok',
    '<div><p>ok',
  ];
  for (const e of evil) {
    const out = cleanHtml(e);
    assert.doesNotMatch(out, /<script|onerror|onclick|javascript:|<img|<iframe|<svg|<style|style=|data:/i, `${e} -> ${out}`);
    assert.match(htmlText(out), /ok/, e);
  }
  assert.equal(cleanHtml('<div><p>ok'), '<p><p>ok</p></p>', 'unclosed tags get closed');
  assert.equal(cleanHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
});

test('New notes are cleaned, owned and stamped', async () => {
  const calls = mock();
  const res = await post({ title: '  Ramp   prep ', body: '<p>Hi<script>x</script></p>', color: 'mint', labels: ['Interview prep', 'interview prep', ' Ramp '], link_kind: 'job', link_id: JOB, link_label: 'Ramp' });
  assert.equal(res.statusCode, 201);
  const row = calls[0].body[0];
  assert.deepEqual([row.title, row.body, row.color, row.labels, row.created_by, row.updated_by, row.link_id], ['Ramp prep', '<p>Hi</p>', 'mint', ['Interview prep', 'Ramp'], 'Garima', 'Garima', JOB]);
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  mock();
  assert.equal((await post({ color: 'neon' })).statusCode, 400);
  assert.equal((await post({ labels: 'x' })).statusCode, 400);
  assert.equal((await post({ link_kind: 'job', link_id: 'nope' })).statusCode, 400);
  assert.equal((await notes({ httpMethod: 'POST', body: JSON.stringify({ actor: 'Eve' }) })).statusCode, 400);
});

test('Saves only land on the version they started from; a clash returns the other version', async () => {
  let calls = mock();
  let res = await patch({ action: 'save', base: BASE, title: 'T', body: '<p>x</p>' });
  assert.equal(res.statusCode, 200);
  assert.match(calls[0].url, new RegExp(`updated_at=eq.${BASE.replace(/\./g, '\\.')}`));
  assert.match(calls[0].url, /deleted_at=is\.null/);
  assert.equal(calls[0].body.updated_by, 'Garima');
  const theirs = { id: ID, title: 'Theirs', body: '<p>y</p>', updated_by: 'Indresh', updated_at: '2026-11-02T10:00:00.000Z', deleted_at: null };
  mock({ patchResult: [], current: theirs });
  res = await patch({ action: 'save', base: BASE, title: 'Mine' });
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).note.title, 'Theirs');
  assert.match(JSON.parse(res.body).error, /Indresh/);
  calls = mock();
  res = await patch({ action: 'save', force: true, title: 'Mine' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(calls[0].url, /updated_at=eq/);
  mock({ patchResult: [], current: { ...theirs, deleted_at: BASE } });
  assert.equal((await patch({ action: 'save', base: BASE, title: 'x' })).statusCode, 410);
  mock();
  assert.equal((await patch({ action: 'save', title: 'x' })).statusCode, 400, 'needs a base version');
});

test('Pin, colour, labels, link, trash, restore and delete forever', async () => {
  let calls = mock();
  await patch({ action: 'pin', pinned: true });
  assert.deepEqual(calls[0].body, { pinned: true });
  calls = mock(); await patch({ action: 'color', color: 'sky' }); assert.equal(calls[0].body.color, 'sky');
  calls = mock(); await patch({ action: 'labels', labels: ['A', 'a', 'B'] }); assert.deepEqual(calls[0].body.labels, ['A', 'B']);
  calls = mock(); await patch({ action: 'link', link_kind: null }); assert.equal(calls[0].body.link_id, null);
  calls = mock(); await patch({ action: 'delete' }); assert.ok(Date.parse(calls[0].body.deleted_at));
  calls = mock(); await patch({ action: 'restore' }); assert.equal(calls[0].body.deleted_at, null);
  calls = mock(); await patch({ action: 'purge' }); assert.equal(calls[0].method, 'DELETE'); assert.match(calls[0].url, /deleted_at=not\.is\.null/);
  mock();
  assert.equal((await patch({ action: 'pin', pinned: 'yes' })).statusCode, 400);
  assert.equal((await patch({ action: 'color', color: 'neon' })).statusCode, 400);
  assert.equal((await patch({ action: 'explode' })).statusCode, 400);
});

test('Listing clears Trash older than 30 days first', async () => {
  const calls = mock();
  const res = await notes({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].method, 'DELETE');
  const cutoff = Date.parse(calls[0].url.match(/deleted_at=lt\.([^&]+)/)[1]);
  assert.ok(Math.abs(Date.now() - 30 * 86400000 - cutoff) < 5000);
});

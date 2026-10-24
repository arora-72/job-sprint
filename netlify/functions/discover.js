const { supabase } = require('./_supabase');
const { normalizeJobUrl, sourceKey } = require('./_job-url');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});
const validActor = (name) => ['Garima', 'Indresh'].includes(name);
const validId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
const date = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

async function getQueue() {
  const [discover, jobs] = await Promise.all([
    supabase('discover_jobs?select=*&status=eq.new&order=fit_score.desc.nullslast,found_at.desc&limit=200'),
    supabase('jobs?select=url'),
  ]);
  const seen = new Set(jobs.map((job) => {
    try { return normalizeJobUrl(job.url); } catch { return job.url; }
  }));
  return discover.filter((role) => {
    try { return !seen.has(normalizeJobUrl(role.url)); } catch { return false; }
  });
}

async function addToPipeline(id, actor) {
  const found = await supabase(`discover_jobs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  const role = found[0];
  if (!role) return json(404, { error: 'This role was not found.' });
  if (role.status === 'added') return json(409, { error: 'This role is already in the pipeline.' });
  if (role.status === 'dismissed') return json(409, { error: 'This role was dismissed. Refresh Discover.' });

  const jobs = await supabase('jobs?select=id,url');
  const key = normalizeJobUrl(role.url);
  if (jobs.some((job) => {
    try { return normalizeJobUrl(job.url) === key; } catch { return false; }
  })) return json(409, { error: 'This job is already in Pipeline or History.' });

  const created = await supabase('jobs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{ company: role.company, title: role.title, location: role.location, url: role.url, added_by: actor, status: 'pipeline' }],
  });
  const job = created[0];
  await supabase(`discover_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status: 'added', acted_by: actor, acted_at: new Date().toISOString(), pipeline_job_id: job.id, updated_at: new Date().toISOString() },
  });
  return json(201, { job });
}

function cleanRole(input) {
  if (!input || !['S', 'A'].includes(input.fit_tier)) throw new Error('Only S and A roles can enter Discover.');
  const company = String(input.company || '').trim().slice(0, 160);
  const title = String(input.title || '').trim().slice(0, 240);
  const location = String(input.location || '').trim().slice(0, 200);
  const url = String(input.url || '').trim();
  if (!company || !title || !url) throw new Error('Company, title, and official job link are required.');
  normalizeJobUrl(url);
  const score = input.fit_score == null ? null : Number(input.fit_score);
  if (score != null && (!Number.isInteger(score) || score < 0 || score > 100)) throw new Error('Fit score must be between 0 and 100.');
  const foundAt = input.found_at || new Date().toISOString().slice(0, 10);
  if (!date(foundAt) || (input.posted_at && !date(input.posted_at))) throw new Error('Use YYYY-MM-DD for dates.');
  return {
    source_key: sourceKey(url), company, title, location, url,
    fit_tier: input.fit_tier, fit_score: score,
    why_fit: String(input.why_fit || '').trim().slice(0, 1800),
    found_at: foundAt, posted_at: input.posted_at || null,
    source_name: String(input.source_name || 'Role watch').trim().slice(0, 100),
  };
}

async function ingest(event) {
  const expected = process.env.DISCOVER_INGEST_TOKEN;
  const authorization = event.headers?.authorization || event.headers?.Authorization;
  if (!expected || authorization !== `Bearer ${expected}`) return json(401, { error: 'Import is not authorized.' });
  const data = JSON.parse(event.body || '{}');
  if (!Array.isArray(data.roles) || data.roles.length < 1 || data.roles.length > 30) return json(400, { error: 'Send 1–30 roles.' });
  let roles;
  try { roles = data.roles.map(cleanRole); }
  catch (error) { return json(400, { error: error.message }); }
  let created = 0;
  let updated = 0;
  for (const role of roles) {
    const existing = await supabase(`discover_jobs?source_key=eq.${role.source_key}&select=id&limit=1`);
    if (existing.length) {
      await supabase(`discover_jobs?id=eq.${existing[0].id}`, {
        method: 'PATCH', body: { ...role, updated_at: new Date().toISOString() },
      });
      updated += 1;
    } else {
      await supabase('discover_jobs', { method: 'POST', body: [role] });
      created += 1;
    }
  }
  return json(200, { created, updated });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') return json(200, { roles: await getQueue() });
    if (event.httpMethod === 'PUT') return await ingest(event);
    if (event.httpMethod === 'POST' || event.httpMethod === 'PATCH') {
      const { id, actor } = JSON.parse(event.body || '{}');
      if (!validId(id) || !validActor(actor)) return json(400, { error: 'Invalid role or name.' });
      if (event.httpMethod === 'POST') return await addToPipeline(id, actor);
      const updated = await supabase(`discover_jobs?id=eq.${encodeURIComponent(id)}&status=eq.new`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: { status: 'dismissed', acted_by: actor, acted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      });
      if (!updated.length) return json(409, { error: 'This role is no longer in Discover.' });
      return json(200, { role: updated[0] });
    }
    return json(405, { error: 'Method not allowed.' });
  } catch (error) {
    return json(error instanceof SyntaxError ? 400 : 500, { error: error.message || 'Server error.' });
  }
};

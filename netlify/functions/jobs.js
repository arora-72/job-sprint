const { supabase } = require('./_supabase');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const jobs = await supabase('jobs?select=*&order=added_at.desc');
      return json(200, { jobs });
    }

    if (event.httpMethod === 'POST') {
      const { company, title, location = '', url, added_by } = JSON.parse(event.body || '{}');
      if (!company || !title || !url || !['Garima', 'Indresh'].includes(added_by)) return json(400, { error: 'Missing required job details.' });
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Unsupported link');
      } catch {
        return json(400, { error: 'Use a valid http or https job link.' });
      }
      const created = await supabase('jobs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: [{ company, title, location, url, added_by, status: 'pipeline' }],
      });
      return json(201, { job: created?.[0] });
    }

    if (event.httpMethod === 'PATCH') {
      const { id, status, actor, blocked_reason = '' } = JSON.parse(event.body || '{}');
      if (!id || !['applied', 'blocked', 'pipeline'].includes(status) || !['Garima', 'Indresh'].includes(actor)) return json(400, { error: 'Invalid update.' });

      const now = new Date().toISOString();
      let patch;
      if (status === 'applied') patch = { status, applied_by: actor, applied_at: now, updated_at: now };
      else if (status === 'blocked') patch = { status, blocked_by: actor, blocked_at: now, blocked_reason: String(blocked_reason).slice(0, 500), updated_at: now };
      // Undo / move back: return the job to the open queue and clear completion fields.
      else patch = { status, applied_by: null, applied_at: null, blocked_by: null, blocked_at: null, blocked_reason: '', updated_at: now };

      const updated = await supabase(`jobs?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: patch,
      });
      return json(200, { job: updated?.[0] });
    }

    return json(405, { error: 'Method not allowed.' });
  } catch (err) {
    return json(500, { error: err.message || 'Server error.' });
  }
};

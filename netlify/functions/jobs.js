const crypto = require('crypto');
const { supabase } = require('./_supabase');

const USERS = ['Garima', 'Indresh'];
const NETWORK_STATUSES = ['not_networked', 'first_pass', 'second_pass', 'successful', 'stale'];
const NOTE_MAX_CHARS = 1000;
const NOTE_MAX_COUNT = 200;
const NOTE_RETRIES = 3;

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const bad = (message) => json(400, { error: message });
const byId = (id) => `jobs?id=eq.${encodeURIComponent(id)}`;

const CLEARED_NETWORK = {
  network_status: null, network_updated_by: null, network_updated_at: null,
  network_closed_by: null, network_closed_at: null,
};

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

async function patchJob(path, patch) {
  const updated = await supabase(path, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  return updated?.[0] || null;
}

// Pipeline status: pipeline -> applied (enters Networking) or blocked (goes to History).
function statusPatch({ status, actor, blocked_reason = '' }, now) {
  if (status === 'applied') {
    return {
      status, applied_by: actor, applied_at: now,
      ...CLEARED_NETWORK, network_status: 'not_networked',
      updated_at: now,
    };
  }
  if (status === 'blocked') {
    return {
      status, blocked_by: actor, blocked_at: now, blocked_reason: String(blocked_reason).slice(0, 500),
      ...CLEARED_NETWORK, updated_at: now,
    };
  }
  // Undo / move back: return the job to To apply and clear everything after it.
  return {
    status, applied_by: null, applied_at: null, blocked_by: null, blocked_at: null, blocked_reason: '',
    ...CLEARED_NETWORK, updated_at: now,
  };
}

// Notes are a JSON array on the job. Two people can add notes at the same moment, so writes
// only succeed if the row hasn't changed since it was read, and retry otherwise.
async function updateNotes(id, change) {
  for (let attempt = 0; attempt < NOTE_RETRIES; attempt += 1) {
    const rows = await supabase(`${byId(id)}&select=notes,updated_at`);
    const current = rows?.[0];
    if (!current) return { error: json(404, { error: 'Job not found.' }) };
    const notes = Array.isArray(current.notes) ? current.notes : [];
    const next = change(notes);
    if (next.error) return next;
    const now = new Date().toISOString();
    const job = await patchJob(`${byId(id)}&updated_at=eq.${encodeURIComponent(current.updated_at)}`, { notes: next.notes, updated_at: now });
    if (job) return { job };
  }
  return { error: json(409, { error: 'Someone else just edited this job. Try again.' }) };
}

async function handlePatch(body) {
  const { id, actor } = body;
  const action = body.action || 'status';
  if (!id || typeof id !== 'string') return bad('Missing job.');
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');
  const now = new Date().toISOString();

  if (action === 'status') {
    if (!['applied', 'blocked', 'pipeline'].includes(body.status)) return bad('Invalid update.');
    return json(200, { job: await patchJob(byId(id), statusPatch(body, now)) });
  }

  if (action === 'network') {
    if (!NETWORK_STATUSES.includes(body.network_status)) return bad('Invalid networking status.');
    let touchedBy = actor;
    let touchedAt = now;
    // Undo restores the previous "last updated" stamp so the days-since badge stays honest.
    if (body.restore) {
      const { by = null, at = null } = body.restore;
      if ((by !== null && !USERS.includes(by)) || (at !== null && !isIsoDate(at))) return bad('Invalid undo.');
      touchedBy = by;
      touchedAt = at;
    }
    const job = await patchJob(`${byId(id)}&status=eq.applied`, {
      network_status: body.network_status, network_updated_by: touchedBy, network_updated_at: touchedAt, updated_at: now,
    });
    return job ? json(200, { job }) : json(409, { error: 'This job is no longer in Networking.' });
  }

  if (action === 'close') {
    const job = await patchJob(`${byId(id)}&status=eq.applied`, { network_closed_by: actor, network_closed_at: now, updated_at: now });
    return job ? json(200, { job }) : json(409, { error: 'Only applied jobs can be moved from Networking to History.' });
  }

  if (action === 'reopen') {
    const job = await patchJob(`${byId(id)}&status=eq.applied`, { network_closed_by: null, network_closed_at: null, updated_at: now });
    return job ? json(200, { job }) : json(409, { error: 'Only applied jobs can go back to Networking.' });
  }

  if (action === 'add-note') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return bad('Write a note first.');
    if (text.length > NOTE_MAX_CHARS) return bad(`Notes can be up to ${NOTE_MAX_CHARS} characters.`);
    const note = { id: crypto.randomUUID(), text, by: actor, at: now };
    const result = await updateNotes(id, (notes) => (notes.length >= NOTE_MAX_COUNT
      ? { error: bad('This job has too many notes.') }
      : { notes: [...notes, note] }));
    return result.error || json(200, { job: result.job, note });
  }

  if (action === 'delete-note') {
    if (!body.note_id || typeof body.note_id !== 'string') return bad('Missing note.');
    const result = await updateNotes(id, (notes) => ({ notes: notes.filter((n) => n && n.id !== body.note_id) }));
    return result.error || json(200, { job: result.job });
  }

  return bad('Unknown action.');
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const jobs = await supabase('jobs?select=*&order=added_at.desc');
      return json(200, { jobs });
    }

    if (event.httpMethod === 'POST') {
      const { company, title, location = '', url, added_by } = JSON.parse(event.body || '{}');
      if (!company || !title || !url || !USERS.includes(added_by)) return bad('Missing required job details.');
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Unsupported link');
      } catch {
        return bad('Use a valid http or https job link.');
      }
      const created = await supabase('jobs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: [{ company, title, location, url, added_by, status: 'pipeline' }],
      });
      return json(201, { job: created?.[0] });
    }

    if (event.httpMethod === 'PATCH') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return bad('Invalid request.'); }
      return await handlePatch(body);
    }

    return json(405, { error: 'Method not allowed.' });
  } catch (err) {
    return json(500, { error: err.message || 'Server error.' });
  }
};

exports.NETWORK_STATUSES = NETWORK_STATUSES;

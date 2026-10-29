import { supabase } from '../_shared/supabase.js';

const USERS = ['Garima', 'Indresh'];
const NETWORK_STATUSES = ['not_networked', 'first_pass', 'second_pass', 'successful', 'stale'];
const NOTE_MAX_CHARS = 1000;
const NOTE_MAX_COUNT = 200;
const NOTE_RETRIES = 3;
const HOLD_REASON_MAX = 120;

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const bad = (message) => json(400, { error: message });
const byId = (id) => `jobs?id=eq.${encodeURIComponent(id)}`;

const CLEARED_NETWORK = {
  network_status: null, network_updated_by: null, network_updated_at: null,
  network_closed_by: null, network_closed_at: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_COLUMNS = ['id', 'company', 'title', 'location', 'url', 'status', 'added_by', 'added_at', 'applied_by', 'applied_at',
  'blocked_by', 'blocked_at', 'blocked_reason', 'assigned_to', 'network_status', 'network_updated_by', 'network_updated_at',
  'network_closed_by', 'network_closed_at', 'notes', 'priority', 'hold_reason', 'hold_since', 'hold_by', 'updated_at'];

const isPriority = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12;

// Undo for Delete: the browser sends the deleted row back. Only known columns, each checked.
function cleanRestoredJob(row) {
  if (!row || typeof row !== 'object') return { error: 'Nothing to restore.' };
  const out = {};
  for (const key of JOB_COLUMNS) if (row[key] !== undefined) out[key] = row[key];
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  const who = (v) => v === null || v === undefined || USERS.includes(v);
  const when = (v) => v === null || v === undefined || isIsoDate(v);
  if (!UUID.test(out.id || '')) return { error: 'Invalid job id.' };
  if (!str(out.company, 300) || !out.company.trim() || !str(out.title, 500) || !out.title.trim()) return { error: 'Invalid job details.' };
  try { if (!['http:', 'https:'].includes(new URL(out.url).protocol)) throw new Error('x'); } catch { return { error: 'Invalid job link.' }; }
  if (!['pipeline', 'applied', 'blocked'].includes(out.status)) return { error: 'Invalid job status.' };
  if (!USERS.includes(out.added_by)) return { error: 'Invalid job owner.' };
  if (!['assigned_to', 'applied_by', 'blocked_by', 'network_updated_by', 'network_closed_by'].every((k) => who(out[k]))) return { error: 'Invalid person.' };
  if (!['added_at', 'applied_at', 'blocked_at', 'network_updated_at', 'network_closed_at', 'updated_at'].every((k) => when(out[k]))) return { error: 'Invalid date.' };
  if (out.network_status != null && !NETWORK_STATUSES.includes(out.network_status)) return { error: 'Invalid networking status.' };
  if (out.location !== undefined && !str(out.location, 300)) return { error: 'Invalid location.' };
  if (out.blocked_reason !== undefined && !str(out.blocked_reason, 500)) return { error: 'Invalid reason.' };
  if (out.notes !== undefined && (!Array.isArray(out.notes) || out.notes.length > NOTE_MAX_COUNT)) return { error: 'Invalid notes.' };
  if (out.priority != null && !isPriority(out.priority)) return { error: 'Invalid priority.' };
  if (out.hold_reason != null && !str(out.hold_reason, HOLD_REASON_MAX)) return { error: 'Invalid hold reason.' };
  if (!when(out.hold_since) || !who(out.hold_by)) return { error: 'Invalid hold.' };
  return { row: out };
}

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
async function updateNotes(id, change, extra = null) {
  for (let attempt = 0; attempt < NOTE_RETRIES; attempt += 1) {
    const rows = await supabase(`${byId(id)}&select=notes,status,updated_at`);
    const current = rows?.[0];
    if (!current) return { error: json(404, { error: 'Job not found.' }) };
    const notes = Array.isArray(current.notes) ? current.notes : [];
    const next = change(notes, current);
    if (next.error) return next;
    const now = new Date().toISOString();
    const job = await patchJob(`${byId(id)}&updated_at=eq.${encodeURIComponent(current.updated_at)}`, { notes: next.notes, ...(extra || {}), updated_at: now });
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

  if (action === 'assign') {
    const owner = body.assigned_to;
    if (owner !== null && !USERS.includes(owner)) return bad('Choose Garima, Indresh, or Unassigned.');
    const job = await patchJob(byId(id), { assigned_to: owner, updated_at: now });
    return job ? json(200, { job }) : json(404, { error: 'Job not found.' });
  }

  // Priority order on the To apply list. Only the order changes, so updated_at is left alone.
  if (action === 'priority') {
    if (body.priority !== null && !isPriority(body.priority)) return bad('Invalid priority.');
    const job = await patchJob(byId(id), { priority: body.priority });
    return job ? json(200, { job }) : json(404, { error: 'Job not found.' });
  }

  // On hold: the job stays in To apply, paused while waiting on a referral or coffee chats.
  // Putting a job on hold also logs the reason in its notes. Undo of Resume passes the old stamp back.
  if (action === 'hold') {
    const reason = typeof body.hold_reason === 'string' ? body.hold_reason.replace(/\s+/g, ' ').trim() : '';
    if (!reason) return bad('Pick a reason for the hold.');
    if (reason.length > HOLD_REASON_MAX) return bad(`Hold reasons can be up to ${HOLD_REASON_MAX} characters.`);
    if (body.restore) {
      const { since, by } = body.restore;
      if (!isIsoDate(since) || !USERS.includes(by)) return bad('Invalid undo.');
      const job = await patchJob(`${byId(id)}&status=eq.pipeline`, { hold_reason: reason, hold_since: since, hold_by: by, updated_at: now });
      return job ? json(200, { job }) : json(409, { error: 'Only jobs in To apply can be put on hold.' });
    }
    const note = { id: crypto.randomUUID(), text: `On hold: ${reason}`, by: actor, at: now };
    const result = await updateNotes(id, (notes, current) => (current.status !== 'pipeline'
      ? { error: json(409, { error: 'Only jobs in To apply can be put on hold.' }) }
      : { notes: notes.length >= NOTE_MAX_COUNT ? notes : [...notes, note] }),
    { hold_reason: reason, hold_since: now, hold_by: actor });
    return result.error || json(200, { job: result.job, note });
  }

  if (action === 'unhold') {
    const job = await patchJob(byId(id), { hold_reason: null, hold_since: null, hold_by: null, updated_at: now });
    return job ? json(200, { job }) : json(404, { error: 'Job not found.' });
  }

  if (action === 'delete') {
    await supabase(byId(id), { method: 'DELETE' });
    return json(200, { ok: true });
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

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const jobs = await supabase('jobs?select=*&order=added_at.desc');
      return json(200, { jobs });
    }

    if (event.httpMethod === 'POST') {
      const input = JSON.parse(event.body || '{}');
      if (input.restore) {
        if (!USERS.includes(input.actor)) return bad('Choose Garima or Indresh first.');
        const cleaned = cleanRestoredJob(input.restore);
        if (cleaned.error) return bad(cleaned.error);
        try {
          const restored = await supabase('jobs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: [cleaned.row] });
          return json(201, { job: restored?.[0] });
        } catch (err) {
          if (/duplicate key|unique constraint/i.test(err.message)) return json(409, { error: 'That job is already back.' });
          throw err;
        }
      }
      const { company, title, location = '', url, added_by } = input;
      if (!company || !title || !url || !USERS.includes(added_by)) return bad('Missing required job details.');
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Unsupported link');
      } catch {
        return bad('Use a valid http or https job link.');
      }
      const created = await supabase('jobs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: [{ company, title, location, url, added_by, assigned_to: added_by, status: 'pipeline' }],
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

export { NETWORK_STATUSES };

// Runs as a Supabase Edge Function; does nothing when imported by the tests.
import { serve } from '../_shared/serve.js';
serve(handler);

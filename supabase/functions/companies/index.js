import { supabase } from '../_shared/supabase.js';

const USERS = ['Garima', 'Indresh'];
const STAGES = ['watching', 'reached_out', 'in_conversation', 'referral'];
const PERSON_STATUSES = ['not_contacted', 'messaged', 'replied'];
const NAME_MAX = 120;
const SOURCE_MAX = 60;
const PERSON_NAME_MAX = 100;
const PERSON_ROLE_MAX = 100;
const LINK_MAX = 500;
const PEOPLE_MAX = 30;
const NOTE_MAX_CHARS = 1000;
const NOTE_MAX_COUNT = 200;
const RETRIES = 3;

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const bad = (message) => json(400, { error: message });
const byId = (id) => `companies?id=eq.${encodeURIComponent(id)}`;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isDuplicate = (err) => /duplicate key|unique constraint/i.test(err?.message || '');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// Undo for Delete: the browser sends the deleted row back. Only known columns, each checked.
function cleanRestoredCompany(row) {
  if (!row || typeof row !== 'object') return { error: 'Nothing to restore.' };
  const out = {};
  for (const key of ['id', 'name', 'source', 'assigned_to', 'stage', 'stage_updated_by', 'stage_updated_at', 'people', 'notes', 'added_by', 'added_at', 'updated_at']) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  if (!UUID.test(out.id || '')) return { error: 'Invalid company id.' };
  if (typeof out.name !== 'string' || !out.name.trim() || out.name.length > NAME_MAX) return { error: 'Invalid company name.' };
  if (out.source !== undefined && (typeof out.source !== 'string' || out.source.length > SOURCE_MAX)) return { error: 'Invalid source.' };
  if (!STAGES.includes(out.stage)) return { error: 'Invalid stage.' };
  if (!USERS.includes(out.added_by)) return { error: 'Invalid owner.' };
  if (out.assigned_to != null && !USERS.includes(out.assigned_to)) return { error: 'Invalid assignee.' };
  if (out.stage_updated_by != null && !USERS.includes(out.stage_updated_by)) return { error: 'Invalid person.' };
  if (!['stage_updated_at', 'added_at', 'updated_at'].every((k) => out[k] == null || isIso(out[k]))) return { error: 'Invalid date.' };
  if (out.people !== undefined && (!Array.isArray(out.people) || out.people.length > PEOPLE_MAX)) return { error: 'Invalid people.' };
  if (out.notes !== undefined && (!Array.isArray(out.notes) || out.notes.length > NOTE_MAX_COUNT)) return { error: 'Invalid notes.' };
  return { row: out };
}

// Accepts "linkedin.com/in/x" or a full link. Returns '' when empty, null when invalid.
function normalizeLink(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return '';
  if (value.length > LINK_MAX) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

function buildPerson(input, actor, now) {
  const name = text(input?.name, PERSON_NAME_MAX);
  if (!name) return { error: bad('Each person needs a name.') };
  const link = normalizeLink(input?.link);
  if (link === null) return { error: bad('Use a valid link for the person, or leave it empty.') };
  return { person: { id: crypto.randomUUID(), name, role: text(input?.role, PERSON_ROLE_MAX), link, status: 'not_contacted', by: actor, at: now } };
}

// People and notes are JSON arrays on the row. Two people can edit at once, so a write only
// succeeds if the row has not changed since it was read; otherwise it retries.
async function updateRow(id, change) {
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    const rows = await supabase(`${byId(id)}&select=people,notes,updated_at`);
    const current = rows?.[0];
    if (!current) return { error: json(404, { error: 'Company not found.' }) };
    const patch = change({
      people: Array.isArray(current.people) ? current.people : [],
      notes: Array.isArray(current.notes) ? current.notes : [],
    });
    if (patch.error) return patch;
    const now = new Date().toISOString();
    const updated = await supabase(`${byId(id)}&updated_at=eq.${encodeURIComponent(current.updated_at)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { ...patch.set, updated_at: now },
    });
    if (updated?.[0]) return { company: updated[0], extra: patch.extra };
  }
  return { error: json(409, { error: 'Someone else just edited this company. Try again.' }) };
}

async function handlePatch(body) {
  const { id, actor } = body;
  const action = body.action;
  if (!id || typeof id !== 'string') return bad('Missing company.');
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');
  const now = new Date().toISOString();

  if (action === 'stage') {
    if (!STAGES.includes(body.stage)) return bad('Invalid stage.');
    const updated = await supabase(byId(id), {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: { stage: body.stage, stage_updated_by: actor, stage_updated_at: now, updated_at: now },
    });
    return updated?.[0] ? json(200, { company: updated[0] }) : json(404, { error: 'Company not found.' });
  }

  if (action === 'assign') {
    const owner = body.assigned_to;
    if (owner !== null && !USERS.includes(owner)) return bad('Choose Garima, Indresh, or Unassigned.');
    const updated = await supabase(byId(id), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { assigned_to: owner, updated_at: now },
    });
    return updated?.[0] ? json(200, { company: updated[0] }) : json(404, { error: 'Company not found.' });
  }

  if (action === 'edit') {
    const set = { updated_at: now };
    if (body.name !== undefined) {
      const name = text(body.name, NAME_MAX);
      if (!name) return bad('Company name is required.');
      set.name = name;
    }
    if (body.source !== undefined) set.source = text(body.source, SOURCE_MAX);
    try {
      const updated = await supabase(byId(id), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: set });
      return updated?.[0] ? json(200, { company: updated[0] }) : json(404, { error: 'Company not found.' });
    } catch (err) {
      if (isDuplicate(err)) return json(409, { error: 'That company is already tracked.' });
      throw err;
    }
  }

  if (action === 'add-person') {
    const built = buildPerson(body.person, actor, now);
    if (built.error) return built.error;
    const result = await updateRow(id, ({ people }) => (people.length >= PEOPLE_MAX
      ? { error: bad(`A company can have up to ${PEOPLE_MAX} people.`) }
      : { set: { people: [...people, built.person] }, extra: built.person }));
    return result.error || json(200, { company: result.company, person: result.extra });
  }

  if (action === 'update-person') {
    if (!body.person_id || typeof body.person_id !== 'string') return bad('Missing person.');
    const changes = body.changes || {};
    const fields = {};
    if (changes.status !== undefined) {
      if (!PERSON_STATUSES.includes(changes.status)) return bad('Invalid outreach status.');
      fields.status = changes.status;
    }
    if (changes.name !== undefined) {
      fields.name = text(changes.name, PERSON_NAME_MAX);
      if (!fields.name) return bad('Each person needs a name.');
    }
    if (changes.role !== undefined) fields.role = text(changes.role, PERSON_ROLE_MAX);
    if (changes.link !== undefined) {
      fields.link = normalizeLink(changes.link);
      if (fields.link === null) return bad('Use a valid link for the person, or leave it empty.');
    }
    if (!Object.keys(fields).length) return bad('Nothing to update.');
    const result = await updateRow(id, ({ people }) => {
      if (!people.some((p) => p && p.id === body.person_id)) return { error: json(404, { error: 'Person not found.' }) };
      return { set: { people: people.map((p) => (p && p.id === body.person_id ? { ...p, ...fields, by: actor, at: now } : p)) } };
    });
    return result.error || json(200, { company: result.company });
  }

  if (action === 'delete-person') {
    if (!body.person_id || typeof body.person_id !== 'string') return bad('Missing person.');
    const result = await updateRow(id, ({ people }) => ({ set: { people: people.filter((p) => p && p.id !== body.person_id) } }));
    return result.error || json(200, { company: result.company });
  }

  if (action === 'add-note') {
    const note = text(body.text, NOTE_MAX_CHARS + 1);
    if (!note) return bad('Write a note first.');
    if (note.length > NOTE_MAX_CHARS) return bad(`Notes can be up to ${NOTE_MAX_CHARS} characters.`);
    const entry = { id: crypto.randomUUID(), text: note, by: actor, at: now };
    const result = await updateRow(id, ({ notes }) => (notes.length >= NOTE_MAX_COUNT
      ? { error: bad('This company has too many notes.') }
      : { set: { notes: [...notes, entry] } }));
    return result.error || json(200, { company: result.company, note: entry });
  }

  if (action === 'delete-note') {
    if (!body.note_id || typeof body.note_id !== 'string') return bad('Missing note.');
    const result = await updateRow(id, ({ notes }) => ({ set: { notes: notes.filter((n) => n && n.id !== body.note_id) } }));
    return result.error || json(200, { company: result.company });
  }

  if (action === 'delete') {
    await supabase(byId(id), { method: 'DELETE' });
    return json(200, { ok: true });
  }

  return bad('Unknown action.');
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const companies = await supabase('companies?select=*&order=added_at.desc');
      return json(200, { companies });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return bad('Invalid request.'); }
      if (body.restore) {
        if (!USERS.includes(body.actor)) return bad('Choose Garima or Indresh first.');
        const cleaned = cleanRestoredCompany(body.restore);
        if (cleaned.error) return bad(cleaned.error);
        try {
          const restored = await supabase('companies', { method: 'POST', headers: { Prefer: 'return=representation' }, body: [cleaned.row] });
          return json(201, { company: restored?.[0] });
        } catch (err) {
          if (isDuplicate(err)) return json(409, { error: 'That company is already back.' });
          throw err;
        }
      }
      if (!USERS.includes(body.added_by)) return bad('Choose Garima or Indresh first.');
      const name = text(body.name, NAME_MAX);
      if (!name) return bad('Company name is required.');
      const now = new Date().toISOString();

      const inputs = Array.isArray(body.people) ? body.people : [];
      if (inputs.length > PEOPLE_MAX) return bad(`A company can have up to ${PEOPLE_MAX} people.`);
      const people = [];
      for (const input of inputs) {
        const built = buildPerson(input, body.added_by, now);
        if (built.error) return built.error;
        people.push(built.person);
      }

      // New companies start Unassigned unless an owner is chosen in the popup.
      if (body.assigned_to != null && !USERS.includes(body.assigned_to)) return bad('Choose Garima, Indresh, or Unassigned.');
      const owner = body.assigned_to || null;

      const remark = text(body.remark, NOTE_MAX_CHARS + 1);
      if (remark.length > NOTE_MAX_CHARS) return bad(`Remarks can be up to ${NOTE_MAX_CHARS} characters.`);
      const notes = remark ? [{ id: crypto.randomUUID(), text: remark, by: body.added_by, at: now }] : [];

      try {
        const created = await supabase('companies', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: [{ name, source: text(body.source, SOURCE_MAX), people, notes, added_by: body.added_by, assigned_to: owner }],
        });
        return json(201, { company: created?.[0] });
      } catch (err) {
        if (isDuplicate(err)) return json(409, { error: `${name} is already tracked.` });
        throw err;
      }
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

export { STAGES };
export { PERSON_STATUSES };

// Runs as a Supabase Edge Function; does nothing when imported by the tests.
import { serve } from '../_shared/serve.js';
serve(handler);

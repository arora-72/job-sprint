const { supabase } = require('./_supabase');

const USERS = ['Garima', 'Indresh'];
const LINK_KINDS = ['job', 'company'];
const TEXT_MAX = 500;
const LABEL_MAX = 120;
const DONE_KEEP_DAYS = 7; // done items older than this are hidden (kept in the database)

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const bad = (message) => json(400, { error: message });
const byId = (id) => `todos?id=eq.${encodeURIComponent(id)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isPosition = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12;

function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function cleanText(v) {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!t) return { error: 'Write the to-do first.' };
  if (t.length > TEXT_MAX) return { error: `To-dos can be up to ${TEXT_MAX} characters.` };
  return { text: t };
}

// Link is all-or-nothing: kind + id + label, or none of them.
function cleanLink(body) {
  if (body.link_kind == null && body.link_id == null) return { link: { link_kind: null, link_id: null, link_label: null } };
  if (!LINK_KINDS.includes(body.link_kind) || !UUID.test(body.link_id || '')) return { error: 'Invalid link.' };
  const label = typeof body.link_label === 'string' ? body.link_label.trim().slice(0, LABEL_MAX) : '';
  return { link: { link_kind: body.link_kind, link_id: body.link_id, link_label: label || null } };
}

const COLUMNS = ['id', 'owner', 'text', 'done', 'done_at', 'done_by', 'position', 'due_on', 'link_kind', 'link_id', 'link_label', 'added_by', 'added_at', 'updated_at'];

// Undo for Delete: the browser sends the deleted row back. Only known columns, each checked.
function cleanRestoredTodo(row) {
  if (!row || typeof row !== 'object') return { error: 'Nothing to restore.' };
  const out = {};
  for (const key of COLUMNS) if (row[key] !== undefined) out[key] = row[key];
  if (!UUID.test(out.id || '')) return { error: 'Invalid to-do id.' };
  if (!USERS.includes(out.owner) || !USERS.includes(out.added_by)) return { error: 'Invalid owner.' };
  const t = cleanText(out.text);
  if (t.error) return { error: t.error };
  out.text = t.text;
  if (typeof out.done !== 'boolean') return { error: 'Invalid done flag.' };
  if (out.done_by != null && !USERS.includes(out.done_by)) return { error: 'Invalid person.' };
  if (!isPosition(out.position)) return { error: 'Invalid position.' };
  if (out.due_on != null && !isDay(out.due_on)) return { error: 'Invalid due date.' };
  if (!['done_at', 'added_at', 'updated_at'].every((k) => out[k] == null || isIso(out[k]))) return { error: 'Invalid date.' };
  const l = cleanLink(out);
  if (l.error) return { error: l.error };
  Object.assign(out, l.link);
  return { row: out };
}

async function patchRow(id, set) {
  const updated = await supabase(byId(id), {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { ...set, updated_at: new Date().toISOString() },
  });
  return updated?.[0] ? json(200, { todo: updated[0] }) : json(404, { error: 'To-do not found.' });
}

async function handlePatch(body) {
  const { id, actor, action } = body;
  if (!id || typeof id !== 'string' || !UUID.test(id)) return bad('Missing to-do.');
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');

  if (action === 'toggle') {
    if (typeof body.done !== 'boolean') return bad('Invalid done flag.');
    if (body.position !== undefined && !isPosition(body.position)) return bad('Invalid position.');
    const set = body.done
      ? { done: true, done_at: new Date().toISOString(), done_by: actor }
      : { done: false, done_at: null, done_by: null };
    if (body.position !== undefined) set.position = body.position;
    return patchRow(id, set);
  }
  if (action === 'edit') {
    const t = cleanText(body.text);
    return t.error ? bad(t.error) : patchRow(id, { text: t.text });
  }
  if (action === 'move') {
    if (!isPosition(body.position)) return bad('Invalid position.');
    const set = { position: body.position };
    if (body.owner !== undefined) {
      if (!USERS.includes(body.owner)) return bad('Choose Garima or Indresh.');
      set.owner = body.owner;
    }
    return patchRow(id, set);
  }
  if (action === 'due') {
    if (body.due_on !== null && !isDay(body.due_on)) return bad('Invalid due date.');
    return patchRow(id, { due_on: body.due_on });
  }
  if (action === 'unlink') return patchRow(id, { link_kind: null, link_id: null, link_label: null });
  if (action === 'delete') {
    await supabase(byId(id), { method: 'DELETE' });
    return json(200, { ok: true });
  }
  return bad('Unknown action.');
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const since = new Date(Date.now() - DONE_KEEP_DAYS * 86400000).toISOString();
      const filter = encodeURIComponent(`(done.is.false,done_at.gte.${since})`);
      const todos = await supabase(`todos?select=*&or=${filter}&order=position.asc`);
      return json(200, { todos });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad('Invalid request.'); }

    if (event.httpMethod === 'POST') {
      if (body.restore) {
        if (!USERS.includes(body.actor)) return bad('Choose Garima or Indresh first.');
        const cleaned = cleanRestoredTodo(body.restore);
        if (cleaned.error) return bad(cleaned.error);
        try {
          const restored = await supabase('todos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: [cleaned.row] });
          return json(201, { todo: restored?.[0] });
        } catch (err) {
          if (/duplicate key|unique constraint/i.test(err?.message || '')) return json(409, { error: 'That to-do is already back.' });
          throw err;
        }
      }
      if (!USERS.includes(body.added_by)) return bad('Choose Garima or Indresh first.');
      const owner = body.owner === undefined ? body.added_by : body.owner;
      if (!USERS.includes(owner)) return bad('Choose whose list this goes on.');
      const t = cleanText(body.text);
      if (t.error) return bad(t.error);
      const position = body.position === undefined ? 0 : body.position;
      if (!isPosition(position)) return bad('Invalid position.');
      if (body.due_on != null && !isDay(body.due_on)) return bad('Invalid due date.');
      const l = cleanLink(body);
      if (l.error) return bad(l.error);
      // The browser picks the id so the item can be edited or ticked before this save returns.
      if (body.id !== undefined && !UUID.test(body.id || '')) return bad('Invalid to-do id.');
      const row = { owner, text: t.text, position, due_on: body.due_on || null, ...l.link, added_by: body.added_by };
      if (body.id) row.id = body.id;
      const created = await supabase('todos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: [row] });
      return json(201, { todo: created?.[0] });
    }

    if (event.httpMethod === 'PATCH') return await handlePatch(body);
    return json(405, { error: 'Method not allowed.' });
  } catch (err) {
    return json(500, { error: err.message || 'Server error.' });
  }
};

exports.isDay = isDay;
exports.cleanRestoredTodo = cleanRestoredTodo;

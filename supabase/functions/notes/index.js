import { supabase } from '../_shared/supabase.js';
import { cleanHtml } from '../_shared/clean-html.js';

// Shared notes for Garima and Indresh. Saves are conflict-safe: a save names the version it was
// based on, and if the other person changed the note since, it is refused with their version
// so the page can ask which to keep. Deleted notes sit in Trash for 30 days.
const USERS = ['Garima', 'Indresh'];
const COLORS = ['sand', 'rose', 'peach', 'mint', 'sky', 'lilac'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRASH_DAYS = 30;
const MAX_LABELS = 10;

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const bad = (message) => json(400, { error: message });
const byId = (id) => `notes?id=eq.${encodeURIComponent(id)}`;
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const tidy = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function cleanLabels(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const l of v) {
    const t = tidy(l, 40);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, MAX_LABELS);
}
function cleanLink(body) {
  if (body.link_kind == null) return { link_kind: null, link_id: null, link_label: null };
  if (!['job', 'company'].includes(body.link_kind) || !UUID.test(body.link_id || '')) return null;
  return { link_kind: body.link_kind, link_id: body.link_id, link_label: tidy(body.link_label, 120) || null };
}
async function patchNote(filter, patch) {
  const rows = await supabase(filter, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch });
  return rows?.[0] || null;
}
async function getNote(id) {
  const rows = await supabase(`${byId(id)}&select=*`);
  return rows?.[0] || null;
}

async function handlePost(body) {
  const actor = body.actor;
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');
  const now = new Date().toISOString();
  const id = body.id === undefined ? crypto.randomUUID() : body.id;
  if (!UUID.test(id)) return bad('Invalid note id.');
  if (body.color != null && !COLORS.includes(body.color)) return bad('Invalid colour.');
  const labels = body.labels === undefined ? [] : cleanLabels(body.labels);
  if (!labels) return bad('Invalid labels.');
  const link = cleanLink(body);
  if (!link) return bad('Invalid link.');
  const row = {
    id, title: tidy(body.title, 200), body: cleanHtml(body.body), color: body.color || null, pinned: body.pinned === true, labels, ...link,
    created_by: actor, created_at: now, updated_by: actor, updated_at: now,
  };
  // Undo of "delete forever" is not offered, but restoring from Trash is a PATCH; this keeps POST for new notes.
  try {
    const made = await supabase('notes', { method: 'POST', headers: { Prefer: 'return=representation' }, body: [row] });
    return json(201, { note: made?.[0] });
  } catch (err) {
    if (/duplicate key|unique constraint/i.test(err.message)) return json(409, { error: 'That note already exists.' });
    throw err;
  }
}

async function handlePatch(body) {
  const { id, actor, action } = body;
  if (!USERS.includes(actor)) return bad('Choose Garima or Indresh first.');
  if (!UUID.test(id || '')) return bad('Invalid note.');
  const now = new Date().toISOString();
  const touched = { updated_by: actor, updated_at: now };

  if (action === 'save') {
    const patch = { ...touched };
    if (body.title !== undefined) patch.title = tidy(body.title, 200);
    if (body.body !== undefined) patch.body = cleanHtml(body.body);
    // Conflict check: only save over the version this edit started from (unless "keep mine").
    let filter = byId(id);
    if (!body.force) {
      if (!isIso(body.base)) return bad('Missing note version.');
      filter += `&updated_at=eq.${encodeURIComponent(body.base)}`;
    }
    const note = await patchNote(`${filter}&deleted_at=is.null`, patch);
    if (note) return json(200, { note });
    const current = await getNote(id);
    if (!current) return json(404, { error: 'That note is gone.' });
    if (current.deleted_at) return json(410, { error: 'That note was moved to Trash.', note: current });
    return json(409, { error: `${current.updated_by || 'Someone'} just edited this note.`, note: current });
  }

  let patch;
  if (action === 'pin') {
    if (typeof body.pinned !== 'boolean') return bad('Invalid pin.');
    patch = { pinned: body.pinned }; // pinning doesn't count as an edit
  } else if (action === 'color') {
    if (body.color !== null && !COLORS.includes(body.color)) return bad('Invalid colour.');
    patch = { color: body.color };
  } else if (action === 'labels') {
    const labels = cleanLabels(body.labels);
    if (!labels) return bad('Invalid labels.');
    patch = { labels, ...touched };
  } else if (action === 'link') {
    const link = cleanLink(body);
    if (!link) return bad('Invalid link.');
    patch = { ...link, ...touched };
  } else if (action === 'delete') {
    patch = { deleted_at: now, pinned: false };
  } else if (action === 'restore') {
    patch = { deleted_at: null };
  } else if (action === 'purge') {
    await supabase(`${byId(id)}&deleted_at=not.is.null`, { method: 'DELETE' });
    return json(200, { ok: true });
  } else {
    return bad('Unknown action.');
  }
  const note = await patchNote(byId(id), patch);
  return note ? json(200, { note }) : json(404, { error: 'That note is gone.' });
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
      try { await supabase(`notes?deleted_at=lt.${cutoff}`, { method: 'DELETE' }); } catch { /* housekeeping only */ }
      const notes = await supabase('notes?select=*&order=updated_at.desc');
      return json(200, { notes });
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad('Invalid request.'); }
    if (event.httpMethod === 'POST') return await handlePost(body);
    if (event.httpMethod === 'PATCH') return await handlePatch(body);
    return json(405, { error: 'Method not allowed.' });
  } catch (err) {
    return json(500, { error: err.message || 'Server error.' });
  }
};

// Runs as a Supabase Edge Function; does nothing when imported by the tests.
import { serve } from '../_shared/serve.js';
serve(handler);

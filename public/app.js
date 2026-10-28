const USERS = ['Garima', 'Indresh'];
const REFRESH_MS = 10 * 60 * 1000;
const UNDO_MS = 6000;

/* ---------- Small helpers ---------- */
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { try { return sessionStorage.getItem(key); } catch { return null; } }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { try { sessionStorage.setItem(key, value); } catch { /* ignore */ } }
  },
};
const $ = (id) => document.getElementById(id);
const savedUser = store.get('jobSprintUser');

const state = {
  user: USERS.includes(savedUser) ? savedUser : null,
  jobs: [],
  discover: [],
  discoverLoaded: false,
  discoverError: null,
  discoverBusy: new Set(),
  tab: 'open',          // 'open' | 'networking' | 'history' | 'discover'
  filter: null,         // null | 'today' | 'backlog' | 'applied-today'
  historyFilter: 'all', // 'all' | 'successful' | 'stale' | 'blocked'
  notesJobId: null,     // id of the job or company whose drawer is open
  notesKind: 'job',     // 'job' | 'company'
  companies: [],
  companiesLoaded: false,
  companiesLoading: false,
  companyFilter: 'all', // 'all' | a stage key
  ownerFilter: ['all', 'Garima', 'Indresh', 'none'].includes(store.get('jobSprintOwnerFilter')) ? store.get('jobSprintOwnerFilter') : 'all',
  pendingBlockId: null,
  preview: null,        // { url, token }
  lastSync: null,
  lastAttempt: 0,
  refreshError: false,
  refreshPromise: null,
  needsActionRefresh: false,
  loadedOnce: false,
  inflight: new Map(),  // job id -> promise chain, keeps updates for one job in order
  todos: [],
  todosLoaded: false,
  todosLoading: false,
  todoOpen: false,      // panel visible
  todoView: null,       // whose list the panel shows: 'Garima' | 'Indresh'
  todoDraftLink: null,  // { kind, id, label } when adding from a job or company menu
  todoEditing: null,    // id of the item being edited
  todoDrag: null,       // drag state while reordering
  todoChecking: new Set(), // ids mid tick animation
  todoDoneCollapsed: store.get('jobSprintTodoDone') === 'collapsed',
};
let refreshTimer = null;

const els = {};
[
  'linkedinCopy', 'linkedinLabel', 'linkedinEdit', 'linkedinForm', 'linkedinInput', 'linkedinWho', 'linkedinErr', 'linkedinCancel',
  'userModal', 'switchUser', 'activeUser', 'activeUserAvatar', 'soundToggle', 'todoBtn', 'todoCount', 'todoBackdrop', 'todoDrawer', 'todoTitle', 'todoSub', 'closeTodo',
  'todoSwitch', 'todoForm', 'todoInput', 'todoDraft', 'todoScroll', 'todoOpenList', 'todoDoneWrap', 'themeToggle', 'addForm', 'jobUrl', 'parseBtn',
  'addPanel', 'addPanelUrl', 'parseConfidence', 'parseStatus', 'dupWarning', 'previewForm',
  'titleInput', 'companyInput', 'locationInput', 'cancelPreview', 'saveJob',
  'statOpenValue', 'statOpenSub', 'statAppliedValue', 'statAppliedSub', 'statTodayValue', 'statTodaySub',
  'statBacklog', 'statBacklogValue', 'statBacklogSub', 'statNetworking', 'statNetworkingValue', 'statNetworkingSub',
  'openCount', 'networkingCount', 'companiesCount', 'discoverCount', 'historyCount',
  'ownerBar', 'companyOwner', 'rowMenu', 'companyModal', 'companyForm', 'companyName', 'companySource', 'companyChips', 'companyPeople', 'addPersonRow', 'companyRemark',
  'companyErr', 'saveCompany', 'closeCompanyModal', 'cancelCompany',
  'peopleSection', 'peopleList', 'peopleCount', 'personForm', 'personName', 'personRole', 'personLink', 'companyFoot', 'deleteCompany',
  'filterChip', 'filterChipText', 'syncText', 'refreshBtn', 'loadingState', 'emptyState', 'emptyIcon',
  'emptyTitle', 'emptyText', 'jobList', 'toast', 'toastText', 'toastUndo',
  'blockModal', 'blockJobName', 'blockReason', 'closeBlockModal', 'cancelBlock', 'confirmBlock', 'reasonChips',
  'notesBackdrop', 'notesDrawer', 'notesTitle', 'notesSub', 'closeNotes', 'noteForm', 'noteInput', 'saveNote', 'notesList',
].forEach((id) => { els[id] = $(id); });

function userClass(name) { return name === 'Garima' ? 'u-g' : name === 'Indresh' ? 'u-i' : ''; }
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
function readableText(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
  return String(value).replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt|nbsp|ndash|mdash|hellip);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] || entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}
function displayHtml(value) { return escapeHtml(readableText(value)); }
function safeJobUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch { return '#'; }
}
function isHttpUrl(text) {
  try { return ['http:', 'https:'].includes(new URL(text.trim()).protocol); } catch { return false; }
}

// Strip tracking params so the same posting shared twice is caught as a duplicate.
const TRACKING_KEYS = new Set(['ref', 'refid', 'trackingid', 'trk', 'trkinfo', 'src', 'source', 'gh_src', 'lever-source', 'lever-origin', 'li_fat_id', 'gclid', 'fbclid', 'origin', 'from', 'referer', 'referrer']);
function normalizeUrl(value) {
  try {
    const u = new URL(value.trim());
    [...u.searchParams.keys()].forEach((k) => {
      const key = k.toLowerCase();
      if (key.startsWith('utm_') || TRACKING_KEYS.has(key)) u.searchParams.delete(k);
    });
    u.searchParams.sort();
    const qs = u.searchParams.toString();
    return u.host.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + (qs ? `?${qs}` : '');
  } catch { return value.trim(); }
}

/* ---------- Dates ---------- */
const DAY = 86400000;
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfToday() { return startOfDay(new Date()); }
function daysOld(value) { return Math.round((startOfToday() - startOfDay(new Date(value))) / DAY); }
function timeOnly(d) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d); }
function relDate(value) {
  if (!value) return '';
  const d = new Date(value);
  const age = daysOld(d);
  if (age <= 0) {
    const mins = Math.floor((Date.now() - d) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `today ${timeOnly(d)}`;
  }
  if (age === 1) return `yesterday ${timeOnly(d)}`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

/* ---------- User ---------- */
function setUser(name) {
  state.user = name;
  store.set('jobSprintUser', name);
  els.activeUser.textContent = name;
  els.activeUserAvatar.textContent = name[0];
  els.activeUserAvatar.className = `avatar ${userClass(name)}`;
  els.userModal.classList.add('hidden');
  renderLinkedin();
  if (!state.todoOpen) state.todoView = name;
  renderTodos();
  if (!els.addPanel.classList.contains('hidden')) els.titleInput.focus();
}
function chooseUser() { els.userModal.classList.remove('hidden'); }
document.querySelectorAll('.user-choice').forEach((btn) => btn.addEventListener('click', () => setUser(btn.dataset.user)));
els.switchUser.addEventListener('click', chooseUser);

/* ---------- LinkedIn quick copy (saved per person, in this browser) ---------- */
const liKey = () => `jobSprintLinkedin:${state.user || 'guest'}`;
const getLinkedin = () => store.get(liKey()) || '';
function renderLinkedin() {
  const url = getLinkedin();
  els.linkedinLabel.textContent = url ? 'Copy LinkedIn' : 'Add LinkedIn';
  els.linkedinCopy.title = url ? `Copy ${url}` : 'Save your LinkedIn link once, then copy it in one click';
}
function normalizeLinkedin(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
function openLinkedinForm() {
  els.linkedinInput.value = getLinkedin();
  els.linkedinErr.textContent = '';
  els.linkedinWho.textContent = state.user ? `(${state.user})` : '';
  els.linkedinForm.classList.remove('hidden');
  els.linkedinInput.focus();
}
function closeLinkedinForm() { els.linkedinForm.classList.add('hidden'); }
els.linkedinCopy.addEventListener('click', async () => {
  const url = getLinkedin();
  if (!url) { openLinkedinForm(); return; }
  const ok = await copyText(url);
  els.linkedinLabel.textContent = ok ? 'Copied ✓' : 'Copy failed';
  setTimeout(renderLinkedin, 1400);
  if (!ok) showToast('Couldn’t copy. Open the pencil and copy it from there.', { error: true });
});
els.linkedinEdit.addEventListener('click', () => (els.linkedinForm.classList.contains('hidden') ? openLinkedinForm() : closeLinkedinForm()));
els.linkedinCancel.addEventListener('click', closeLinkedinForm);
els.linkedinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = els.linkedinInput.value;
  const url = normalizeLinkedin(raw);
  if (url === null) { els.linkedinErr.textContent = 'Use a linkedin.com link.'; return; }
  store.set(liKey(), url);
  renderLinkedin();
  closeLinkedinForm();
  showToast(url ? 'LinkedIn link saved.' : 'LinkedIn link cleared.');
});
document.addEventListener('mousedown', (e) => {
  if (!els.linkedinForm.classList.contains('hidden') && !e.target.closest('.li-wrap')) closeLinkedinForm();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.linkedinForm.classList.contains('hidden')) { closeLinkedinForm(); e.stopPropagation(); }
}, true);

/* ---------- Toast with optional Undo ---------- */
function showToast(message, { error = false, undo = null } = {}) {
  els.toastText.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toastUndo.classList.toggle('hidden', !undo);
  els.toastUndo.onclick = undo ? () => { hideToast(); undo(); } : null;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(hideToast, undo ? UNDO_MS : 2800);
}
function hideToast() { els.toast.classList.add('hidden'); els.toastUndo.onclick = null; }

/* ---------- API ---------- */
async function api(path, options = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'Something went wrong');
  return payload;
}

async function loadJobs({ silent = false } = {}) {
  if (state.loading || state.inflight.size) return false; // don't clobber optimistic changes mid-flight
  state.loading = true;
  if (!state.loadedOnce) {
    els.loadingState.classList.remove('hidden');
    els.emptyState.classList.add('hidden');
  }
  try {
    const data = await api('jobs');
    state.jobs = data.jobs || [];
    state.loadedOnce = true;
    return true;
  } catch (err) {
    if (!silent) showToast(err.message, { error: true });
    return false;
  } finally {
    els.loadingState.classList.add('hidden');
    state.loading = false;
    render();
  }
}

async function loadTodos({ silent = false } = {}) {
  if (state.todosLoading || state.inflight.size || state.todoDrag || state.todoEditing) return false; // keep in-progress edits
  state.todosLoading = true;
  try {
    const data = await api('todos');
    state.todos = data.todos || [];
    return true;
  } catch (err) {
    if (!silent && state.todoOpen) showToast(err.message, { error: true });
    return false;
  } finally {
    state.todosLoading = false;
    state.todosLoaded = true;
    render();
  }
}

async function loadCompanies({ silent = false } = {}) {
  if (state.companiesLoading || state.inflight.size) return false; // don't clobber optimistic changes mid-flight
  state.companiesLoading = true;
  try {
    const data = await api('companies');
    state.companies = data.companies || [];
    return true;
  } catch (err) {
    if (!silent && state.tab === 'companies') showToast(err.message, { error: true });
    return false;
  } finally {
    state.companiesLoading = false;
    state.companiesLoaded = true;
    render();
  }
}

async function loadDiscover({ silent = false } = {}) {
  if (state.discoverLoading || state.discoverBusy.size || state.inflight.size) return false;
  state.discoverLoading = true;
  try {
    const data = await api('discover');
    state.discover = data.roles || [];
    state.discoverError = null;
    return true;
  } catch (err) {
    state.discoverError = err.message;
    if (!silent && state.tab === 'discover') showToast(err.message, { error: true });
    return false;
  } finally {
    state.discoverLoading = false;
    state.discoverLoaded = true;
    render();
  }
}

async function refreshAll({ silent = false, afterAction = false } = {}) {
  if (state.refreshPromise) {
    // A write may finish after an earlier read started. Read once more after it settles.
    return afterAction ? state.refreshPromise.then(() => refreshAll({ silent: true })) : state.refreshPromise;
  }
  state.lastAttempt = Date.now();
  scheduleAutoRefresh();
  els.refreshBtn.classList.add('spinning');
  els.refreshBtn.disabled = true;
  state.refreshPromise = (async () => {
    // Companies load alongside, but a companies failure never marks the whole refresh as failed.
    const [jobsOk, discoverOk] = await Promise.all([loadJobs({ silent }), loadDiscover({ silent }), loadCompanies({ silent }), loadTodos({ silent })]);
    state.refreshError = !(jobsOk && discoverOk);
    if (!state.refreshError) state.lastSync = new Date();
    return !state.refreshError;
  })();
  render();
  try { return await state.refreshPromise; }
  finally {
    state.refreshPromise = null;
    els.refreshBtn.classList.remove('spinning');
    els.refreshBtn.disabled = false;
    render();
  }
}

function refreshIfDue() {
  if (document.visibilityState !== 'visible' || state.refreshPromise) return;
  if (Date.now() - state.lastAttempt >= REFRESH_MS) refreshAll({ silent: true });
}

function scheduleAutoRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') refreshIfDue();
    else render();
  }, REFRESH_MS);
}

/* ---------- Stages ---------- */
// Which tab a job belongs in is derived from its fields (mirrors supabase/networking.sql):
//   pipeline -> To apply · applied and not closed -> Networking · blocked or closed -> History
const NETWORK = {
  not_networked: { label: 'Not networked', short: 'Not networked' },
  first_pass: { label: '1st pass done', short: '1st pass' },
  second_pass: { label: '2nd pass done', short: '2nd pass' },
  successful: { label: 'Successful', short: 'Successful' },
  stale: { label: 'Stale', short: 'Stale' },
};
const NETWORK_ORDER = Object.keys(NETWORK);
const NETWORK_DONE = new Set(['successful', 'stale']);
const NUDGE_DAYS = 5;

function stageOf(job) {
  if (job.status === 'pipeline') return 'open';
  if (job.status === 'applied' && !job.network_closed_at) return 'networking';
  return 'history';
}
function netStatus(job) { return NETWORK[job.network_status] ? job.network_status : 'not_networked'; }
function lastTouch(job) { return job.network_updated_at || job.applied_at || job.added_at; }
function closedAt(job) { return job.network_closed_at || job.blocked_at || job.applied_at || job.updated_at; }
function outcomeOf(job) { return job.status === 'blocked' ? 'blocked' : netStatus(job); }
function notesOf(job) { return Array.isArray(job.notes) ? job.notes : []; }

// Owner: who is responsible for a job or company. The filter bar narrows every list and tile.
const ownerMatch = (item) => state.ownerFilter === 'all' || (state.ownerFilter === 'none' ? !item.assigned_to : item.assigned_to === state.ownerFilter);
const OWNER_FILTERS = [['all', 'Everyone'], ['Garima', 'Garima'], ['Indresh', 'Indresh'], ['none', 'Unassigned']];
const ownerLabel = (key) => (OWNER_FILTERS.find(([k]) => k === key) || [, 'Everyone'])[1];

// A big profile circle at the left of every row: G, I, or a dashed + when unassigned. Click to change.
function ownerCircle(item) {
  const who = item.assigned_to;
  const title = who ? `Assigned to ${who}. Click to change.` : 'Unassigned. Click to assign.';
  return `<button class="own ${who ? userClass(who) : 'none'}" data-action="owner" title="${title}" aria-label="${title}">${who ? who[0] : '+'}</button>`;
}

function buckets() {
  const t0 = startOfToday();
  const byStage = { open: [], networking: [], history: [] };
  const jobs = state.jobs.filter(ownerMatch);
  jobs.forEach((j) => byStage[stageOf(j)].push(j));
  const open = byStage.open;
  const backlog = open.filter((j) => new Date(j.added_at) < t0).sort((a, b) => new Date(a.added_at) - new Date(b.added_at));
  const today = open.filter((j) => new Date(j.added_at) >= t0).sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
  // Least recently touched first, so neglected jobs rise to the top.
  const networking = byStage.networking.sort((a, b) => new Date(lastTouch(a)) - new Date(lastTouch(b)));
  const history = byStage.history.sort((a, b) => new Date(closedAt(b)) - new Date(closedAt(a)));
  const appliedToday = jobs.filter((j) => j.status === 'applied' && new Date(j.applied_at) >= t0);
  const addedToday = jobs.filter((j) => new Date(j.added_at) >= t0);
  return { open, backlog, today, networking, history, appliedToday, addedToday };
}

/* ---------- Rendering ---------- */
function ageBadge(job) {
  const age = daysOld(job.added_at);
  if (age <= 0) return '<span class="age new" title="Added today">New</span>';
  return `<span class="age ${age >= 5 ? 'old' : ''}" title="Added ${age} day${age === 1 ? '' : 's'} ago">${age}d</span>`;
}

const NOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

// Company recognition: a colored tile with initials (same company, same color, everywhere) and a bold name.
const CO_STOPWORDS = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company', 'us', 'usa', 'the', 'of', 'and']);
function companyInitials(name) {
  const words = String(name || '').replace(/&/g, ' and ').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const keep = words.filter((w) => !CO_STOPWORDS.has(w.toLowerCase()));
  const use = keep.length ? keep : words;
  if (!use.length) return '?';
  if (use.length === 1) return use[0].length <= 3 ? use[0].toUpperCase() : use[0][0].toUpperCase();
  return use.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
}
function companyHue(name) {
  const key = (typeof compKey === 'function' ? compKey(name) : '') || String(name || '').toLowerCase();
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}
function coTile(name, small = false) {
  const initials = companyInitials(name);
  return `<span class="co-tile h${companyHue(name)}${small ? ' sm' : ''}${initials.length >= 3 ? ' t3' : ''}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}
// Own column on wide screens; on narrow screens the same name moves into the sub-line (see CSS).
function coCell(job) {
  const name = job.company || 'Unknown company';
  return `<div class="co-cell" title="${escapeHtml(readableText(name))}">${coTile(name)}<span class="co-name">${displayHtml(name)}</span></div>`;
}
function subLine(job) {
  const name = job.company || 'Unknown company';
  const parts = [`<span class="sub-co">${coTile(name, true)}<span>${displayHtml(name)}</span></span>`];
  if (job.location) { parts.push('<span class="dot sub-co">·</span>'); parts.push(displayHtml(job.location)); }
  return parts.join('');
}
function titleLink(job) {
  return `<a class="job-title" href="${escapeHtml(safeJobUrl(job.url))}" target="_blank" rel="noopener">${displayHtml(job.title || 'Untitled role')}</a>`;
}
function notePreview(job) {
  const notes = notesOf(job);
  const last = notes[notes.length - 1];
  if (!last) return '';
  return `<button class="note-preview" data-action="notes" title="Open notes">
    <span class="note-preview-text">${displayHtml(last.text)}</span><span class="note-preview-meta">${escapeHtml((last.by || '?')[0])} · ${relDate(last.at)}</span>
  </button>`;
}
function notesButton(job) {
  const n = notesOf(job).length;
  return `<button class="btn ghost small notes-btn${n ? ' has-notes' : ''}" data-action="notes" aria-label="Notes${n ? ` (${n})` : ''}" title="Notes">${NOTE_ICON}${n ? `<span>${n}</span>` : ''}</button>`;
}
function openLink(job) {
  return `<a class="btn ghost small" href="${escapeHtml(safeJobUrl(job.url))}" target="_blank" rel="noopener">Open ↗</a>`;
}

function openRow(job) {
  return `
    <article class="job-row" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        ${ownerCircle(job)}
        ${ageBadge(job)}
        <div class="job-text">
          ${titleLink(job)}
          <div class="job-sub">${subLine(job)}${companyBadge(job)}</div>
          ${notePreview(job)}
        </div>
      </div>
      ${coCell(job)}
      <div class="job-meta">
        <span class="mini-avatar ${userClass(job.added_by)}">${escapeHtml((job.added_by || '?')[0])}</span>
        <span>Added ${relDate(job.added_at)}</span>
      </div>
      <div class="actions">
        ${notesButton(job)}
        ${openLink(job)}
        <button class="btn secondary small" data-action="block">Block</button>
        <button class="btn primary small" data-action="apply">Applied ✓</button>
        ${menuButton()}
      </div>
    </article>`;
}

function touchBadge(job) {
  const status = netStatus(job);
  const age = Math.max(0, daysOld(lastTouch(job)));
  const nudge = !NETWORK_DONE.has(status) && age >= NUDGE_DAYS;
  const what = job.network_updated_at ? 'Last networking update' : 'Applied';
  const title = `${what} ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}${nudge ? '. Time for a nudge.' : ''}`;
  return `<span class="age ${nudge ? '' : 'new'}" title="${escapeHtml(title)}">${age === 0 ? 'Today' : `${age}d`}</span>`;
}

function networkSelect(job) {
  const current = netStatus(job);
  const options = NETWORK_ORDER.map((key) => `<option value="${key}"${key === current ? ' selected' : ''}>${NETWORK[key].label}</option>`).join('');
  return `<label class="net-select-wrap s-${current}">
    <span class="sr-only">Networking status</span>
    <select class="net-select" data-net-select aria-label="Networking status">${options}</select>
  </label>`;
}

function networkRow(job) {
  const ready = NETWORK_DONE.has(netStatus(job));
  return `
    <article class="job-row networking${ready ? ' is-ready' : ''}" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        ${ownerCircle(job)}
        ${touchBadge(job)}
        <div class="job-text">
          ${titleLink(job)}
          <div class="job-sub">${subLine(job)}${companyBadge(job)}</div>
          ${notePreview(job)}
        </div>
      </div>
      ${coCell(job)}
      <div class="job-meta stack">
        ${networkSelect(job)}
        <span class="meta-small"><span class="mini-avatar ${userClass(job.applied_by)}">${escapeHtml((job.applied_by || '?')[0])}</span>Applied ${relDate(job.applied_at)}</span>
      </div>
      <div class="actions">
        ${notesButton(job)}
        ${openLink(job)}
        <button class="btn ${ready ? 'primary' : 'secondary'} small" data-action="done" title="Move to History">Done → History</button>
        ${menuButton()}
      </div>
    </article>`;
}

const OUTCOME_CHIP = {
  successful: ['applied', 'Successful'], stale: ['stale', 'Stale'], blocked: ['blocked', 'Blocked'],
  not_networked: ['neutral', 'Not networked'], first_pass: ['neutral', '1st pass'], second_pass: ['neutral', '2nd pass'],
};

function historyRow(job) {
  const blocked = job.status === 'blocked';
  const [tone, label] = OUTCOME_CHIP[outcomeOf(job)];
  const who = blocked ? job.blocked_by : (job.network_closed_by || job.applied_by);
  const when = blocked ? job.blocked_at : (job.network_closed_at || job.applied_at);
  return `
    <article class="job-row history" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        ${ownerCircle(job)}
        <div class="job-text">
          ${titleLink(job)}
          <div class="job-sub">${subLine(job)}</div>
          ${notePreview(job)}
        </div>
      </div>
      ${coCell(job)}
      <div class="job-meta stack">
        <div class="meta-line">
          <span class="status-chip ${tone}">${label}</span>
          <span>${escapeHtml(who || 'Unknown')} · ${relDate(when)}</span>
        </div>
        ${blocked && job.blocked_reason ? `<div class="reason">${displayHtml(job.blocked_reason)}</div>` : ''}
        ${!blocked && job.applied_at ? `<div class="reason">Applied ${relDate(job.applied_at)}</div>` : ''}
      </div>
      <div class="actions">
        ${notesButton(job)}
        ${openLink(job)}
        <button class="btn secondary small" data-action="restore" title="${blocked ? 'Back to To apply' : 'Back to Networking'}">Move back</button>
        ${menuButton()}
      </div>
    </article>`;
}

function discoverRow(role) {
  const url = escapeHtml(safeJobUrl(role.url));
  const found = role.found_at ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${role.found_at}T12:00:00`)) : 'recently';
  const value = Number(role.fit_score);
  const hasScore = role.fit_score != null && Number.isFinite(value);
  const score = hasScore ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  const scoreTone = !hasScore ? 'score-unknown' : score >= 90 ? 'score-high' : score >= 75 ? 'score-mid' : 'score-low';
  const tier = role.fit_tier === 'S' ? 'S' : 'A';
  const sub = [role.company ? `<span class="sub-co always">${coTile(role.company, true)}<span>${displayHtml(role.company)}</span></span>` : '', role.location ? displayHtml(role.location) : ''].filter(Boolean).join('<span class="dot">·</span>');
  const busy = state.discoverBusy.has(role.id) ? ' disabled' : '';
  return `
    <article class="discover-row" data-id="${escapeHtml(role.id)}">
      <div class="discover-heading">
        <div class="discover-title-block">
          <a class="job-title" href="${url}" target="_blank" rel="noopener">${displayHtml(role.title)}</a>
          <div class="job-sub">${sub}</div>
          ${role.why_fit ? `<p class="discover-why">${displayHtml(role.why_fit)}</p>` : ''}
          ${notePreview(role)}
        </div>
        <div class="discover-rating" aria-label="Fit rating">
          <div class="score-gauge ${scoreTone}" style="--score: ${score}" role="img" aria-label="Fit score ${hasScore ? `${score} out of 100` : 'not available'}">
            <div class="score-gauge-inner"><strong>${hasScore ? score : '—'}</strong><span>/100</span></div>
          </div>
          <div class="tier-mark ${tier === 'S' ? 'tier-s' : 'tier-a'}" aria-label="Tier ${tier}">
            <span>Tier</span><strong>${tier}</strong>
          </div>
        </div>
      </div>
      <div class="discover-foot">
        <span class="discover-found">Found ${found}</span>
        <div class="actions">
          ${notesButton(role)}
          <a class="btn ghost small" href="${url}" target="_blank" rel="noopener">View job ↗</a>
          <button class="btn secondary small" data-discover-action="dismiss"${busy}>Dismiss</button>
          <button class="btn primary small" data-discover-action="add"${busy}>Add to Pipeline</button>
        </div>
      </div>
    </article>`;
}

function group(title, hint, cls, rows) {
  return `<div class="group-head ${cls}"><span>${title}</span><span class="group-hint">${hint}</span></div>${rows}`;
}

const FILTER_LABELS = { today: 'Added today', backlog: 'Backlog only', 'applied-today': 'Applied today' };
const HISTORY_FILTERS = [['all', 'All'], ['successful', 'Successful'], ['stale', 'Stale'], ['blocked', 'Blocked']];

function plural(n, word, many) { return `${n} ${n === 1 ? word : (many || `${word}s`)}`; }

function renderTiles(b) {
  els.statOpenValue.textContent = b.open.length;
  els.statOpenSub.textContent = b.open.length ? `${b.today.length} new · ${b.backlog.length} backlog` : 'Nothing open';

  els.statAppliedValue.textContent = b.appliedToday.length;
  const split = USERS.map((u) => [u, b.appliedToday.filter((j) => j.applied_by === u).length]).filter(([, n]) => n);
  els.statAppliedSub.textContent = split.length ? split.map(([u, n]) => `${u} ${n}`).join(' · ') : 'None yet today';

  els.statTodayValue.textContent = b.today.length;
  els.statTodaySub.textContent = b.addedToday.length ? `of ${b.addedToday.length} added today` : 'Nothing added today';

  els.statBacklogValue.textContent = b.backlog.length;
  els.statBacklog.classList.toggle('is-alert', b.backlog.length > 0);
  els.statBacklog.classList.toggle('is-clear', b.backlog.length === 0);
  if (b.backlog.length) {
    const oldest = daysOld(b.backlog[0].added_at);
    els.statBacklogSub.textContent = `Clear first · oldest ${oldest} day${oldest === 1 ? '' : 's'}`;
  } else {
    els.statBacklogSub.textContent = 'All clear from earlier days';
  }

  const net = b.networking;
  const notStarted = net.filter((j) => netStatus(j) === 'not_networked').length;
  const ready = net.filter((j) => NETWORK_DONE.has(netStatus(j))).length;
  const nudge = net.filter((j) => !NETWORK_DONE.has(netStatus(j)) && daysOld(lastTouch(j)) >= NUDGE_DAYS).length;
  els.statNetworkingValue.textContent = net.length;
  const parts = [];
  if (notStarted) parts.push(`${notStarted} not started`);
  if (nudge) parts.push(`${nudge} need a nudge`);
  if (ready) parts.push(`${ready} ready to close`);
  els.statNetworkingSub.textContent = net.length ? (parts.join(' · ') || 'All in progress') : 'Applied jobs land here';
}

function renderOpen(b) {
  let html = '';
  const showBacklog = state.filter !== 'today' && b.backlog.length;
  const showToday = state.filter !== 'backlog' && b.today.length;
  if (showBacklog) html += group('Backlog', `${b.backlog.length} from earlier days · oldest first`, 'backlog', b.backlog.map(openRow).join(''));
  if (showToday) html += group('Added today', `${b.today.length} open · newest first`, '', b.today.map(openRow).join(''));
  if (html) return { html };
  if (state.filter === 'backlog') return { empty: ['✓', 'Backlog cleared', 'Nothing left over from earlier days.', true] };
  if (state.filter === 'today') return { empty: ['✓', 'Nothing left from today', 'Paste a job link at the top to add one.', true] };
  return { empty: ['↗', 'Pipeline is empty', 'Paste a job link at the top, or anywhere on this page.', false] };
}

function renderNetworking(b) {
  const t0 = startOfToday();
  const list = state.filter === 'applied-today' ? b.networking.filter((j) => new Date(j.applied_at) >= t0) : b.networking;
  const groups = [
    ['not_networked', 'Not networked', 'Start here · longest waiting first', ''],
    ['first_pass', '1st pass done', 'Follow up with a second pass', ''],
    ['second_pass', '2nd pass done', 'Waiting to hear back', ''],
  ];
  let html = '';
  groups.forEach(([key, title, hint, cls]) => {
    const rows = list.filter((j) => netStatus(j) === key);
    if (rows.length) html += group(`${title} · ${rows.length}`, hint, cls, rows.map(networkRow).join(''));
  });
  const ready = list.filter((j) => NETWORK_DONE.has(netStatus(j)));
  if (ready.length) html += group(`Ready to close · ${ready.length}`, 'Click Done to move to History', 'ready', ready.map(networkRow).join(''));
  if (html) return { html };
  if (state.filter === 'applied-today') return { empty: ['0', 'No applications yet today', 'Hit “Applied ✓” on a job and it lands here.', false] };
  return { empty: ['✓', 'Nothing to network on', 'When you mark a job Applied ✓, it moves here so you can reach out.', true] };
}

function renderHistory(b) {
  const f = state.historyFilter;
  const list = f === 'all' ? b.history : b.history.filter((j) => outcomeOf(j) === f);
  const chips = b.history.length ? `<div class="subfilters" role="group" aria-label="Filter history">${HISTORY_FILTERS.map(([key, label]) => {
    const n = key === 'all' ? b.history.length : b.history.filter((j) => outcomeOf(j) === key).length;
    return `<button class="subfilter${key === f ? ' active' : ''}" data-hfilter="${key}" aria-pressed="${key === f}">${label} <span>${n}</span></button>`;
  }).join('')}</div>` : '';
  if (list.length) return { html: chips + list.map(historyRow).join('') };
  if (b.history.length) return { html: chips, empty: ['–', `No ${f} jobs`, 'Try another filter.', false] };
  return { empty: ['↗', 'No history yet', 'Blocked jobs and jobs you finish networking on land here.', false] };
}

/* ---------- Companies ---------- */
const STAGE = {
  watching: { label: 'Watching', hint: 'On your radar' },
  reached_out: { label: 'Reached out', hint: 'Waiting on a reply' },
  in_conversation: { label: 'In conversation', hint: 'Talking to someone' },
  referral: { label: 'Referral secured', hint: 'Someone will refer you' },
};
const STAGE_ORDER = Object.keys(STAGE);
const PERSON_STATUS = { not_contacted: 'Not contacted', messaged: 'Messaged', replied: 'Replied' };
const CO_NUDGE_DAYS = 7;

// "Ramp, Inc." and "ramp" match. Used to link jobs to tracked companies.
const compKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(inc|llc|corp|corporation|ltd|co|company)\b/g, ' ').replace(/\s+/g, ' ').trim();
function companyFor(job) {
  const key = compKey(job.company);
  return key ? state.companies.find((c) => compKey(c.name) === key) || null : null;
}
function peopleOf(c) { return Array.isArray(c.people) ? c.people : []; }
function stageOfCompany(c) { return STAGE[c.stage] ? c.stage : 'watching'; }
function companyNudge(c) { return stageOfCompany(c) !== 'referral' && daysOld(c.updated_at) >= CO_NUDGE_DAYS; }

function companyBadge(job) {
  const c = companyFor(job);
  if (!c) return '';
  const n = peopleOf(c).length;
  return `<button class="co-badge" data-action="company" data-company-id="${escapeHtml(c.id)}" title="Open ${escapeHtml(readableText(c.name))}">Tracked${n ? ` · ${plural(n, 'contact')}` : ''}</button>`;
}

function coTouchBadge(c) {
  const age = Math.max(0, daysOld(c.updated_at));
  const nudge = companyNudge(c);
  const title = `Last activity ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}${nudge ? '. Time for a nudge.' : ''}`;
  return `<span class="age ${nudge ? '' : 'new'}" title="${escapeHtml(title)}">${age === 0 ? 'Today' : `${age}d`}</span>`;
}

function stageSelect(c) {
  const current = stageOfCompany(c);
  const options = STAGE_ORDER.map((key) => `<option value="${key}"${key === current ? ' selected' : ''}>${STAGE[key].label}</option>`).join('');
  return `<label class="net-select-wrap co-stage s-${current}">
    <span class="sr-only">Stage</span>
    <select class="net-select" data-co-stage aria-label="Stage">${options}</select>
  </label>`;
}

function peopleLine(c) {
  const ppl = peopleOf(c);
  if (!ppl.length) return '<button class="people-line empty" data-action="notes">+ Add people to reach out to</button>';
  const chips = ppl.slice(0, 4).map((p) => `<span class="person-chip st-${escapeHtml(p.status || 'not_contacted')}" title="${escapeHtml(PERSON_STATUS[p.status] || PERSON_STATUS.not_contacted)}"><i></i>${displayHtml(p.name)}</span>`).join('');
  return `<button class="people-line" data-action="notes" title="Open people and notes">${chips}${ppl.length > 4 ? `<span class="person-more">+${ppl.length - 4}</span>` : ''}</button>`;
}

function companyRow(c) {
  const who = c.added_by || '?';
  return `
    <article class="job-row company" data-id="${escapeHtml(c.id)}">
      <div class="job-main">
        ${ownerCircle(c)}
        ${coTouchBadge(c)}
        ${coTile(c.name)}
        <div class="job-text">
          <button class="job-title co-name" data-action="notes">${displayHtml(c.name)}</button>
          <div class="job-sub">${c.source ? displayHtml(c.source) : 'No source'}</div>
          ${peopleLine(c)}
          ${notePreview(c)}
        </div>
      </div>
      <div class="job-meta stack">
        ${stageSelect(c)}
        <span class="meta-small"><span class="mini-avatar ${userClass(who)}">${escapeHtml(who[0])}</span>Added ${relDate(c.added_at)}</span>
      </div>
      <div class="actions">
        <button class="btn secondary small" data-action="notes">People &amp; notes${notesOf(c).length ? ` <span class="btn-count">${notesOf(c).length}</span>` : ''}</button>
        ${menuButton()}
      </div>
    </article>`;
}

function renderCompanies() {
  const f = state.companyFilter;
  const all = state.companies.filter(ownerMatch);
  const list = f === 'all' ? all : all.filter((c) => stageOfCompany(c) === f);
  const filters = [['all', 'All'], ...STAGE_ORDER.map((k) => [k, STAGE[k].label])];
  const bar = `<div class="subfilters co-bar" role="group" aria-label="Filter companies">
    ${all.length ? filters.map(([key, label]) => {
    const n = key === 'all' ? all.length : all.filter((c) => stageOfCompany(c) === key).length;
    return `<button class="subfilter${key === f ? ' active' : ''}" data-cofilter="${key}" aria-pressed="${key === f}">${label} <span>${n}</span></button>`;
  }).join('') : ''}
    <button class="btn primary small co-new" data-co-new>+ Track company</button>
  </div>`;
  if (!all.length) return { html: bar, empty: ['◎', 'No companies tracked yet', 'Add a company you want to work at, with the people you plan to reach out to.', false] };
  if (!list.length) return { html: bar, empty: ['–', `Nothing in ${STAGE[f].label}`, 'Try another filter.', false] };
  const nudge = list.filter(companyNudge).sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
  const rest = list.filter((c) => !companyNudge(c)).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  let html = bar;
  if (nudge.length) html += group(`Needs a nudge · ${nudge.length}`, `No activity for ${CO_NUDGE_DAYS}+ days`, 'backlog', nudge.map(companyRow).join(''));
  if (rest.length) html += nudge.length ? group(`Active · ${rest.length}`, 'Most recent first', '', rest.map(companyRow).join('')) : rest.map(companyRow).join('');
  return { html };
}

/* ----- Track-a-company popup ----- */
function personRowHtml() {
  return `<div class="person-row">
    <input type="text" maxlength="100" placeholder="Name" aria-label="Person name" data-pr="name" />
    <input type="text" maxlength="100" placeholder="Role" aria-label="Person role" data-pr="role" />
    <input type="text" inputmode="url" maxlength="500" placeholder="LinkedIn link" aria-label="Person link" data-pr="link" />
    <button type="button" class="icon-btn small" data-pr-remove aria-label="Remove person">×</button>
  </div>`;
}
function openCompanyModal() {
  if (!state.user) { chooseUser(); return; }
  els.companyForm.reset();
  els.companyPeople.innerHTML = personRowHtml();
  els.companyErr.textContent = '';
  els.saveCompany.disabled = false;
  els.saveCompany.textContent = 'Track company';
  syncSourceChips();
  els.companyModal.classList.remove('hidden');
  setTimeout(() => els.companyName.focus(), 30);
}
function closeCompanyModal() { els.companyModal.classList.add('hidden'); }
function syncSourceChips() {
  const v = els.companySource.value.trim().toLowerCase();
  els.companyChips.querySelectorAll('.reason-chip').forEach((chip) => chip.classList.toggle('selected', chip.dataset.source.toLowerCase() === v));
}
els.companyChips.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-source]');
  if (!chip) return;
  els.companySource.value = els.companySource.value.trim() === chip.dataset.source ? '' : chip.dataset.source;
  syncSourceChips();
});
els.companySource.addEventListener('input', syncSourceChips);
els.addPersonRow.addEventListener('click', () => {
  els.companyPeople.insertAdjacentHTML('beforeend', personRowHtml());
  els.companyPeople.lastElementChild.querySelector('input').focus();
});
els.companyPeople.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-pr-remove]');
  if (!rm) return;
  const rows = els.companyPeople.querySelectorAll('.person-row');
  if (rows.length === 1) rows[0].querySelectorAll('input').forEach((i) => { i.value = ''; });
  else rm.closest('.person-row').remove();
});
els.closeCompanyModal.addEventListener('click', closeCompanyModal);
els.cancelCompany.addEventListener('click', closeCompanyModal);
els.companyModal.addEventListener('mousedown', (e) => { if (e.target === els.companyModal) closeCompanyModal(); });

els.companyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = els.companyName.value.trim();
  if (!name) { els.companyErr.textContent = 'Company name is required.'; els.companyName.focus(); return; }
  const people = [];
  for (const row of els.companyPeople.querySelectorAll('.person-row')) {
    const get = (k) => row.querySelector(`[data-pr="${k}"]`).value.trim();
    const p = { name: get('name'), role: get('role'), link: get('link') };
    if (!p.name && !p.role && !p.link) continue;
    if (!p.name) { els.companyErr.textContent = 'Add a name for each person, or clear the row.'; row.querySelector('[data-pr="name"]').focus(); return; }
    people.push(p);
  }
  const dup = state.companies.find((c) => compKey(c.name) === compKey(name));
  if (dup) { els.companyErr.textContent = `${readableText(dup.name)} is already tracked.`; return; }
  els.companyErr.textContent = '';
  els.saveCompany.disabled = true;
  els.saveCompany.textContent = 'Saving…';
  try {
    const res = await api('companies', {
      method: 'POST',
      body: JSON.stringify({ name, source: els.companySource.value.trim(), assigned_to: els.companyOwner.value || null, people, remark: els.companyRemark.value.trim(), added_by: state.user }),
    });
    state.companies.unshift(res.company);
    closeCompanyModal();
    state.companyFilter = 'all';
    setView('companies');
    showToast(`Tracking ${name}${people.length ? ` · ${plural(people.length, 'person', 'people')}` : ''}`);
  } catch (err) {
    els.companyErr.textContent = err.message;
    els.saveCompany.disabled = false;
    els.saveCompany.textContent = 'Track company';
  }
});

/* ----- Company actions: stage, people, remove ----- */
function setStage(id, stage) {
  const now = new Date().toISOString();
  return mutate(id, { stage, stage_updated_by: state.user, stage_updated_at: now, updated_at: now }, { action: 'stage', stage }, 'companies');
}
function addPerson(input) {
  const id = state.notesJobId;
  if (!id) return;
  if (!state.user) { chooseUser(); return; }
  const temp = { id: `pending-${Date.now()}`, name: input.name, role: input.role, link: input.link, status: 'not_contacted', by: state.user, at: new Date().toISOString(), pending: true };
  mutate(id, (c) => ({ people: [...peopleOf(c), temp] }), { action: 'add-person', person: input }, 'companies');
}
function setPersonStatus(personId, status) {
  const id = state.notesJobId;
  if (!id) return;
  if (!state.user) { chooseUser(); return; }
  mutate(id, (c) => ({ people: peopleOf(c).map((p) => (p.id === personId ? { ...p, status } : p)), updated_at: new Date().toISOString() }),
    { action: 'update-person', person_id: personId, changes: { status } }, 'companies');
}
function deletePerson(personId, button) {
  if (!confirmTwice(button)) return;
  if (!state.user) { chooseUser(); return; }
  mutate(state.notesJobId, (c) => ({ people: peopleOf(c).filter((p) => p.id !== personId) }), { action: 'delete-person', person_id: personId }, 'companies');
}
async function removeCompany(button) {
  const id = state.notesJobId;
  const company = state.companies.find((c) => c.id === id);
  if (!company || !confirmTwice(button, 'Really remove?')) return;
  if (!state.user) { chooseUser(); return; }
  state.companies = state.companies.filter((c) => c.id !== id);
  closeNotes();
  render();
  try {
    await api('companies', { method: 'PATCH', body: JSON.stringify({ id, actor: state.user, action: 'delete' }) });
    showToast(`Removed ${readableText(company.name)}`);
  } catch (err) {
    state.companies.push(company);
    render();
    showToast(`Couldn't remove: ${err.message}`, { error: true });
  }
}
// First click arms the button, a second click within 3 seconds confirms.
function confirmTwice(button, armedText = 'Delete?') {
  if (button.dataset.confirm === 'yes') return true;
  const original = button.textContent;
  button.dataset.confirm = 'yes';
  button.textContent = armedText;
  button.classList.add('confirming');
  setTimeout(() => { if (button.isConnected) { button.dataset.confirm = ''; button.textContent = original; button.classList.remove('confirming'); } }, 3000);
  return false;
}

function renderPeople(c) {
  const ppl = peopleOf(c);
  els.peopleCount.textContent = ppl.length ? plural(ppl.length, 'person', 'people') : '';
  els.peopleList.innerHTML = ppl.length ? ppl.map((p) => {
    const status = PERSON_STATUS[p.status] ? p.status : 'not_contacted';
    const name = p.link ? `<a href="${escapeHtml(safeJobUrl(p.link))}" target="_blank" rel="noopener">${displayHtml(p.name)}</a>` : displayHtml(p.name);
    const options = Object.entries(PERSON_STATUS).map(([k, v]) => `<option value="${k}"${k === status ? ' selected' : ''}>${v}</option>`).join('');
    return `<div class="person${p.pending ? ' pending' : ''}" data-person-id="${escapeHtml(p.id)}">
      <div class="person-info"><strong>${name}</strong>${p.role ? `<span class="person-role">${displayHtml(p.role)}</span>` : ''}</div>
      ${p.pending ? '<span class="note-when">Saving…</span>' : `<label class="person-status st-${status}"><span class="sr-only">Outreach status</span><select data-person-status aria-label="Outreach status">${options}</select></label>
      <button class="note-delete" data-person-delete>Delete</button>`}
    </div>`;
  }).join('') : '<div class="notes-empty">No one yet. Add the people you want to reach out to.</div>';
}

els.peopleList.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-person-status]');
  if (sel) setPersonStatus(sel.closest('.person').dataset.personId, sel.value);
});
els.peopleList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-person-delete]');
  if (del) deletePerson(del.closest('.person').dataset.personId, del);
});
els.personForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = els.personName.value.trim();
  if (!name) { els.personName.focus(); return; }
  addPerson({ name, role: els.personRole.value.trim(), link: els.personLink.value.trim() });
  els.personForm.reset();
  els.personName.focus();
});
els.deleteCompany.addEventListener('click', () => removeCompany(els.deleteCompany));

// Company list: stage select, filters, the + button.
els.jobList.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-co-stage]');
  if (!sel) return;
  const id = sel.closest('.job-row')?.dataset.id;
  const c = state.companies.find((x) => x.id === id);
  if (!c) return;
  if (!state.user) { sel.value = stageOfCompany(c); chooseUser(); return; }
  const prev = stageOfCompany(c);
  if (sel.value === prev) return;
  setStage(id, sel.value);
  showToast(`${readableText(c.name)} · ${STAGE[sel.value].label}`, { undo: () => setStage(id, prev) });
});

function renderDiscover() {
  const html = state.discoverLoaded ? state.discover.map(discoverRow).join('') : '<div class="state-card">Loading matches…</div>';
  if (html) return { html };
  return {
    empty: state.discoverError
      ? ['!', 'Couldn’t load Discover', 'Refresh to try again.', false]
      : ['✦', 'No S or A matches to review', 'New matches from Garima’s role watches will appear here.', true],
  };
}

// Everything on the current tab before the owner filter, so the filter bar can show honest counts.
function tabBase() {
  if (state.tab === 'discover') return null;
  if (state.tab === 'companies') return state.companies;
  return state.jobs.filter((j) => stageOf(j) === state.tab);
}
function renderOwnerBar() {
  const base = tabBase();
  els.ownerBar.classList.toggle('hidden', !base);
  if (!base) return;
  els.ownerBar.innerHTML = `<span class="owner-label">Owner</span>${OWNER_FILTERS.map(([key, label]) => {
    const n = key === 'all' ? base.length : key === 'none' ? base.filter((x) => !x.assigned_to).length : base.filter((x) => x.assigned_to === key).length;
    return `<button class="subfilter${key === state.ownerFilter ? ' active' : ''}" data-owner-filter="${key}" aria-pressed="${key === state.ownerFilter}">${label} <span>${n}</span></button>`;
  }).join('')}`;
}
els.ownerBar.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-owner-filter]');
  if (!chip) return;
  state.ownerFilter = chip.dataset.ownerFilter;
  store.set('jobSprintOwnerFilter', state.ownerFilter);
  render();
});

function render() {
  renderTodos();
  const b = buckets();
  renderTiles(b);

  const view = state.tab === 'open' ? (state.filter || 'open')
    : state.tab === 'networking' ? (state.filter === 'applied-today' ? 'applied-today' : 'networking')
      : state.tab;
  document.querySelectorAll('.stat').forEach((s) => s.classList.toggle('active', s.dataset.view === view));

  // Tabs + filter chip
  els.openCount.textContent = b.open.length;
  els.networkingCount.textContent = b.networking.length;
  els.companiesCount.textContent = state.companies.filter(ownerMatch).length;
  els.discoverCount.textContent = state.discover.length;
  els.historyCount.textContent = b.history.length;
  if (typeof syncTabFade === 'function') requestAnimationFrame(syncTabFade);
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === state.tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  els.filterChip.classList.toggle('hidden', !state.filter);
  els.filterChipText.textContent = FILTER_LABELS[state.filter] || '';
  els.syncText.textContent = state.refreshPromise
    ? 'Refreshing…'
    : state.refreshError
      ? `Refresh failed${state.lastSync ? ` · Last refreshed at ${timeOnly(state.lastSync)}` : ''}`
      : state.lastSync ? `Last refreshed at ${timeOnly(state.lastSync)}` : 'Waiting for first refresh';
  els.syncText.classList.toggle('sync-error', state.refreshError);

  // List
  const renderers = { open: renderOpen, networking: renderNetworking, companies: renderCompanies, history: renderHistory, discover: renderDiscover };
  renderOwnerBar();
  let { html = '', empty = null } = renderers[state.tab](b);
  if (empty && state.ownerFilter !== 'all' && tabBase()?.length) {
    empty = ['–', state.ownerFilter === 'none' ? 'Nothing unassigned here' : `Nothing for ${state.ownerFilter} here`, 'Switch to Everyone to see the rest.', false];
  }
  els.jobList.innerHTML = html;
  const showEmpty = !!empty && (state.tab === 'discover' ? state.discoverLoaded : state.tab === 'companies' ? state.companiesLoaded : state.loadedOnce);
  els.emptyState.classList.toggle('hidden', !showEmpty);
  if (empty) {
    els.emptyIcon.textContent = empty[0];
    els.emptyIcon.classList.toggle('good', empty[3]);
    els.emptyTitle.textContent = empty[1];
    els.emptyText.textContent = empty[2];
  }
  if (state.notesJobId) renderNotes();
}

function setView(tab, filter = null) {
  const changed = state.tab !== tab;
  state.tab = tab;
  state.filter = filter;
  render();
  if (changed) document.querySelector(`.tab[data-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  syncTabFade();
  if ((tab === 'discover' && !state.discoverLoaded) || (tab === 'companies' && !state.companiesLoaded)) { if (!state.refreshPromise) refreshAll({ silent: true }); }
}
document.querySelectorAll('.stat').forEach((s) => s.addEventListener('click', () => {
  const v = s.dataset.view;
  if (v === 'open') setView('open');
  else if (v === 'networking') setView('networking');
  else if (v === 'applied-today') setView('networking', 'applied-today');
  else setView('open', v);
}));
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.tab)));

// On narrow screens the tabs scroll sideways; fade whichever edge has more tabs behind it.
const tabsEl = document.querySelector('.tabs');
function syncTabFade() {
  const max = tabsEl.scrollWidth - tabsEl.clientWidth;
  tabsEl.classList.toggle('can-scroll-left', max > 2 && tabsEl.scrollLeft > 2);
  tabsEl.classList.toggle('can-scroll-right', max > 2 && tabsEl.scrollLeft < max - 2);
}
tabsEl.addEventListener('scroll', syncTabFade, { passive: true });
window.addEventListener('resize', syncTabFade);
els.filterChip.addEventListener('click', () => setView(state.tab));
els.refreshBtn.addEventListener('click', () => { refreshAll(); });

els.jobList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-discover-action]');
  if (!button) return;
  if (!state.user) return chooseUser();
  const id = button.closest('.discover-row')?.dataset.id;
  const role = state.discover.find((item) => item.id === id);
  if (!role || state.discoverBusy.has(id)) return;
  state.discoverBusy.add(id);
  render();
  let saved = false;
  try {
    if (button.dataset.discoverAction === 'add') {
      const result = await api('discover', { method: 'POST', body: JSON.stringify({ id, actor: state.user }) });
      if (result.job) state.jobs.unshift(result.job);
      state.discover = state.discover.filter((item) => item.id !== id);
      if (state.notesKind === 'discover' && state.notesJobId === id) closeNotes();
      setView('open');
      showToast(`Added: ${jobLabel(result.job)}`);
    } else {
      await api('discover', { method: 'PATCH', body: JSON.stringify({ id, actor: state.user }) });
      state.discover = state.discover.filter((item) => item.id !== id);
      if (state.notesKind === 'discover' && state.notesJobId === id) closeNotes();
      showToast(`Dismissed: ${jobLabel(role)}`);
    }
    saved = true;
  } catch (err) {
    showToast(err.message, { error: true });
    if (err.message.includes('already')) loadDiscover({ silent: true });
  } finally {
    state.discoverBusy.delete(id);
    render();
    if (saved) refreshAll({ silent: true, afterAction: true });
  }
});

/* ---------- Changes (optimistic, with undo) ---------- */
const CLEARED_NETWORK = { network_status: null, network_updated_by: null, network_updated_at: null, network_closed_by: null, network_closed_at: null };

function localPatch(status, reason) {
  const now = new Date().toISOString();
  if (status === 'applied') return { status, applied_by: state.user, applied_at: now, ...CLEARED_NETWORK, network_status: 'not_networked', updated_at: now };
  if (status === 'blocked') return { status, blocked_by: state.user, blocked_at: now, blocked_reason: reason, ...CLEARED_NETWORK, updated_at: now };
  return { status, applied_by: null, applied_at: null, blocked_by: null, blocked_at: null, blocked_reason: '', ...CLEARED_NETWORK, updated_at: now };
}

function listFor(coll) { return coll === 'companies' ? state.companies : coll === 'discover' ? state.discover : coll === 'todos' ? state.todos : state.jobs; }
const collOf = (kind) => (kind === 'company' ? 'companies' : kind === 'discover' ? 'discover' : 'jobs');

// Apply a change locally right away, then save it. Saves for one job run in order; a failure rolls back.
function mutate(id, local, body, coll = 'jobs') {
  const job = listFor(coll).find((j) => j.id === id);
  if (!job) return Promise.resolve(null);
  const before = { ...job, notes: [...notesOf(job)], people: [...peopleOf(job)] };
  if (local) Object.assign(job, typeof local === 'function' ? local(job) : local);
  render();

  const prev = state.inflight.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => api(coll, {
    method: 'PATCH',
    body: JSON.stringify({ id, actor: state.user, ...body }),
  }));
  state.inflight.set(id, next);
  let saved = false;
  next.then((res) => {
    saved = true;
    const savedRow = res && (res.job || res.company || res.role || res.todo);
    if (state.inflight.get(id) === next && savedRow) Object.assign(job, savedRow);
  })
    .catch((err) => {
      if (state.inflight.get(id) === next) {
        Object.assign(job, before);
        showToast(`Couldn't save: ${err.message}`, { error: true });
      }
    })
    .finally(() => {
      if (state.inflight.get(id) === next) state.inflight.delete(id);
      render();
      if (saved) state.needsActionRefresh = true;
      if (state.inflight.size === 0 && state.needsActionRefresh) {
        state.needsActionRefresh = false;
        refreshAll({ silent: true, afterAction: true });
      }
    });
  return next;
}

function setStatus(id, status, reason = '') {
  return mutate(id, localPatch(status, reason), { action: 'status', status, blocked_reason: reason });
}

function setNetwork(id, networkStatus, restore = null) {
  const now = new Date().toISOString();
  const local = restore
    ? { network_status: networkStatus, network_updated_by: restore.by, network_updated_at: restore.at, updated_at: now }
    : { network_status: networkStatus, network_updated_by: state.user, network_updated_at: now, updated_at: now };
  return mutate(id, local, { action: 'network', network_status: networkStatus, ...(restore ? { restore } : {}) });
}

function closeJob(id) {
  const now = new Date().toISOString();
  return mutate(id, { network_closed_by: state.user, network_closed_at: now, updated_at: now }, { action: 'close' });
}

function reopenJob(id) {
  return mutate(id, { network_closed_by: null, network_closed_at: null, updated_at: new Date().toISOString() }, { action: 'reopen' });
}

// Bell: a soft two-strike chime synthesized with Web Audio (no audio file). On by default,
// muted with the bell button in the header (remembered per browser). Plays only from a click.
let audioCtx = null;
function soundOn() { return store.get('jobSprintSound') !== 'off'; }
function syncSound() {
  const on = soundOn();
  const label = on ? 'Mute bell sound' : 'Turn bell sound on';
  els.soundToggle.setAttribute('aria-pressed', String(on));
  els.soundToggle.setAttribute('aria-label', label);
  els.soundToggle.setAttribute('title', label);
}
function playBell(big) {
  if (!soundOn()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const strike = (when, freq, level) => {
      // Bell partials are not whole multiples of the base note, which is what makes it sound like metal.
      [[1, 1, 2.4], [2.01, 0.45, 1.6], [2.76, 0.28, 1.1], [5.4, 0.12, 0.6]].forEach(([ratio, amp, decay]) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(level * amp, when + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(when); osc.stop(when + decay + 0.05);
      });
    };
    const t = audioCtx.currentTime + 0.02;
    strike(t, 880, 0.22);
    if (big) strike(t + 0.16, 1318.5, 0.2); // milestone: a second, higher strike
  } catch { /* sound is a nicety; never block applying */ }
}
// Soft, short tick for checking off a to-do. Same mute button as the bell.
function playTick() {
  if (!soundOn()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime + 0.01;
    [[1568, 0.07, 0.22], [2349, 0.03, 0.12]].forEach(([freq, level, decay]) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g); g.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + decay + 0.05);
    });
  } catch { /* sound is a nicety */ }
}
els.soundToggle.addEventListener('click', () => {
  store.set('jobSprintSound', soundOn() ? 'off' : 'on');
  syncSound();
  playBell(false); // audible confirmation when turning on; silent when muting
});
syncSound();

// Celebration: a short confetti burst from the Applied button. Skipped for reduced-motion users.
const CHEER = { 1: 'First one of the day. Nice start.', 3: 'Three today. You’re rolling.', 5: 'Five applications today. Huge.', 10: 'Ten today! Take a bow.' };
function celebrate(originEl, big) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = originEl.getBoundingClientRect();
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const colors = ['#B5562F', '#E0A07F', '#D9A441', '#6E9F7B', '#7C8FB8', '#F2D9C8'];
  const n = big ? 160 : 70;
  const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  const bits = Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (big ? 2.6 : 1.8);
    const v = (big ? 11 : 8) * (0.5 + Math.random());
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0] };
  });
  const t0 = performance.now();
  (function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const b of bits) {
      b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 900) / 700);
      ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (t < 1600) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

function jobLabel(job) { return `${readableText(job.title || 'Role')}${job.company ? ` at ${readableText(job.company)}` : ''}`; }

els.jobList.addEventListener('click', (e) => {
  const hf = e.target.closest('[data-hfilter]');
  if (hf) { state.historyFilter = hf.dataset.hfilter; render(); return; }
  const cf = e.target.closest('[data-cofilter]');
  if (cf) { state.companyFilter = cf.dataset.cofilter; render(); return; }
  if (e.target.closest('[data-co-new]')) { openCompanyModal(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const discoverRowEl = btn.closest('.discover-row');
  if (discoverRowEl && btn.dataset.action === 'notes') { openNotes(discoverRowEl.dataset.id, 'discover'); return; }
  if (btn.dataset.action === 'owner') {
    const row = btn.closest('.job-row');
    const kind = row.classList.contains('company') ? 'company' : 'job';
    if (els.rowMenu.dataset.id === row.dataset.id && !els.rowMenu.classList.contains('hidden')) closeRowMenu();
    else openOwnerMenu(row.dataset.id, kind, btn);
    return;
  }
  if (btn.dataset.action === 'menu') {
    const row = btn.closest('.job-row');
    const kind = row.classList.contains('company') ? 'company' : 'job';
    if (els.rowMenu.dataset.id === row.dataset.id && !els.rowMenu.classList.contains('hidden')) closeRowMenu();
    else openRowMenu(row.dataset.id, kind, btn);
    return;
  }
  if (btn.dataset.action === 'company') { openNotes(btn.dataset.companyId, 'company'); return; }
  if (btn.closest('.job-row.company')) { openNotes(btn.closest('.job-row').dataset.id, 'company'); return; }
  const id = btn.closest('.job-row')?.dataset.id;
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  const action = btn.dataset.action;
  if (action === 'notes') { openNotes(id); return; }
  if (!state.user) return chooseUser();
  if (action === 'apply') {
    setStatus(id, 'applied');
    const today = buckets().appliedToday.length;
    playBell(today in CHEER);
    celebrate(btn, today in CHEER);
    showToast(CHEER[today] ? `${CHEER[today]} Moved to Networking: ${jobLabel(job)}` : `Applied · moved to Networking: ${jobLabel(job)}`, { undo: () => setStatus(id, 'pipeline') });
  } else if (action === 'block') {
    openBlockModal(job);
  } else if (action === 'done') {
    const outcome = NETWORK[netStatus(job)].label;
    closeJob(id);
    showToast(`Moved to History (${outcome}): ${jobLabel(job)}`, { undo: () => reopenJob(id) });
  } else if (action === 'restore') {
    if (job.status === 'blocked') {
      const prevReason = job.blocked_reason || '';
      setStatus(id, 'pipeline');
      showToast(`Back in To apply: ${jobLabel(job)}`, { undo: () => setStatus(id, 'blocked', prevReason) });
    } else {
      reopenJob(id);
      showToast(`Back in Networking: ${jobLabel(job)}`, { undo: () => closeJob(id) });
    }
  }
});

// Networking status dropdown: one change = saved, with undo.
els.jobList.addEventListener('change', (e) => {
  const select = e.target.closest('[data-net-select]');
  if (!select) return;
  const id = select.closest('.job-row')?.dataset.id;
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  if (!state.user) { select.value = netStatus(job); chooseUser(); return; }
  const prev = { status: netStatus(job), by: job.network_updated_by || null, at: job.network_updated_at || null };
  const next = select.value;
  if (next === prev.status) return;
  setNetwork(id, next);
  const hint = NETWORK_DONE.has(next) ? ' · click Done when finished' : '';
  showToast(`${NETWORK[next].label}${hint}`, { undo: () => setNetwork(id, prev.status, { by: prev.by, at: prev.at }) });
});

/* ---------- Notes drawer ---------- */
// Escape everything, turning only http(s) links into anchors.
function linkify(raw) {
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(re)) {
    out += escapeHtml(raw.slice(last, m.index));
    const url = escapeHtml(m[0]);
    out += `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(raw.slice(last));
}

function renderNotes() {
  const company = state.notesKind === 'company';
  const discover = state.notesKind === 'discover';
  const job = listFor(collOf(state.notesKind)).find((j) => j.id === state.notesJobId);
  if (!job) { closeNotes(); return; }
  els.peopleSection.classList.toggle('hidden', !company);
  els.companyFoot.classList.toggle('hidden', !company);
  els.notesDrawer.classList.toggle('is-company', company);
  if (company) {
    els.notesTitle.textContent = readableText(job.name);
    els.notesSub.textContent = [readableText(job.source || ''), STAGE[stageOfCompany(job)].label].filter(Boolean).join(' · ');
    renderPeople(job);
  } else if (discover) {
    els.notesTitle.textContent = readableText(job.title || 'Untitled role');
    els.notesSub.textContent = [readableText(job.company || ''), 'Discover'].filter(Boolean).join(' · ');
  } else {
    els.notesTitle.textContent = readableText(job.title || 'Untitled role');
    const stageLabel = { open: 'To apply', networking: `Networking · ${NETWORK[netStatus(job)].label}`, history: 'History' }[stageOf(job)];
    els.notesSub.textContent = [readableText(job.company || ''), stageLabel].filter(Boolean).join(' · ');
  }
  els.noteInput.placeholder = company ? 'Add a note: a post you saw, who to message first, what you sent…'
    : discover ? 'Add a note: why this one stands out, who could refer you… (it moves with the job)'
      : 'Add a note: who you reached out to, what they said, next step…';
  const notes = [...notesOf(job)].reverse();
  els.notesList.innerHTML = notes.length ? notes.map((n) => `
    <div class="note${n.pending ? ' pending' : ''}" data-note-id="${escapeHtml(n.id)}">
      <div class="note-head">
        <span class="mini-avatar ${userClass(n.by)}">${escapeHtml((n.by || '?')[0])}</span>
        <strong>${escapeHtml(n.by || 'Unknown')}</strong>
        <span class="note-when" title="${escapeHtml(n.at ? new Date(n.at).toLocaleString() : '')}">${n.pending ? 'Saving…' : relDate(n.at)}</span>
        ${n.pending ? '' : '<button class="note-delete" data-note-delete>Delete</button>'}
      </div>
      <p class="note-text">${linkify(readableText(n.text))}</p>
    </div>`).join('')
    : '<div class="notes-empty">No notes yet. Log who you contacted, what they said, and what comes next.</div>';
}

function openNotes(id, kind = 'job') {
  state.notesJobId = id;
  state.notesKind = kind;
  renderNotes();
  els.notesBackdrop.classList.remove('hidden');
  els.notesDrawer.classList.remove('hidden');
  els.noteInput.value = '';
  setTimeout(() => els.noteInput.focus(), 30);
}
function closeNotes() {
  state.notesJobId = null;
  els.notesBackdrop.classList.add('hidden');
  els.notesDrawer.classList.add('hidden');
}
function addNote() {
  const id = state.notesJobId;
  const text = els.noteInput.value.trim();
  if (!id || !text) { els.noteInput.focus(); return; }
  if (!state.user) { chooseUser(); return; }
  if (text.length > 1000) { showToast('Notes can be up to 1,000 characters.', { error: true }); return; }
  const temp = { id: `pending-${Date.now()}`, text, by: state.user, at: new Date().toISOString(), pending: true };
  els.noteInput.value = '';
  mutate(id, (job) => ({ notes: [...notesOf(job), temp] }), { action: 'add-note', text }, collOf(state.notesKind));
}
function deleteNote(noteId, button) {
  const id = state.notesJobId;
  if (!id) return;
  // Two-step delete: first click asks, second click deletes.
  if (button.dataset.confirm !== 'yes') {
    button.dataset.confirm = 'yes';
    button.textContent = 'Delete?';
    button.classList.add('confirming');
    setTimeout(() => { if (button.isConnected) { button.dataset.confirm = ''; button.textContent = 'Delete'; button.classList.remove('confirming'); } }, 3000);
    return;
  }
  if (!state.user) { chooseUser(); return; }
  mutate(id, (job) => ({ notes: notesOf(job).filter((n) => n.id !== noteId) }), { action: 'delete-note', note_id: noteId }, collOf(state.notesKind));
}

els.closeNotes.addEventListener('click', closeNotes);
els.notesBackdrop.addEventListener('click', closeNotes);
els.noteForm.addEventListener('submit', (e) => { e.preventDefault(); addNote(); });
els.noteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addNote(); }
});
els.notesList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-note-delete]');
  if (del) deleteNote(del.closest('.note').dataset.noteId, del);
});

/* ---------- Row menu (⋯ button or right-click) and Delete ---------- */
const MENU_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
function menuButton() {
  return `<button class="btn ghost small menu-btn" data-action="menu" aria-label="More actions" aria-haspopup="menu" title="More actions">${MENU_ICON}</button>`;
}
function entryOf(id, kind) { return (kind === 'company' ? state.companies : kind === 'todo' ? state.todos : state.jobs).find((x) => x.id === id); }

// Opens next to a button, or at the pointer for a right-click.
function openRowMenu(id, kind, anchor, point) {
  const entry = entryOf(id, kind);
  if (!entry) return;
  const items = kind === 'company'
    ? '<button role="menuitem" class="menu-item" data-menu="open">Open people &amp; notes</button>'
    : '<button role="menuitem" class="menu-item" data-menu="copy">Copy job link</button>';
  showRowMenu(id, kind, `${items}<button role="menuitem" class="menu-item" data-menu="todo">Add to-do…</button><button role="menuitem" class="menu-item danger" data-menu="delete">Delete…</button>`, anchor, point);
}
function openOwnerMenu(id, kind, anchor) {
  const entry = entryOf(id, kind);
  if (!entry) return;
  const current = entry.assigned_to || '';
  const options = [['Garima', 'Garima'], ['Indresh', 'Indresh'], ['', 'Unassigned']];
  showRowMenu(id, kind, `<div class="menu-title">Assign to</div>${options.map(([value, label]) => `<button role="menuitem" class="menu-item${value === current ? ' current' : ''}" data-menu="assign" data-owner="${value}">${label}${value === current ? '<span class="menu-check" aria-hidden="true">✓</span>' : ''}</button>`).join('')}`, anchor, null, 'left');
}
function showRowMenu(id, kind, itemsHtml, anchor, point, align = 'right') {
  els.rowMenu.innerHTML = itemsHtml;
  els.rowMenu.dataset.id = id;
  els.rowMenu.dataset.kind = kind;
  els.rowMenu.classList.remove('hidden');
  const w = els.rowMenu.offsetWidth;
  const h = els.rowMenu.offsetHeight;
  let x; let y;
  if (anchor) { const r = anchor.getBoundingClientRect(); x = align === 'left' ? r.left : r.right - w; y = r.bottom + 6; } else { x = point.x; y = point.y; }
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  if (y + h > innerHeight - 8) y = Math.max(8, (anchor ? anchor.getBoundingClientRect().top - h - 6 : y - h));
  els.rowMenu.style.left = `${x}px`;
  els.rowMenu.style.top = `${y}px`;
  els.rowMenu.querySelector('.menu-item').focus({ preventScroll: true });
}
function closeRowMenu() {
  els.rowMenu.classList.add('hidden');
  els.rowMenu.dataset.id = '';
}
els.rowMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-menu]');
  if (!item) return;
  const { id, kind } = els.rowMenu.dataset;
  const entry = entryOf(id, kind);
  if (!entry) { closeRowMenu(); return; }
  if (kind === 'todo') { todoMenuAction(entry, item); return; }
  if (item.dataset.menu === 'todo') {
    closeRowMenu();
    const label = kind === 'company' ? readableText(entry.name) : readableText(entry.company || entry.title || 'Job');
    openTodos({ link: { kind: kind === 'company' ? 'company' : 'job', id, label } });
    return;
  }
  if (item.dataset.menu === 'assign') { closeRowMenu(); assignOwner(id, kind, item.dataset.owner || null); return; }
  if (item.dataset.menu === 'open') { closeRowMenu(); openNotes(id, 'company'); return; }
  if (item.dataset.menu === 'copy') {
    closeRowMenu();
    showToast(await copyText(entry.url) ? 'Job link copied' : 'Couldn’t copy the link', { error: false });
    return;
  }
  if (item.dataset.menu === 'delete') {
    if (!confirmTwice(item, 'Click again to delete')) return;
    closeRowMenu();
    deleteEntry(id, kind);
  }
});
els.rowMenu.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...els.rowMenu.querySelectorAll('.menu-item')];
  const i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
});
document.addEventListener('mousedown', (e) => {
  if (!els.rowMenu.classList.contains('hidden') && !e.target.closest('#rowMenu, .menu-btn, .own, .tmenu')) closeRowMenu();
});
window.addEventListener('resize', closeRowMenu);
window.addEventListener('scroll', closeRowMenu, true);
els.jobList.addEventListener('contextmenu', (e) => {
  if (e.target.closest('a, input, select, textarea')) return; // keep the browser menu for links and fields
  const row = e.target.closest('.job-row[data-id]');
  if (!row) return;
  const kind = row.classList.contains('company') ? 'company' : 'job';
  if (!entryOf(row.dataset.id, kind)) return; // Discover rows have their own Dismiss
  e.preventDefault();
  openRowMenu(row.dataset.id, kind, null, { x: e.clientX, y: e.clientY });
});

function assignOwner(id, kind, who) {
  if (!state.user) { chooseUser(); return; }
  const entry = entryOf(id, kind);
  if (!entry) return;
  const prev = entry.assigned_to || null;
  if (prev === who) return;
  mutate(id, { assigned_to: who, updated_at: new Date().toISOString() }, { action: 'assign', assigned_to: who }, collOf(kind));
  showToast(who ? `Assigned to ${who}` : 'Now unassigned', { undo: () => assignOwner(id, kind, prev) });
}

// Delete removes the row at once and offers a six-second Undo that puts it back exactly as it was.
async function deleteEntry(id, kind) {
  if (!state.user) { chooseUser(); return; }
  const coll = kind === 'company' ? 'companies' : 'jobs';
  const row = entryOf(id, kind);
  if (!row) return;
  const label = kind === 'company' ? readableText(row.name) : jobLabel(row);
  const snapshot = JSON.parse(JSON.stringify(row));
  snapshot.notes = notesOf(snapshot).filter((n) => !n.pending);
  if (kind === 'company') snapshot.people = peopleOf(snapshot).filter((p) => !p.pending);
  if (state.notesJobId === id) closeNotes();
  const drop = (list) => list.filter((x) => x.id !== id);
  const removeLocal = () => { if (kind === 'company') state.companies = drop(state.companies); else state.jobs = drop(state.jobs); render(); };
  const putBack = (entry) => {
    const list = kind === 'company' ? state.companies : state.jobs;
    if (!list.some((x) => x.id === entry.id)) list.push(entry);
    render();
  };

  const run = (state.inflight.get(id) || Promise.resolve()).catch(() => {}).then(() => {
    removeLocal();
    return api(coll, { method: 'PATCH', body: JSON.stringify({ id, actor: state.user, action: 'delete' }) });
  });
  state.inflight.set(id, run);
  try {
    await run;
  } catch (err) {
    putBack(snapshot);
    showToast(`Couldn't delete: ${err.message}`, { error: true });
    return;
  } finally {
    if (state.inflight.get(id) === run) state.inflight.delete(id);
  }
  showToast(`Deleted ${label}`, {
    undo: async () => {
      try {
        const res = await api(coll, { method: 'POST', body: JSON.stringify({ actor: state.user, restore: snapshot }) });
        putBack(res.job || res.company || snapshot);
        showToast(`Restored ${label}`);
        refreshAll({ silent: true, afterAction: true });
      } catch (err) {
        showToast(`Couldn't restore: ${err.message}`, { error: true });
      }
    },
  });
  refreshAll({ silent: true, afterAction: true });
}

/* ---------- Block dialog ---------- */
function openBlockModal(job) {
  state.pendingBlockId = job.id;
  els.blockJobName.textContent = jobLabel(job);
  els.blockReason.value = '';
  els.blockModal.classList.remove('hidden');
  setTimeout(() => els.blockReason.focus(), 30);
}
function closeBlockModal() {
  state.pendingBlockId = null;
  els.blockModal.classList.add('hidden');
}
function confirmBlock(reason) {
  const id = state.pendingBlockId;
  const job = state.jobs.find((j) => j.id === id);
  closeBlockModal();
  if (!job) return;
  setStatus(id, 'blocked', reason.trim().slice(0, 500));
  showToast(`Blocked: ${jobLabel(job)}`, { undo: () => setStatus(id, 'pipeline') });
}
els.closeBlockModal.addEventListener('click', closeBlockModal);
els.cancelBlock.addEventListener('click', closeBlockModal);
els.confirmBlock.addEventListener('click', () => confirmBlock(els.blockReason.value));
els.reasonChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.reason-chip');
  if (chip) confirmBlock(chip.dataset.reason); // one click = done
});
els.blockReason.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmBlock(els.blockReason.value); }
});

/* ---------- Add a job: paste → check → Enter ---------- */
function findDuplicate(url) {
  const key = normalizeUrl(url);
  return state.jobs.find((j) => normalizeUrl(j.url || '') === key);
}

function openPanel() { els.addPanel.classList.remove('hidden'); }
function closePanel() {
  state.preview = null;
  els.addPanel.classList.add('hidden');
  els.parseStatus.classList.add('hidden');
  els.dupWarning.classList.add('hidden');
  [els.titleInput, els.companyInput, els.locationInput].forEach((i) => { i.value = ''; i.classList.remove('missing'); });
}

function setFieldsDisabled(disabled) {
  [els.titleInput, els.companyInput, els.locationInput, els.saveJob].forEach((i) => { i.disabled = disabled; });
}

async function startAdd(raw) {
  const url = (raw || '').trim();
  if (!url) { els.jobUrl.focus(); return; }
  if (!isHttpUrl(url)) { showToast('That doesn’t look like a job link.', { error: true }); return; }

  const token = Symbol('parse');
  state.preview = { url, token };
  els.jobUrl.value = '';
  els.jobUrl.blur();
  openPanel();
  els.addPanelUrl.textContent = url.replace(/^https?:\/\/(www\.)?/, '');
  els.parseConfidence.classList.add('hidden');
  els.parseStatus.textContent = 'Reading the job page…';
  els.parseStatus.classList.remove('hidden', 'error');
  [els.titleInput, els.companyInput, els.locationInput].forEach((i) => { i.value = ''; i.classList.remove('missing'); });
  setFieldsDisabled(true);
  els.saveJob.innerHTML = 'Save <kbd class="kbd-inline">↵</kbd>';

  const dup = findDuplicate(url);
  if (dup) {
    const where = { open: 'already in To apply', networking: 'already in Networking', history: 'already in History' }[stageOf(dup)];
    els.dupWarning.textContent = `Heads up: “${jobLabel(dup)}” is ${where}. ${dup.added_by} added it ${relDate(dup.added_at)}.`;
    els.dupWarning.classList.remove('hidden');
    els.saveJob.innerHTML = 'Save anyway';
  } else {
    els.dupWarning.classList.add('hidden');
  }

  let data = null;
  try { data = await api('parse-job', { method: 'POST', body: JSON.stringify({ url }) }); } catch { data = null; }
  if (!state.preview || state.preview.token !== token) return; // user cancelled or pasted another link

  setFieldsDisabled(false);
  if (data) {
    els.titleInput.value = data.title || '';
    els.companyInput.value = data.company || '';
    els.locationInput.value = data.location || '';
    const conf = data.confidence;
    els.parseConfidence.textContent = conf === 'high' ? 'Looks right' : conf === 'medium' ? 'Double-check' : 'Needs review';
    els.parseConfidence.className = `confidence ${conf === 'high' ? 'high' : conf === 'medium' ? '' : 'low'}`;
    els.parseStatus.classList.add('hidden');
  } else {
    els.parseConfidence.textContent = 'Manual';
    els.parseConfidence.className = 'confidence low';
    els.parseStatus.textContent = 'Couldn’t read this page. Type the role and company, then press Enter.';
    els.parseStatus.classList.add('error');
  }

  // Flag what's missing and put the cursor where it's needed. If nothing is missing, Enter saves.
  let firstMissing = null;
  [els.titleInput, els.companyInput].forEach((i) => {
    const miss = !i.value.trim();
    i.classList.toggle('missing', miss);
    if (miss && !firstMissing) firstMissing = i;
  });
  (firstMissing || els.saveJob).focus();
}

async function saveJob() {
  if (!state.preview) return;
  if (!state.user) { chooseUser(); return; }
  const title = els.titleInput.value.trim();
  const company = els.companyInput.value.trim();
  const location = els.locationInput.value.trim();
  let firstMissing = null;
  [[els.titleInput, title], [els.companyInput, company]].forEach(([i, v]) => {
    i.classList.toggle('missing', !v);
    if (!v && !firstMissing) firstMissing = i;
  });
  if (firstMissing) { firstMissing.focus(); showToast('Role and company are needed.', { error: true }); return; }

  els.saveJob.disabled = true;
  els.saveJob.textContent = 'Saving…';
  try {
    const res = await api('jobs', {
      method: 'POST',
      body: JSON.stringify({ company, title, location, url: state.preview.url, added_by: state.user }),
    });
    if (res.job) state.jobs.unshift(res.job);
    closePanel();
    if (state.tab !== 'open' || state.filter === 'backlog') setView('open'); else render();
    showToast(`Added: ${title} at ${company}`);
    els.jobUrl.focus();
    refreshAll({ silent: true, afterAction: true });
  } catch (err) {
    showToast(err.message, { error: true });
  } finally {
    els.saveJob.disabled = false;
    els.saveJob.innerHTML = 'Save <kbd class="kbd-inline">↵</kbd>';
  }
}

els.addForm.addEventListener('submit', (e) => { e.preventDefault(); startAdd(els.jobUrl.value); });
els.previewForm.addEventListener('submit', (e) => { e.preventDefault(); saveJob(); });
els.cancelPreview.addEventListener('click', closePanel);
[els.titleInput, els.companyInput].forEach((i) => i.addEventListener('input', () => { if (i.value.trim()) i.classList.remove('missing'); }));

// Pasting a link into the bar starts reading it right away (no extra click).
els.jobUrl.addEventListener('paste', (e) => {
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (isHttpUrl(text)) { e.preventDefault(); startAdd(text); }
});
// Pasting a link anywhere on the page does the same.
document.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  if (!els.userModal.classList.contains('hidden') || !els.blockModal.classList.contains('hidden') || !els.companyModal.classList.contains('hidden') || state.notesJobId || state.todoOpen) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (isHttpUrl(text)) { e.preventDefault(); startAdd(text); }
});

/* ---------- To-do (one list each for Garima and Indresh) ---------- */
const TODO_DONE_DAYS = 7;
const TODO_ICONS = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
};
const otherUser = (name) => (name === 'Garima' ? 'Indresh' : 'Garima');
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function dayKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function recentDone(t) { return t.done && (!t.done_at || Date.now() - Date.parse(t.done_at) < TODO_DONE_DAYS * DAY); }
function todoLists(owner) {
  const mine = state.todos.filter((t) => t.owner === owner);
  return {
    open: mine.filter((t) => !t.done).sort((a, b) => a.position - b.position || String(a.added_at).localeCompare(String(b.added_at))),
    done: mine.filter(recentDone).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))),
  };
}
function dueInfo(due) {
  if (!due) return null;
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((date - startOfToday()) / DAY);
  const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  if (diff < 0) return { label: diff === -1 ? 'Yesterday' : short, cls: 'late', title: `Overdue: was due ${short}` };
  if (diff === 0) return { label: 'Today', cls: 'today', title: 'Due today' };
  if (diff === 1) return { label: 'Tomorrow', cls: '', title: `Due ${short}` };
  if (diff < 7) return { label: weekday, cls: '', title: `Due ${weekday} ${short}` };
  return { label: short, cls: '', title: `Due ${short}` };
}
function linkTarget(t) {
  if (!t.link_kind || !t.link_id) return null;
  return entryOf(t.link_id, t.link_kind === 'company' ? 'company' : 'job') || null;
}
function todoItemHtml(t) {
  const checking = state.todoChecking.has(t.id);
  const done = t.done || checking;
  const meta = [];
  if (t.link_kind && t.link_label) {
    const live = linkTarget(t);
    const inner = `${coTile(t.link_label, true)}${escapeHtml(t.link_label)}`;
    meta.push(live
      ? `<button type="button" class="tchip" data-todo-link title="Open ${escapeHtml(t.link_label)}">${inner}</button>`
      : `<span class="tchip gone" title="This ${t.link_kind} was removed">${inner}</span>`);
  }
  const due = !t.done && dueInfo(t.due_on);
  if (due) meta.push(`<span class="tdue ${due.cls}" title="${escapeHtml(due.title)}">${TODO_ICONS.cal}${escapeHtml(due.label)}</span>`);
  if (t.added_by && t.added_by !== t.owner) meta.push(`<span class="tfrom"><span class="mini-avatar ${userClass(t.added_by)}">${escapeHtml(t.added_by[0])}</span>from ${escapeHtml(t.added_by)}</span>`);
  if (t.done && t.done_at) {
    const when = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(t.done_at));
    meta.push(`<span class="tby">Done ${daysOld(t.done_at) === 0 ? 'today' : escapeHtml(when)}${t.done_by && t.done_by !== t.owner ? ` by ${escapeHtml(t.done_by)}` : ''}</span>`);
  }
  const label = escapeHtml(readableText(t.text));
  return `<li class="todo${t.done ? ' done' : ''}${checking ? ' checking' : ''}${t.pending ? ' pending' : ''}" data-todo-id="${escapeHtml(t.id)}">
    ${t.done ? '<span class="grip-space"></span>' : `<button type="button" class="grip" data-todo-grip aria-label="Reorder ${label}. Use arrow keys to move." title="Drag to reorder">${TODO_ICONS.grip}</button>`}
    <button type="button" class="tbox" role="checkbox" aria-checked="${done}" data-todo-check aria-label="${done ? 'Mark not done' : 'Mark done'}: ${label}">${TODO_ICONS.tick}</button>
    <div class="tbody"><div class="ttext"${t.done ? '' : ' data-todo-text title="Click to edit"'}>${linkify(readableText(t.text))}</div>${meta.length ? `<div class="tmeta">${meta.join('')}</div>` : ''}</div>
    <button type="button" class="tmenu" data-todo-menu aria-label="More actions for ${label}" aria-haspopup="menu" title="More">${MENU_ICON}</button>
  </li>`;
}
function renderTodoBadge() {
  const mine = state.user ? state.todos.filter((t) => t.owner === state.user && !t.done) : [];
  els.todoCount.textContent = mine.length;
  els.todoCount.classList.toggle('hidden', !mine.length);
  const urgent = mine.some((t) => { const d = dueInfo(t.due_on); return d && (d.cls === 'late' || d.cls === 'today'); });
  els.todoCount.classList.toggle('urgent', urgent);
  els.todoBtn.title = mine.length ? `Your to-do list: ${plural(mine.length, 'open item')}${urgent ? ', something due' : ''}` : 'Your to-do list';
  els.todoBtn.classList.toggle('open', state.todoOpen);
  els.todoBtn.setAttribute('aria-expanded', String(state.todoOpen));
}
function renderTodos() {
  renderTodoBadge();
  if (!state.todoOpen) return;
  const view = state.todoView || state.user || 'Garima';
  const lists = todoLists(view);
  const yours = view === state.user;
  els.todoTitle.textContent = yours ? 'Your plate' : `${view}’s plate`;
  els.todoSub.textContent = `${plural(lists.open.length, 'open item')} · ${lists.done.length} done this week`;
  els.todoInput.placeholder = yours ? 'Add a to-do' : `Add to ${view}’s list`;
  els.todoSwitch.innerHTML = USERS.map((u) => {
    const n = state.todos.filter((t) => t.owner === u && !t.done).length;
    return `<button type="button" class="${u === view ? 'on' : ''}" data-todo-view="${u}" aria-pressed="${u === view}"><span class="mini ${userClass(u)}">${u[0]}</span>${u}<span class="n">${n}</span></button>`;
  }).join('');
  const d = state.todoDraftLink;
  els.todoDraft.classList.toggle('hidden', !d);
  els.todoDraft.innerHTML = d ? `<span class="tchip">${coTile(d.label, true)}${escapeHtml(d.label)}<button type="button" class="tdraft-x" data-todo-draft-clear aria-label="Don’t link ${escapeHtml(d.label)}">×</button></span>` : '';
  if (state.todoDrag || state.todoEditing) return; // don't rebuild the list under the pointer or the edit box

  if (!state.todosLoaded) { els.todoOpenList.innerHTML = '<li class="tempty">Loading…</li>'; els.todoDoneWrap.innerHTML = ''; return; }
  // Rebuilding the list would drop keyboard focus, so remember which control had it.
  const active = document.activeElement;
  const focusId = active && els.todoScroll.contains(active) ? active.closest('.todo')?.dataset.todoId : null;
  const focusPart = focusId ? ['data-todo-grip', 'data-todo-check', 'data-todo-menu', 'data-todo-link'].find((a) => active.hasAttribute(a)) : null;
  els.todoOpenList.innerHTML = lists.open.length
    ? lists.open.map(todoItemHtml).join('')
    : `<li class="tempty">${lists.done.length ? 'All clear. Nice work.' : yours ? 'Nothing on your plate yet. Add the next thing you’ll do.' : `${view}’s list is empty. Anything you add here goes to ${view}.`}</li>`;
  els.todoDoneWrap.innerHTML = lists.done.length ? `
    <button type="button" class="tdone-head" data-todo-done-toggle aria-expanded="${!state.todoDoneCollapsed}"><span class="chev${state.todoDoneCollapsed ? ' shut' : ''}" aria-hidden="true">▾</span>Done · ${lists.done.length}<span class="clear">Clears after ${TODO_DONE_DAYS} days</span></button>
    ${state.todoDoneCollapsed ? '' : `<ul class="tlist" aria-label="Done">${lists.done.map(todoItemHtml).join('')}</ul>`}` : '';
  if (focusId && focusPart) els.todoScroll.querySelector(`.todo[data-todo-id="${CSS.escape(focusId)}"] [${focusPart}]`)?.focus({ preventScroll: true });
}

function openTodos({ link = null } = {}) {
  if (!state.user) { chooseUser(); return; }
  if (state.notesJobId) closeNotes();
  if (link || !state.todoOpen) state.todoView = state.user;
  state.todoDraftLink = link;
  state.todoOpen = true;
  els.todoBackdrop.classList.remove('hidden');
  els.todoDrawer.classList.remove('hidden');
  render();
  // On touch screens, don't pop the keyboard just for looking at the list.
  if (link || window.matchMedia('(hover: hover)').matches) setTimeout(() => els.todoInput.focus(), 30);
  if (!state.todosLoaded) loadTodos();
}
function closeTodos() {
  if (state.todoEditing) finishTodoEdit(true);
  state.todoOpen = false;
  state.todoDraftLink = null;
  els.todoBackdrop.classList.add('hidden');
  els.todoDrawer.classList.add('hidden');
  closeRowMenu();
  renderTodoBadge();
  els.todoBtn.focus({ preventScroll: true });
}

function addTodo() {
  if (!state.user) { chooseUser(); return; }
  const text = els.todoInput.value.replace(/\s+/g, ' ').trim();
  if (!text) { els.todoInput.focus(); return; }
  if (text.length > 500) { showToast('To-dos can be up to 500 characters.', { error: true }); return; }
  const owner = state.todoView || state.user;
  const open = todoLists(owner).open;
  const position = open.length ? open[0].position - 1 : 0;
  const link = state.todoDraftLink;
  const now = new Date().toISOString();
  const item = {
    id: newId(), owner, text, done: false, done_at: null, done_by: null, position, due_on: null,
    link_kind: link ? link.kind : null, link_id: link ? link.id : null, link_label: link ? link.label : null,
    added_by: state.user, added_at: now, updated_at: now, pending: true,
  };
  state.todos.push(item);
  els.todoInput.value = '';
  state.todoDraftLink = null;
  render();
  const run = api('todos', { method: 'POST', body: JSON.stringify({ ...item, pending: undefined }) });
  state.inflight.set(item.id, run);
  run.then((res) => { Object.assign(item, res.todo || {}, { pending: false }); })
    .catch((err) => {
      state.todos = state.todos.filter((t) => t !== item);
      if (!els.todoInput.value) els.todoInput.value = text;
      showToast(`Couldn't add: ${err.message}`, { error: true });
    })
    .finally(() => { if (state.inflight.get(item.id) === run) state.inflight.delete(item.id); render(); });
}

function toggleTodo(id) {
  if (!state.user) { chooseUser(); return; }
  const t = state.todos.find((x) => x.id === id);
  if (!t || state.todoChecking.has(id)) return;
  if (t.done) {
    const open = todoLists(t.owner).open;
    const position = open.length ? open[open.length - 1].position + 1 : 0;
    mutate(id, { done: false, done_at: null, done_by: null, position }, { action: 'toggle', done: false, position }, 'todos');
    return;
  }
  // Strike it through where it is, then let it slide down to Done.
  const before = t.position;
  state.todoChecking.add(id);
  playTick();
  render();
  setTimeout(() => {
    state.todoChecking.delete(id);
    mutate(id, { done: true, done_at: new Date().toISOString(), done_by: state.user }, { action: 'toggle', done: true }, 'todos');
    showToast(`Done: ${readableText(t.text).slice(0, 60)}`, {
      undo: () => mutate(id, { done: false, done_at: null, done_by: null, position: before }, { action: 'toggle', done: false, position: before }, 'todos'),
    });
  }, 420);
}

function startTodoEdit(id) {
  const li = els.todoDrawer.querySelector(`.todo[data-todo-id="${CSS.escape(id)}"]`);
  const t = state.todos.find((x) => x.id === id);
  if (!li || !t || t.done) return;
  if (state.todoEditing) finishTodoEdit(false);
  state.todoEditing = id;
  const box = li.querySelector('.ttext');
  const ta = document.createElement('textarea');
  ta.className = 'tedit'; ta.maxLength = 500; ta.rows = 1; ta.value = readableText(t.text);
  ta.setAttribute('aria-label', 'Edit to-do');
  box.replaceWith(ta);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
  grow();
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); finishTodoEdit(false); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishTodoEdit(true); }
  });
  ta.addEventListener('blur', () => { if (state.todoEditing === id) finishTodoEdit(false); });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function finishTodoEdit(cancel) {
  const id = state.todoEditing;
  if (!id) return;
  const ta = els.todoDrawer.querySelector('.tedit');
  const value = ta ? ta.value.replace(/\s+/g, ' ').trim() : '';
  state.todoEditing = null;
  const t = state.todos.find((x) => x.id === id);
  if (!cancel && t && value && value !== readableText(t.text)) {
    mutate(id, { text: value, updated_at: new Date().toISOString() }, { action: 'edit', text: value }, 'todos');
  } else render();
}

// Position for an item dropped at `index` among `list` (which excludes the item itself).
function positionAt(list, index) {
  const prev = list[index - 1];
  const next = list[index];
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return 0;
}
function moveTodo(id, index) {
  const t = state.todos.find((x) => x.id === id);
  if (!t) return;
  let list = todoLists(t.owner).open.filter((x) => x.id !== id);
  index = Math.max(0, Math.min(index, list.length));
  const prev = list[index - 1];
  const next = list[index];
  // After many moves between the same two items the gap gets tiny: renumber the list first.
  if (prev && next && Math.abs(next.position - prev.position) < 1e-6) {
    list.forEach((x, i) => { if (x.position !== i) mutate(x.id, { position: i }, { action: 'move', position: i }, 'todos'); });
    list = todoLists(t.owner).open.filter((x) => x.id !== id);
  }
  const position = positionAt(list, index);
  if (position === t.position) return;
  mutate(id, { position }, { action: 'move', position }, 'todos');
}

// Drag to reorder: pointer events so it works with a mouse and on phones.
function startTodoDrag(e, grip) {
  const li = grip.closest('.todo');
  const ul = els.todoOpenList;
  const items = [...ul.querySelectorAll('.todo')];
  const from = items.indexOf(li);
  if (from < 0 || items.length < 2) return;
  e.preventDefault();
  grip.setPointerCapture?.(e.pointerId);
  const h = li.offsetHeight;
  const mids = items.map((x) => x.offsetTop + x.offsetHeight / 2);
  state.todoDrag = { id: li.dataset.todoId, li, items, from, to: from, h, mids, startY: e.clientY, y: e.clientY, startScroll: els.todoScroll.scrollTop, raf: 0, moved: false };
  li.classList.add('lift');
  ul.classList.add('sorting');
  const frame = () => {
    const d = state.todoDrag;
    if (!d) return;
    const r = els.todoScroll.getBoundingClientRect();
    if (d.y < r.top + 48) els.todoScroll.scrollTop -= 8;
    else if (d.y > r.bottom - 48) els.todoScroll.scrollTop += 8;
    const dy = d.y - d.startY + (els.todoScroll.scrollTop - d.startScroll);
    if (Math.abs(dy) > 3) d.moved = true;
    d.li.style.transform = `translateY(${dy}px)`;
    const center = d.li.offsetTop + d.h / 2 + dy;
    let to = 0;
    d.items.forEach((x, i) => { if (i !== d.from && d.mids[i] < center) to += 1; });
    d.to = to;
    d.items.forEach((x, i) => {
      if (i === d.from) return;
      let shift = 0;
      if (d.from < to && i > d.from && i <= to) shift = -d.h;
      if (d.from > to && i >= to && i < d.from) shift = d.h;
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    d.raf = requestAnimationFrame(frame);
  };
  state.todoDrag.raf = requestAnimationFrame(frame);
}
function moveTodoDrag(e) { if (state.todoDrag) state.todoDrag.y = e.clientY; }
function endTodoDrag() {
  const d = state.todoDrag;
  if (!d) return;
  cancelAnimationFrame(d.raf);
  state.todoDrag = null;
  els.todoOpenList.classList.remove('sorting');
  d.items.forEach((x) => { x.style.transform = ''; x.classList.remove('lift'); });
  if (d.moved && d.to !== d.from) moveTodo(d.id, d.to);
  else render();
}

function openTodoMenu(t, anchor, point) {
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + DAY + 3600000);
  const other = otherUser(t.owner);
  const linkLabel = t.link_label ? escapeHtml(t.link_label) : '';
  const items = t.done ? '<button role="menuitem" class="menu-item danger" data-menu="tdelete">Delete</button>' : `
    <div class="menu-title">Due</div>
    <button role="menuitem" class="menu-item" data-menu="due" data-due="${dayKey(today)}">Today${t.due_on === dayKey(today) ? '<span class="menu-check" aria-hidden="true">✓</span>' : ''}</button>
    <button role="menuitem" class="menu-item" data-menu="due" data-due="${dayKey(tomorrow)}">Tomorrow${t.due_on === dayKey(tomorrow) ? '<span class="menu-check" aria-hidden="true">✓</span>' : ''}</button>
    <label class="menu-item menu-date">Pick a date<input type="date" data-todo-date value="${escapeHtml(t.due_on || '')}" aria-label="Due date" /></label>
    ${t.due_on ? '<button role="menuitem" class="menu-item" data-menu="due" data-due="">No due date</button>' : ''}
    <div class="menu-sep"></div>
    <button role="menuitem" class="menu-item" data-menu="tmove">Move to ${other}’s list</button>
    ${t.link_kind ? `<button role="menuitem" class="menu-item" data-menu="unlink">Unlink ${linkLabel}</button>` : ''}
    <button role="menuitem" class="menu-item danger" data-menu="tdelete">Delete</button>`;
  showRowMenu(t.id, 'todo', items, anchor, point);
}
function setTodoDue(t, due) {
  const prev = t.due_on || null;
  const next = due || null;
  if (prev === next) return;
  mutate(t.id, { due_on: next }, { action: 'due', due_on: next }, 'todos');
}
function todoMenuAction(t, item) {
  const what = item.dataset.menu;
  if (what === 'due') { closeRowMenu(); setTodoDue(t, item.dataset.due); return; }
  if (what === 'unlink') { closeRowMenu(); mutate(t.id, { link_kind: null, link_id: null, link_label: null }, { action: 'unlink' }, 'todos'); return; }
  if (what === 'tmove') {
    closeRowMenu();
    const from = t.owner;
    const to = otherUser(from);
    const back = t.position;
    const open = todoLists(to).open;
    const position = open.length ? open[0].position - 1 : 0;
    mutate(t.id, { owner: to, position }, { action: 'move', owner: to, position }, 'todos');
    showToast(`Moved to ${to}’s list`, { undo: () => mutate(t.id, { owner: from, position: back }, { action: 'move', owner: from, position: back }, 'todos') });
    return;
  }
  if (what === 'tdelete') { closeRowMenu(); deleteTodo(t.id); }
}
async function deleteTodo(id) {
  if (!state.user) { chooseUser(); return; }
  const row = state.todos.find((x) => x.id === id);
  if (!row) return;
  const snapshot = { ...row };
  delete snapshot.pending; delete snapshot.notes; delete snapshot.people;
  const run = (state.inflight.get(id) || Promise.resolve()).catch(() => {}).then(() => {
    state.todos = state.todos.filter((x) => x.id !== id);
    render();
    return api('todos', { method: 'PATCH', body: JSON.stringify({ id, actor: state.user, action: 'delete' }) });
  });
  state.inflight.set(id, run);
  try { await run; } catch (err) {
    if (!state.todos.some((x) => x.id === id)) state.todos.push(snapshot);
    render();
    showToast(`Couldn't delete: ${err.message}`, { error: true });
    return;
  } finally { if (state.inflight.get(id) === run) state.inflight.delete(id); }
  showToast(`Deleted: ${readableText(row.text).slice(0, 60)}`, {
    undo: async () => {
      try {
        const res = await api('todos', { method: 'POST', body: JSON.stringify({ actor: state.user, restore: snapshot }) });
        if (!state.todos.some((x) => x.id === id)) state.todos.push(res.todo || snapshot);
        render();
      } catch (err) { showToast(`Couldn't restore: ${err.message}`, { error: true }); }
    },
  });
}

els.todoBtn.addEventListener('click', () => (state.todoOpen ? closeTodos() : openTodos()));
els.closeTodo.addEventListener('click', closeTodos);
els.todoBackdrop.addEventListener('click', closeTodos);
els.todoForm.addEventListener('submit', (e) => { e.preventDefault(); addTodo(); });
els.todoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && !els.todoInput.value && state.todoDraftLink) { state.todoDraftLink = null; renderTodos(); }
});
els.todoDraft.addEventListener('click', (e) => {
  if (e.target.closest('[data-todo-draft-clear]')) { state.todoDraftLink = null; renderTodos(); els.todoInput.focus(); }
});
els.todoSwitch.addEventListener('click', (e) => {
  const b = e.target.closest('[data-todo-view]');
  if (!b || b.dataset.todoView === state.todoView) return;
  if (state.todoEditing) finishTodoEdit(false);
  state.todoView = b.dataset.todoView;
  renderTodos();
});
els.todoScroll.addEventListener('click', (e) => {
  if (e.target.closest('[data-todo-done-toggle]')) {
    state.todoDoneCollapsed = !state.todoDoneCollapsed;
    store.set('jobSprintTodoDone', state.todoDoneCollapsed ? 'collapsed' : 'open');
    renderTodos();
    return;
  }
  const li = e.target.closest('.todo[data-todo-id]');
  if (!li) return;
  const id = li.dataset.todoId;
  const t = state.todos.find((x) => x.id === id);
  if (!t) return;
  if (e.target.closest('[data-todo-check]')) { toggleTodo(id); return; }
  if (e.target.closest('[data-todo-menu]')) {
    const btn = e.target.closest('[data-todo-menu]');
    if (els.rowMenu.dataset.id === id && !els.rowMenu.classList.contains('hidden')) closeRowMenu(); else openTodoMenu(t, btn);
    return;
  }
  if (e.target.closest('[data-todo-link]')) {
    const kind = t.link_kind === 'company' ? 'company' : 'job';
    if (!linkTarget(t)) return;
    closeTodos();
    openNotes(t.link_id, kind);
    return;
  }
  if (e.target.closest('a')) return; // links inside the text open normally
  if (e.target.closest('[data-todo-text]')) startTodoEdit(id);
});
els.todoScroll.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('.todo[data-todo-id]');
  if (!li || e.target.closest('a, textarea')) return;
  const t = state.todos.find((x) => x.id === li.dataset.todoId);
  if (!t) return;
  e.preventDefault();
  openTodoMenu(t, null, { x: e.clientX, y: e.clientY });
});
els.todoOpenList.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('[data-todo-grip]');
  if (grip && e.button === 0 && !state.todoEditing) startTodoDrag(e, grip);
});
els.todoOpenList.addEventListener('pointermove', moveTodoDrag);
els.todoOpenList.addEventListener('pointerup', endTodoDrag);
els.todoOpenList.addEventListener('pointercancel', endTodoDrag);
els.todoOpenList.addEventListener('lostpointercapture', endTodoDrag);
// Keyboard reorder: focus the grip, then use the arrow keys.
els.todoOpenList.addEventListener('keydown', (e) => {
  const grip = e.target.closest('[data-todo-grip]');
  if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const id = grip.closest('.todo').dataset.todoId;
  const t = state.todos.find((x) => x.id === id);
  const open = todoLists(t.owner).open;
  const i = open.findIndex((x) => x.id === id);
  const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
  if (to < 0 || to >= open.length) return;
  moveTodo(id, to);
  els.todoOpenList.querySelector(`.todo[data-todo-id="${CSS.escape(id)}"] [data-todo-grip]`)?.focus();
});
els.rowMenu.addEventListener('change', (e) => {
  const input = e.target.closest('[data-todo-date]');
  if (!input || els.rowMenu.dataset.kind !== 'todo') return;
  const t = state.todos.find((x) => x.id === els.rowMenu.dataset.id);
  closeRowMenu();
  if (t && input.value) setTodoDue(t, input.value);
});

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea');
  if (e.key === '/' && !typing && els.blockModal.classList.contains('hidden') && els.companyModal.classList.contains('hidden') && !state.notesJobId && !state.todoOpen) {
    e.preventDefault();
    els.jobUrl.focus();
  } else if (e.key === 'Escape') {
    if (!els.rowMenu.classList.contains('hidden')) closeRowMenu();
    else if (state.todoEditing) { /* the edit box handles its own Escape */ }
    else if (state.todoOpen) closeTodos();
    else if (!els.companyModal.classList.contains('hidden')) closeCompanyModal();
    else if (state.notesJobId) closeNotes();
    else if (!els.blockModal.classList.contains('hidden')) closeBlockModal();
    else if (!els.userModal.classList.contains('hidden') && state.user) els.userModal.classList.add('hidden');
    else if (!els.addPanel.classList.contains('hidden')) closePanel();
  }
});

/* ---------- Stay in sync without frequent database reads ---------- */
document.addEventListener('visibilitychange', refreshIfDue);
window.addEventListener('focus', refreshIfDue);

/* ---------- Light / dark ---------- */
// Follow the device setting until someone chooses a theme in this browser.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function currentTheme() {
  const saved = document.documentElement.getAttribute('data-theme');
  return saved === 'light' || saved === 'dark' ? saved : (darkQuery.matches ? 'dark' : 'light');
}
function syncTheme() {
  const dark = currentTheme() === 'dark';
  const label = `Switch to ${dark ? 'light' : 'dark'} mode`;
  els.themeToggle.setAttribute('aria-label', label);
  els.themeToggle.setAttribute('title', label);
  els.themeToggle.setAttribute('aria-pressed', String(dark));
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', bg));
}
els.themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  store.set('jobSprintTheme', next);
  syncTheme();
});
if (darkQuery.addEventListener) darkQuery.addEventListener('change', syncTheme);
syncTheme();

/* ---------- Boot ---------- */
if (state.user) setUser(state.user); else chooseUser();
refreshAll();

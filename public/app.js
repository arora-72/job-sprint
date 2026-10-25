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
  notesJobId: null,     // job whose notes drawer is open
  pendingBlockId: null,
  preview: null,        // { url, token }
  lastSync: null,
  lastAttempt: 0,
  refreshError: false,
  refreshPromise: null,
  needsActionRefresh: false,
  loadedOnce: false,
  inflight: new Map(),  // job id -> promise chain, keeps updates for one job in order
};
let refreshTimer = null;

const els = {};
[
  'linkedinCopy', 'linkedinLabel', 'linkedinEdit', 'linkedinForm', 'linkedinInput', 'linkedinWho', 'linkedinErr', 'linkedinCancel',
  'userModal', 'switchUser', 'activeUser', 'activeUserAvatar', 'themeToggle', 'addForm', 'jobUrl', 'parseBtn',
  'addPanel', 'addPanelUrl', 'parseConfidence', 'parseStatus', 'dupWarning', 'previewForm',
  'titleInput', 'companyInput', 'locationInput', 'cancelPreview', 'saveJob',
  'statOpenValue', 'statOpenSub', 'statAppliedValue', 'statAppliedSub', 'statTodayValue', 'statTodaySub',
  'statBacklog', 'statBacklogValue', 'statBacklogSub', 'statNetworking', 'statNetworkingValue', 'statNetworkingSub',
  'openCount', 'networkingCount', 'discoverCount', 'historyCount',
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

async function loadDiscover({ silent = false } = {}) {
  if (state.discoverLoading || state.discoverBusy.size) return false;
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
    const [jobsOk, discoverOk] = await Promise.all([loadJobs({ silent }), loadDiscover({ silent })]);
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

function buckets() {
  const t0 = startOfToday();
  const byStage = { open: [], networking: [], history: [] };
  state.jobs.forEach((j) => byStage[stageOf(j)].push(j));
  const open = byStage.open;
  const backlog = open.filter((j) => new Date(j.added_at) < t0).sort((a, b) => new Date(a.added_at) - new Date(b.added_at));
  const today = open.filter((j) => new Date(j.added_at) >= t0).sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
  // Least recently touched first, so neglected jobs rise to the top.
  const networking = byStage.networking.sort((a, b) => new Date(lastTouch(a)) - new Date(lastTouch(b)));
  const history = byStage.history.sort((a, b) => new Date(closedAt(b)) - new Date(closedAt(a)));
  const appliedToday = state.jobs.filter((j) => j.status === 'applied' && new Date(j.applied_at) >= t0);
  const addedToday = state.jobs.filter((j) => new Date(j.added_at) >= t0);
  return { open, backlog, today, networking, history, appliedToday, addedToday };
}

/* ---------- Rendering ---------- */
function ageBadge(job) {
  const age = daysOld(job.added_at);
  if (age <= 0) return '<span class="age new" title="Added today">New</span>';
  return `<span class="age ${age >= 5 ? 'old' : ''}" title="Added ${age} day${age === 1 ? '' : 's'} ago">${age}d</span>`;
}

const NOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

function subLine(job) {
  return [job.company || 'Unknown company', job.location].filter(Boolean).map(displayHtml).join('<span class="dot">·</span>');
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
        ${ageBadge(job)}
        <div class="job-text">
          ${titleLink(job)}
          <div class="job-sub">${subLine(job)}</div>
          ${notePreview(job)}
        </div>
      </div>
      <div class="job-meta">
        <span class="mini-avatar ${userClass(job.added_by)}">${escapeHtml((job.added_by || '?')[0])}</span>
        <span>Added ${relDate(job.added_at)}</span>
      </div>
      <div class="actions">
        ${notesButton(job)}
        ${openLink(job)}
        <button class="btn secondary small" data-action="block">Block</button>
        <button class="btn primary small" data-action="apply">Applied ✓</button>
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
        ${touchBadge(job)}
        <div class="job-text">
          ${titleLink(job)}
          <div class="job-sub">${subLine(job)}</div>
          ${notePreview(job)}
        </div>
      </div>
      <div class="job-meta stack">
        ${networkSelect(job)}
        <span class="meta-small"><span class="mini-avatar ${userClass(job.applied_by)}">${escapeHtml((job.applied_by || '?')[0])}</span>Applied ${relDate(job.applied_at)}</span>
      </div>
      <div class="actions">
        ${notesButton(job)}
        ${openLink(job)}
        <button class="btn ${ready ? 'primary' : 'secondary'} small" data-action="done" title="Move to History">Done → History</button>
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
        <div class="job-text">
          ${titleLink(job)}
          <div class="job-sub">${subLine(job)}</div>
          ${notePreview(job)}
        </div>
      </div>
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
  const sub = [role.company, role.location].filter(Boolean).map(displayHtml).join('<span class="dot">·</span>');
  const busy = state.discoverBusy.has(role.id) ? ' disabled' : '';
  return `
    <article class="discover-row" data-id="${escapeHtml(role.id)}">
      <div class="discover-heading">
        <div class="discover-title-block">
          <a class="job-title" href="${url}" target="_blank" rel="noopener">${displayHtml(role.title)}</a>
          <div class="job-sub">${sub}</div>
          ${role.why_fit ? `<p class="discover-why">${displayHtml(role.why_fit)}</p>` : ''}
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

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

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

function renderDiscover() {
  const html = state.discoverLoaded ? state.discover.map(discoverRow).join('') : '<div class="state-card">Loading matches…</div>';
  if (html) return { html };
  return {
    empty: state.discoverError
      ? ['!', 'Couldn’t load Discover', 'Refresh to try again.', false]
      : ['✦', 'No S or A matches to review', 'New matches from Garima’s role watches will appear here.', true],
  };
}

function render() {
  const b = buckets();
  renderTiles(b);

  const view = state.tab === 'open' ? (state.filter || 'open')
    : state.tab === 'networking' ? (state.filter === 'applied-today' ? 'applied-today' : 'networking')
      : state.tab;
  document.querySelectorAll('.stat').forEach((s) => s.classList.toggle('active', s.dataset.view === view));

  // Tabs + filter chip
  els.openCount.textContent = b.open.length;
  els.networkingCount.textContent = b.networking.length;
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
  const renderers = { open: renderOpen, networking: renderNetworking, history: renderHistory, discover: renderDiscover };
  const { html = '', empty = null } = renderers[state.tab](b);
  els.jobList.innerHTML = html;
  const showEmpty = !!empty && (state.tab === 'discover' ? state.discoverLoaded : state.loadedOnce);
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
  if (tab === 'discover' && !state.discoverLoaded && !state.refreshPromise) refreshAll({ silent: true });
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
      setView('open');
      showToast(`Added: ${jobLabel(result.job)}`);
    } else {
      await api('discover', { method: 'PATCH', body: JSON.stringify({ id, actor: state.user }) });
      state.discover = state.discover.filter((item) => item.id !== id);
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

// Apply a change locally right away, then save it. Saves for one job run in order; a failure rolls back.
function mutate(id, local, body) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return Promise.resolve(null);
  const before = { ...job, notes: [...notesOf(job)] };
  if (local) Object.assign(job, typeof local === 'function' ? local(job) : local);
  render();

  const prev = state.inflight.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => api('jobs', {
    method: 'PATCH',
    body: JSON.stringify({ id, actor: state.user, ...body }),
  }));
  state.inflight.set(id, next);
  let saved = false;
  next.then((res) => {
    saved = true;
    if (state.inflight.get(id) === next && res && res.job) Object.assign(job, res.job);
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
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.job-row')?.dataset.id;
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  const action = btn.dataset.action;
  if (action === 'notes') { openNotes(id); return; }
  if (!state.user) return chooseUser();
  if (action === 'apply') {
    setStatus(id, 'applied');
    const today = buckets().appliedToday.length;
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
  const job = state.jobs.find((j) => j.id === state.notesJobId);
  if (!job) { closeNotes(); return; }
  els.notesTitle.textContent = readableText(job.title || 'Untitled role');
  const stageLabel = { open: 'To apply', networking: `Networking · ${NETWORK[netStatus(job)].label}`, history: 'History' }[stageOf(job)];
  els.notesSub.textContent = [readableText(job.company || ''), stageLabel].filter(Boolean).join(' · ');
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

function openNotes(id) {
  state.notesJobId = id;
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
  mutate(id, (job) => ({ notes: [...notesOf(job), temp] }), { action: 'add-note', text });
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
  mutate(id, (job) => ({ notes: notesOf(job).filter((n) => n.id !== noteId) }), { action: 'delete-note', note_id: noteId });
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
  if (!els.userModal.classList.contains('hidden') || !els.blockModal.classList.contains('hidden') || state.notesJobId) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (isHttpUrl(text)) { e.preventDefault(); startAdd(text); }
});

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea');
  if (e.key === '/' && !typing && els.blockModal.classList.contains('hidden') && !state.notesJobId) {
    e.preventDefault();
    els.jobUrl.focus();
  } else if (e.key === 'Escape') {
    if (state.notesJobId) closeNotes();
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

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
  tab: 'open',          // 'open' | 'discover' | 'history'
  filter: null,         // null | 'today' | 'backlog' | 'applied-today'
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
  'userModal', 'switchUser', 'activeUser', 'activeUserAvatar', 'themeToggle', 'addForm', 'jobUrl', 'parseBtn',
  'addPanel', 'addPanelUrl', 'parseConfidence', 'parseStatus', 'dupWarning', 'previewForm',
  'titleInput', 'companyInput', 'locationInput', 'cancelPreview', 'saveJob',
  'statOpenValue', 'statOpenSub', 'statAppliedValue', 'statAppliedSub', 'statTodayValue', 'statTodaySub',
  'statBacklog', 'statBacklogValue', 'statBacklogSub', 'openCount', 'discoverCount', 'historyCount',
  'filterChip', 'filterChipText', 'syncText', 'refreshBtn', 'loadingState', 'emptyState', 'emptyIcon',
  'emptyTitle', 'emptyText', 'jobList', 'toast', 'toastText', 'toastUndo',
  'blockModal', 'blockJobName', 'blockReason', 'closeBlockModal', 'cancelBlock', 'confirmBlock', 'reasonChips',
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
  if (!els.addPanel.classList.contains('hidden')) els.titleInput.focus();
}
function chooseUser() { els.userModal.classList.remove('hidden'); }
document.querySelectorAll('.user-choice').forEach((btn) => btn.addEventListener('click', () => setUser(btn.dataset.user)));
els.switchUser.addEventListener('click', chooseUser);

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

/* ---------- Derived numbers ---------- */
const doneAt = (j) => j.applied_at || j.blocked_at || j.updated_at;
function buckets() {
  const t0 = startOfToday();
  const open = state.jobs.filter((j) => j.status === 'pipeline');
  const backlog = open.filter((j) => new Date(j.added_at) < t0).sort((a, b) => new Date(a.added_at) - new Date(b.added_at));
  const today = open.filter((j) => new Date(j.added_at) >= t0).sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
  const history = state.jobs.filter((j) => j.status !== 'pipeline').sort((a, b) => new Date(doneAt(b)) - new Date(doneAt(a)));
  const appliedToday = history.filter((j) => j.status === 'applied' && new Date(j.applied_at) >= t0);
  const addedToday = state.jobs.filter((j) => new Date(j.added_at) >= t0);
  return { open, backlog, today, history, appliedToday, addedToday };
}

/* ---------- Rendering ---------- */
function ageBadge(job) {
  const age = daysOld(job.added_at);
  if (age <= 0) return '<span class="age new" title="Added today">New</span>';
  return `<span class="age ${age >= 5 ? 'old' : ''}" title="Added ${age} day${age === 1 ? '' : 's'} ago">${age}d</span>`;
}

function openRow(job) {
  const url = escapeHtml(safeJobUrl(job.url));
  const sub = [job.company || 'Unknown company', job.location].filter(Boolean).map(displayHtml).join('<span class="dot">·</span>');
  return `
    <article class="job-row" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        ${ageBadge(job)}
        <div class="job-text">
          <a class="job-title" href="${url}" target="_blank" rel="noopener">${displayHtml(job.title || 'Untitled role')}</a>
          <div class="job-sub">${sub}</div>
        </div>
      </div>
      <div class="job-meta">
        <span class="mini-avatar ${userClass(job.added_by)}">${escapeHtml((job.added_by || '?')[0])}</span>
        <span>Added ${relDate(job.added_at)}</span>
      </div>
      <div class="actions">
        <a class="btn ghost small" href="${url}" target="_blank" rel="noopener">Open ↗</a>
        <button class="btn secondary small" data-action="block">Block</button>
        <button class="btn primary small" data-action="apply">Applied ✓</button>
      </div>
    </article>`;
}

function historyRow(job) {
  const url = escapeHtml(safeJobUrl(job.url));
  const applied = job.status === 'applied';
  const who = applied ? job.applied_by : job.blocked_by;
  const when = applied ? job.applied_at : job.blocked_at;
  const sub = [job.company || 'Unknown company', job.location].filter(Boolean).map(displayHtml).join('<span class="dot">·</span>');
  return `
    <article class="job-row history" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        <div class="job-text">
          <a class="job-title" href="${url}" target="_blank" rel="noopener">${displayHtml(job.title || 'Untitled role')}</a>
          <div class="job-sub">${sub}</div>
        </div>
      </div>
      <div class="job-meta stack">
        <div class="meta-line">
          <span class="status-chip ${applied ? 'applied' : 'blocked'}">${applied ? 'Applied' : 'Blocked'}</span>
          <span>${escapeHtml(who || 'Unknown')} · ${relDate(when)}</span>
        </div>
        ${!applied && job.blocked_reason ? `<div class="reason">${displayHtml(job.blocked_reason)}</div>` : ''}
      </div>
      <div class="actions">
        <a class="btn ghost small" href="${url}" target="_blank" rel="noopener">Open ↗</a>
        <button class="btn secondary small" data-action="restore">Move back</button>
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

function render() {
  const b = buckets();

  // Stat tiles
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

  const view = state.tab === 'history' ? (state.filter === 'applied-today' ? 'applied-today' : 'history') : state.tab === 'discover' ? 'discover' : (state.filter || 'open');
  document.querySelectorAll('.stat').forEach((s) => s.classList.toggle('active', s.dataset.view === view));

  // Tabs + filter chip
  els.openCount.textContent = b.open.length;
  els.discoverCount.textContent = state.discover.length;
  els.historyCount.textContent = b.history.length;
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
  let html = '';
  let empty = null;
  if (state.tab === 'open') {
    const showBacklog = state.filter !== 'today' && b.backlog.length;
    const showToday = state.filter !== 'backlog' && b.today.length;
    if (showBacklog) html += group('Backlog', `${b.backlog.length} from earlier days · oldest first`, 'backlog', b.backlog.map(openRow).join(''));
    if (showToday) html += group('Added today', `${b.today.length} open · newest first`, '', b.today.map(openRow).join(''));
    if (!html) {
      if (state.filter === 'backlog') empty = ['✓', 'Backlog cleared', 'Nothing left over from earlier days.', true];
      else if (state.filter === 'today') empty = ['✓', 'Nothing left from today', 'Paste a job link at the top to add one.', true];
      else empty = ['↗', 'Pipeline is empty', 'Paste a job link at the top, or anywhere on this page.', false];
    }
  } else if (state.tab === 'discover') {
    html = state.discoverLoaded ? state.discover.map(discoverRow).join('') : '<div class="state-card">Loading matches…</div>';
    if (!html) empty = state.discoverError
      ? ['!', 'Couldn’t load Discover', 'Refresh to try again.', false]
      : ['✦', 'No S or A matches to review', 'New matches from Garima’s role watches will appear here.', true];
  } else {
    const list = state.filter === 'applied-today' ? b.appliedToday : b.history;
    html = list.map(historyRow).join('');
    if (!html) empty = state.filter === 'applied-today'
      ? ['0', 'No applications yet today', 'Hit “Applied ✓” on a job and it shows up here.', false]
      : ['↗', 'No history yet', 'Applied and blocked jobs land here.', false];
  }

  els.jobList.innerHTML = html;
  const showEmpty = !!empty && (state.tab === 'discover' ? state.discoverLoaded : state.loadedOnce);
  els.emptyState.classList.toggle('hidden', !showEmpty);
  if (empty) {
    els.emptyIcon.textContent = empty[0];
    els.emptyIcon.classList.toggle('good', empty[3]);
    els.emptyTitle.textContent = empty[1];
    els.emptyText.textContent = empty[2];
  }
}

function setView(tab, filter = null) {
  state.tab = tab;
  state.filter = filter;
  render();
  if (tab === 'discover' && !state.discoverLoaded && !state.refreshPromise) refreshAll({ silent: true });
}
document.querySelectorAll('.stat').forEach((s) => s.addEventListener('click', () => {
  const v = s.dataset.view;
  if (v === 'open') setView('open');
  else if (v === 'applied-today') setView('history', 'applied-today');
  else setView('open', v);
}));
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.tab)));
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

/* ---------- Status changes (optimistic, with undo) ---------- */
function localPatch(status, reason) {
  const now = new Date().toISOString();
  if (status === 'applied') return { status, applied_by: state.user, applied_at: now, updated_at: now };
  if (status === 'blocked') return { status, blocked_by: state.user, blocked_at: now, blocked_reason: reason, updated_at: now };
  return { status, applied_by: null, applied_at: null, blocked_by: null, blocked_at: null, blocked_reason: '', updated_at: now };
}

function setStatus(id, status, reason = '') {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  const before = { ...job };
  Object.assign(job, localPatch(status, reason));
  render();

  const prev = state.inflight.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => api('jobs', {
    method: 'PATCH',
    body: JSON.stringify({ id, status, actor: state.user, blocked_reason: reason }),
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
}

function jobLabel(job) { return `${readableText(job.title || 'Role')}${job.company ? ` at ${readableText(job.company)}` : ''}`; }

els.jobList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.job-row').dataset.id;
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  if (!state.user) return chooseUser();
  const action = btn.dataset.action;
  if (action === 'apply') {
    setStatus(id, 'applied');
    showToast(`Applied: ${jobLabel(job)}`, { undo: () => setStatus(id, 'pipeline') });
  } else if (action === 'block') {
    openBlockModal(job);
  } else if (action === 'restore') {
    const prevStatus = job.status;
    const prevReason = job.blocked_reason || '';
    setStatus(id, 'pipeline');
    showToast(`Moved back: ${jobLabel(job)}`, { undo: () => setStatus(id, prevStatus, prevReason) });
  }
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
    const where = dup.status === 'pipeline' ? 'already in the pipeline' : `already ${dup.status}`;
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
  if (!els.userModal.classList.contains('hidden') || !els.blockModal.classList.contains('hidden')) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (isHttpUrl(text)) { e.preventDefault(); startAdd(text); }
});

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea');
  if (e.key === '/' && !typing && els.blockModal.classList.contains('hidden')) {
    e.preventDefault();
    els.jobUrl.focus();
  } else if (e.key === 'Escape') {
    if (!els.blockModal.classList.contains('hidden')) closeBlockModal();
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

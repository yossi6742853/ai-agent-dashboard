// ============================================================================
// AI Email Agent — GitHub Pages dashboard
// Fetches data from the Apps Script webhook and renders it.
// ============================================================================

const WEBHOOK_BASE = 'https://script.google.com/macros/s/AKfycbzhRqTLE4fjjDqrH1we-JlGZ15R-ws8b_gfWF1xF1ewailaiyiS_YXqUhRtb3cQghVt/exec';
const REFRESH_MS = 30000;
const TOKEN_KEY = 'aiAgentToken';

let weekChart = null;
let actionsChart = null;
let refreshTimer = null;

// ----- token handling --------------------------------------------------------
function getToken() {
  // Priority: URL param → localStorage
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    try { localStorage.setItem(TOKEN_KEY, fromUrl); } catch (_) {}
    return fromUrl;
  }
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}

function setupTokenPrompt() {
  const promptEl = document.getElementById('token-prompt');
  const dashEl = document.getElementById('dashboard');
  promptEl.style.display = 'block';
  dashEl.style.display = 'none';
  document.getElementById('token-save').onclick = () => {
    const v = document.getElementById('token-input').value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); } catch (_) {}
    location.reload();
  };
  document.getElementById('token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('token-save').click();
  });
}

// ----- API helper ------------------------------------------------------------
async function callWebhook(action, extra) {
  const token = getToken();
  if (!token) throw new Error('missing-token');
  const params = new URLSearchParams({ action, token });
  if (extra) Object.keys(extra).forEach(k => params.set(k, extra[k]));
  const url = WEBHOOK_BASE + '?' + params.toString();
  const r = await fetch(url, { method: 'GET', mode: 'cors' });
  if (!r.ok) throw new Error('http-' + r.status);
  return r.json();
}

// ----- helpers ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function setStatus(state) {
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot status-' + state;
  dot.title = state === 'ok' ? 'מחובר' : (state === 'err' ? 'שגיאה' : 'טוען');
}

function showToast(msg, type) {
  const cls = type === 'err' ? 'bg-danger' : (type === 'warn' ? 'bg-warning text-dark' : 'bg-success');
  const id = 't' + Date.now();
  const html = `<div id="${id}" class="toast align-items-center text-white ${cls} border-0" role="alert">
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(msg)}</div>
      <button type="button" class="btn-close btn-close-white ms-2 me-auto" data-bs-dismiss="toast"></button>
    </div>
  </div>`;
  const c = document.getElementById('toast-container');
  c.insertAdjacentHTML('beforeend', html);
  const el = document.getElementById(id);
  const t = new bootstrap.Toast(el, { delay: 3500 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

function formatLocal(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('he-IL', { hour12: false });
  } catch (_) { return iso; }
}

// ----- rendering -------------------------------------------------------------
function renderTodayStats(today) {
  document.getElementById('stat-today').textContent = today.processed || 0;
  document.getElementById('stat-today-sub').textContent =
    `התקבלו ${today.received || 0} · השב ${today.replied || 0} · טיוטה ${today.drafted || 0} · נדחה ${today.deferred || 0}`;
}

function renderWeekStats(week) {
  const sum = (week || []).reduce((a, b) => a + (b || 0), 0);
  document.getElementById('stat-week').textContent = sum;
}

function renderDrafts(count) {
  document.getElementById('stat-drafts').textContent = count || 0;
}

function renderQuota(q) {
  if (!q) return;
  document.getElementById('stat-quota').textContent =
    q.mail_remaining < 0 ? '—' : q.mail_remaining;
  if (q.breaker_active) {
    document.getElementById('stat-quota-sub').textContent = 'מפסק מופעל!';
    document.getElementById('stat-quota-sub').className = 'stat-sub text-danger fw-bold';
  } else {
    document.getElementById('stat-quota-sub').textContent = 'הודעות נותרו היום';
    document.getElementById('stat-quota-sub').className = 'stat-sub';
  }
}

function renderWeekChart(weekDetail) {
  const ctx = document.getElementById('weekChart').getContext('2d');
  const labels = (weekDetail || []).map(d => `${d.weekday} ${d.label}`);
  const dProcessed = (weekDetail || []).map(d => d.count || 0);
  const dReplied = (weekDetail || []).map(d => d.replied || 0);
  const dDrafted = (weekDetail || []).map(d => d.drafted || 0);
  const dDeferred = (weekDetail || []).map(d => d.deferred || 0);
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'טופל', data: dProcessed, backgroundColor: '#3b82f6', borderRadius: 6 },
        { label: 'נשלח', data: dReplied, backgroundColor: '#22c55e', borderRadius: 6 },
        { label: 'טיוטה', data: dDrafted, backgroundColor: '#f59e0b', borderRadius: 6 },
        { label: 'נדחה', data: dDeferred, backgroundColor: '#94a3b8', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Heebo' } } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { font: { family: 'Heebo' } } },
      },
    },
  };
  if (weekChart) { weekChart.data = cfg.data; weekChart.update(); }
  else weekChart = new Chart(ctx, cfg);
}

function renderActionsChart(actions) {
  const ctx = document.getElementById('actionsChart').getContext('2d');
  const labels = ['מענה מהותי', 'טיוטה והתראה', 'דחיה לתקציר', 'אישור בלבד', 'הסלמה', 'דילוג', 'אחר'];
  const data = [
    actions.substantive_reply || 0,
    actions.draft_and_notify || 0,
    actions.defer_to_digest || 0,
    actions.acknowledge || 0,
    actions.escalate || 0,
    actions.skip || 0,
    actions.other || 0,
  ];
  const cfg = {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#22c55e', '#f59e0b', '#94a3b8', '#3b82f6', '#ef4444', '#a3a3a3', '#cbd5e1'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Heebo' }, boxWidth: 12 } },
      },
    },
  };
  if (actionsChart) { actionsChart.data = cfg.data; actionsChart.update(); }
  else actionsChart = new Chart(ctx, cfg);
}

function renderTopSenders(items) {
  const tbody = document.getElementById('top-senders');
  if (!items || !items.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-3">אין נתונים</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(s => `
    <tr>
      <td>${escapeHtml(s.name || '—')}</td>
      <td class="text-muted small">${escapeHtml(s.email)}</td>
      <td class="text-end fw-bold">${s.count}</td>
    </tr>
  `).join('');
}

function renderEscalations(items) {
  const tbody = document.getElementById('escalations');
  if (!items || !items.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">אין הסלמות פתוחות</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(e => {
    const cls = e.status === 'closed' ? 'badge-status-closed' : 'badge-status-open';
    const ageTxt = e.age_hours == null ? '—' : (e.age_hours + ' ש\'');
    return `<tr>
      <td>${escapeHtml(e.sender)}</td>
      <td class="text-muted small">${escapeHtml(e.domain)}</td>
      <td><span class="badge ${cls}">${escapeHtml(e.status || 'open')}</span></td>
      <td class="text-end">${ageTxt}</td>
    </tr>`;
  }).join('');
}

function renderDraftsList(items) {
  const tbody = document.getElementById('drafts-pending');
  if (!items || !items.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">אין טיוטות ממתינות</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(d => `
    <tr data-draft-id="${escapeHtml(d.id)}">
      <td class="small"><div class="fw-bold">${escapeHtml(d.to)}</div><div class="text-muted">${escapeHtml(d.to_email || '')}</div></td>
      <td class="small">${escapeHtml(d.subject || '(ללא נושא)')}</td>
      <td><div class="snippet">${escapeHtml(d.snippet || '')}</div></td>
      <td class="text-end">
        <button class="btn btn-sm btn-success draft-approve" data-id="${escapeHtml(d.id)}"><i class="bi bi-check2"></i> אשר</button>
        <button class="btn btn-sm btn-outline-danger draft-delete" data-id="${escapeHtml(d.id)}"><i class="bi bi-trash"></i> מחק</button>
      </td>
    </tr>
  `).join('');
  document.querySelectorAll('.draft-approve').forEach(b => b.addEventListener('click', onApproveDraft));
  document.querySelectorAll('.draft-delete').forEach(b => b.addEventListener('click', onDeleteDraft));
}

function renderTriggers(items) {
  const tbody = document.getElementById('triggers');
  if (!items || !items.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-3">אין טריגרים</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(t => `
    <tr>
      <td><code>${escapeHtml(t.name)}</code></td>
      <td class="text-muted small">${escapeHtml((t.source || '').replace('TriggerSource.', ''))}</td>
      <td class="small">${escapeHtml(formatLocal(t.last_run) || '—')}</td>
    </tr>
  `).join('');
}

function renderHeader(d) {
  document.getElementById('agent-name').textContent = d.user_email ? ('סוכן ' + d.user_email) : '';
  document.getElementById('user-email').textContent = d.user_email || '';
  const yemot = d.yemot || {};
  document.getElementById('yemot-info').textContent =
    `${yemot.processed_total || 0} שיחות · אחרונה: ${yemot.last_call || '—'}`;
  document.getElementById('last-refresh').textContent = formatLocal(d.generated_at);
}

// ----- main loop -------------------------------------------------------------
async function refresh() {
  setStatus('loading');
  try {
    const d = await callWebhook('statsJson');
    if (!d || !d.ok) throw new Error('bad-response');
    renderHeader(d);
    renderTodayStats(d.today || {});
    renderWeekStats(d.week || []);
    renderDrafts(d.drafts_count || 0);
    renderQuota(d.quota || {});
    renderWeekChart(d.week_detail || []);
    renderActionsChart(d.actions || {});
    renderTopSenders(d.top_senders || []);
    renderEscalations(d.escalations || []);
    renderDraftsList(d.drafts_pending || []);
    renderTriggers(d.triggers || []);
    setStatus('ok');
  } catch (err) {
    setStatus('err');
    if (String(err.message) === 'missing-token') {
      setupTokenPrompt();
    } else {
      showToast('שגיאה בטעינה: ' + err.message, 'err');
    }
  }
}

// ----- action buttons --------------------------------------------------------
async function onActionClick(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm ms-1"></span>טוען';
  try {
    const r = await callWebhook(action);
    showToast('הופעל: ' + action + (r.ok === false ? ' (שגיאה)' : ''), r.ok === false ? 'err' : 'ok');
    document.getElementById('action-result').textContent =
      JSON.stringify(r, null, 2).substring(0, 500);
    refresh();
  } catch (err) {
    showToast('שגיאה: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function onApproveDraft(e) {
  const id = e.currentTarget.dataset.id;
  if (!confirm('לאשר ולשלוח את הטיוטה?')) return;
  e.currentTarget.disabled = true;
  try {
    const r = await callWebhook('approveDraft', { id });
    if (r.ok === false) throw new Error(r.error || 'failed');
    showToast('הטיוטה אושרה ונשלחה', 'ok');
    refresh();
  } catch (err) {
    showToast('שגיאה באישור: ' + err.message, 'err');
  }
}

async function onDeleteDraft(e) {
  const id = e.currentTarget.dataset.id;
  if (!confirm('למחוק את הטיוטה?')) return;
  e.currentTarget.disabled = true;
  try {
    const r = await callWebhook('deleteDraft', { id });
    if (r.ok === false) throw new Error(r.error || 'failed');
    showToast('הטיוטה נמחקה', 'ok');
    refresh();
  } catch (err) {
    showToast('שגיאה במחיקה: ' + err.message, 'err');
  }
}

async function onApproveAll() {
  if (!confirm('לאשר את כל הטיוטות הממתינות?')) return;
  const btn = document.getElementById('btn-approve-all');
  btn.disabled = true;
  try {
    const r = await callWebhook('approveAllDrafts');
    if (r.ok === false) throw new Error(r.error || 'failed');
    showToast('כל הטיוטות אושרו', 'ok');
    refresh();
  } catch (err) {
    showToast('שגיאה: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

// ----- init ------------------------------------------------------------------
function init() {
  const token = getToken();
  if (!token) {
    setupTokenPrompt();
    return;
  }
  document.getElementById('dashboard').style.display = 'block';
  document.querySelectorAll('.action-btn').forEach(b => b.addEventListener('click', onActionClick));
  document.getElementById('btn-reload').addEventListener('click', refresh);
  document.getElementById('btn-approve-all').addEventListener('click', onApproveAll);
  document.getElementById('btn-clear-token').addEventListener('click', () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    location.reload();
  });
  refresh();
  refreshTimer = setInterval(refresh, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);

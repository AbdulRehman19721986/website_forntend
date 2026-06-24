/* Redox · Admin Dashboard logic */

function el(id) { return document.getElementById(id); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(ts) { return new Date(ts * 1000).toLocaleString(); }

async function api(path, opts = {}) {
  const r = await fetch(`/api/admin${path}`, {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  if (r.status === 401) { window.location.href = 'login.html'; throw new Error('Not authenticated'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ── Tabs ──
qsa('.admin-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    qsa('.admin-tabs button').forEach(b => b.classList.remove('is-active'));
    qsa('.admin-panel').forEach(p => p.classList.remove('is-active'));
    btn.classList.add('is-active');
    el(`adm-${btn.dataset.panel}`).classList.add('is-active');
    if (btn.dataset.panel === 'usage') loadUsage();
    if (btn.dataset.panel === 'integrations') loadIntegrations();
  });
});

el('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
  window.location.href = 'login.html';
});

// ── Boot: who am I + stats + inbox + users ──
async function boot() {
  try {
    const me = await api('/me');
    if (!me.authenticated) { window.location.href = 'login.html'; return; }
    el('adminName').textContent = me.admin.username + (me.admin.via === 'secret_key' ? ' (secret key)' : '');
  } catch (e) { return; }

  loadStats();
  loadInbox();
  loadUsers();
}

async function loadStats() {
  try {
    const s = await api('/stats');
    el('statTotal').textContent = s.total_users;
    el('statActive').textContent = s.active_users;
    el('statPending').textContent = s.pending_users;
    el('statRenders').textContent = s.total_renders;
  } catch (e) { console.error(e); }
}

// ── Inbox ──
async function loadInbox() {
  const body = el('inboxBody');
  body.innerHTML = '<tr class="empty-row"><td colspan="5">Loading…</td></tr>';
  try {
    const rows = await api('/pending');
    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">Inbox is empty — no pending requests.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(u => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.plan_label)}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td class="table-actions">
          <select data-plan-for="${u.id}">
            <option value="basic" ${u.plan === 'basic' ? 'selected' : ''}>Basic</option>
            <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro</option>
            <option value="elite" ${u.plan === 'elite' ? 'selected' : ''}>Elite</option>
          </select>
          <button class="btn btn-primary" data-approve="${u.id}">Approve</button>
          <button class="btn btn-danger-ghost" data-reject="${u.id}">Reject</button>
        </td>
      </tr>`).join('');

    qsa('[data-approve]', body).forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.approve;
      const sel = document.querySelector(`select[data-plan-for="${id}"]`);
      const plan = sel ? sel.value : null;
      await api(`/users/${id}/approve`, { method: 'POST', body: JSON.stringify({ plan }) });
      loadInbox(); loadUsers(); loadStats();
    }));
    qsa('[data-reject]', body).forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Reject this registration request?')) return;
      await api(`/users/${b.dataset.reject}/reject`, { method: 'POST' });
      loadInbox(); loadUsers(); loadStats();
    }));
  } catch (e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="5">${escapeHtml(e.message)}</td></tr>`;
  }
}

// ── All users ──
async function loadUsers() {
  const body = el('usersBody');
  body.innerHTML = '<tr class="empty-row"><td colspan="6">Loading…</td></tr>';
  const status = el('usersFilter').value;
  try {
    const rows = await api(`/users${status ? '?status=' + status : ''}`);
    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="6">No members in this view.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(u => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select data-plan-select="${u.id}">
            <option value="basic" ${u.plan === 'basic' ? 'selected' : ''}>Basic</option>
            <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro</option>
            <option value="elite" ${u.plan === 'elite' ? 'selected' : ''}>Elite</option>
          </select>
        </td>
        <td><span class="status-badge ${u.status}">${u.status}</span></td>
        <td>${fmtDate(u.created_at)}</td>
        <td class="table-actions">
          <button class="btn btn-ghost" data-disable="${u.id}">Disable</button>
          <button class="btn btn-danger-ghost" data-delete="${u.id}">Delete</button>
        </td>
      </tr>`).join('');

    qsa('[data-plan-select]', body).forEach(sel => sel.addEventListener('change', async () => {
      await api(`/users/${sel.dataset.planSelect}/plan`, { method: 'POST', body: JSON.stringify({ plan: sel.value }) });
      loadStats();
    }));
    qsa('[data-disable]', body).forEach(b => b.addEventListener('click', async () => {
      await api(`/users/${b.dataset.disable}/disable`, { method: 'POST' });
      loadUsers(); loadStats();
    }));
    qsa('[data-delete]', body).forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Permanently delete this member?')) return;
      await api(`/users/${b.dataset.delete}`, { method: 'DELETE' });
      loadUsers(); loadStats();
    }));
  } catch (e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${escapeHtml(e.message)}</td></tr>`;
  }
}
el('usersRefresh').addEventListener('click', loadUsers);
el('usersFilter').addEventListener('change', loadUsers);

// ── Direct create ──
el('createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = el('createMsg');
  msg.classList.add('hidden');
  try {
    const data = await api('/create-user', {
      method: 'POST',
      body: JSON.stringify({
        username: el('cu-username').value.trim(),
        email: el('cu-email').value.trim(),
        password: el('cu-password').value,
        plan: el('cu-plan').value,
      }),
    });
    msg.textContent = data.message;
    msg.style.color = 'var(--green)';
    msg.classList.remove('hidden');
    e.target.reset();
    loadUsers(); loadStats();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = '';
    msg.classList.remove('hidden');
  }
});

// ── Usage log ──
async function loadUsage() {
  const body = el('usageBody');
  body.innerHTML = '<tr class="empty-row"><td colspan="4">Loading…</td></tr>';
  try {
    const rows = await api('/renders');
    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="4">No renders yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr><td>${escapeHtml(r.username)}</td><td>${escapeHtml(r.filename)}</td><td>${escapeHtml(r.kind)}</td><td>${fmtDate(r.created_at)}</td></tr>
    `).join('');
  } catch (e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">${escapeHtml(e.message)}</td></tr>`;
  }
}

// ── Integrations ──
async function loadIntegrations() {
  const grid = el('integrationGrid');
  grid.innerHTML = '<p class="lib-empty">Loading…</p>';
  try {
    const data = await api('/integrations');
    grid.innerHTML = `
      <div class="integration-card">
        <div><div class="name">Anthropic API</div><div class="sub">Story Writer text generation</div></div>
        <span class="dot-status ${data.anthropic ? 'on' : 'off'}"></span>
      </div>
      <div class="integration-card">
        <div><div class="name">OpenAI API</div><div class="sub">Story Writer fallback</div></div>
        <span class="dot-status ${data.openai ? 'on' : 'off'}"></span>
      </div>
      <div class="integration-card">
        <div><div class="name">WhatsApp contact</div><div class="sub">+${escapeHtml(data.whatsapp_number)}</div></div>
        <span class="dot-status on"></span>
      </div>`;
  } catch (e) {
    grid.innerHTML = `<p class="lib-empty">${escapeHtml(e.message)}</p>`;
  }
}

boot();

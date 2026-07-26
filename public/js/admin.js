/**
 * admin.js - Admin dashboard logic.
 * Loads stats, users, groups, and activity logs; supports ban/unban and
 * deleting groups / conversation history.
 */
let adminMe = null;

async function bootstrapAdmin() {
  try {
    const res = await Api.get('/api/auth/me');
    adminMe = res.user;
    if (adminMe.role !== 'admin') {
      window.location.href = '/chat';
      return;
    }
  } catch (err) {
    window.location.href = '/';
    return;
  }

  await Promise.all([loadStats(), loadUsers(), loadGroups(), loadLogs()]);
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('panelUsers').classList.toggle('hidden', tab !== 'users');
  document.getElementById('panelGroups').classList.toggle('hidden', tab !== 'groups');
  document.getElementById('panelLogs').classList.toggle('hidden', tab !== 'logs');
}

async function loadStats() {
  const res = await Api.get('/api/admin/stats');
  const grid = document.getElementById('statGrid');
  grid.innerHTML = `
    <div class="stat-card glass"><div class="stat-value">${res.stats.totalUsers}</div><div class="stat-label">Total Users</div></div>
    <div class="stat-card glass"><div class="stat-value">${res.stats.totalGroups}</div><div class="stat-label">Total Groups</div></div>
    <div class="stat-card glass"><div class="stat-value">${res.stats.totalMessages}</div><div class="stat-label">Total Messages</div></div>
  `;
}

async function loadUsers() {
  const res = await Api.get('/api/admin/users?limit=200');
  const panel = document.getElementById('panelUsers');
  if (res.users.length === 0) {
    panel.innerHTML = `<div class="empty-state">No users found.</div>`;
    return;
  }
  panel.innerHTML = res.users.map((u) => `
    <div class="table-row">
      <div class="col" style="flex:2;">
        <b>${escapeHtml(u.display_name)}</b> <span style="color:var(--text-secondary);">@${escapeHtml(u.username)}</span>
        ${u.role === 'admin' ? '<span class="badge admin">ADMIN</span>' : ''}
      </div>
      <div class="col">${u.is_online ? '<span class="badge online">Online</span>' : `<span class="badge offline">Offline</span>`}</div>
      <div class="col">${u.is_banned ? `<span class="badge banned">Banned${u.banned_reason ? ': ' + escapeHtml(u.banned_reason) : ''}</span>` : '—'}</div>
      <div class="col" style="flex:0 0 auto;">
        ${u.role !== 'admin' ? (u.is_banned
          ? `<button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" onclick="unbanUser('${u.id}')">Unban</button>`
          : `<button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" onclick="banUser('${u.id}')">Ban</button>`)
          : ''}
      </div>
    </div>
  `).join('');
}

async function banUser(userId) {
  const reason = prompt('Reason for ban (optional):') || '';
  try {
    await Api.post(`/api/admin/users/${userId}/ban`, { reason });
    Toast.success('User banned.');
    await loadUsers();
  } catch (err) {
    Toast.error(err.data?.message || err.message);
  }
}

async function unbanUser(userId) {
  try {
    await Api.post(`/api/admin/users/${userId}/unban`);
    Toast.success('User unbanned.');
    await loadUsers();
  } catch (err) {
    Toast.error(err.data?.message || err.message);
  }
}

async function loadGroups() {
  const res = await Api.get('/api/admin/groups?limit=200');
  const panel = document.getElementById('panelGroups');
  if (res.groups.length === 0) {
    panel.innerHTML = `<div class="empty-state">No groups found.</div>`;
    return;
  }
  panel.innerHTML = res.groups.map((g) => `
    <div class="table-row">
      <div class="col" style="flex:2;"><b>${escapeHtml(g.name)}</b></div>
      <div class="col">${g.member_count} members</div>
      <div class="col">${new Date(g.created_at).toLocaleDateString()}</div>
      <div class="col" style="flex:0 0 auto;">
        <button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" onclick="deleteGroup('${g.id}', '${escapeHtml(g.name)}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function deleteGroup(groupId, name) {
  if (!confirm(`Delete group "${name}"? This removes all its messages permanently.`)) return;
  try {
    await Api.del(`/api/admin/groups/${groupId}`);
    Toast.success('Group deleted.');
    await Promise.all([loadGroups(), loadStats()]);
  } catch (err) {
    Toast.error(err.data?.message || err.message);
  }
}

async function loadLogs() {
  const res = await Api.get('/api/admin/logs?limit=150');
  const panel = document.getElementById('panelLogs');
  if (res.logs.length === 0) {
    panel.innerHTML = `<div class="empty-state">No activity yet.</div>`;
    return;
  }
  panel.innerHTML = res.logs.map((l) => `
    <div class="table-row">
      <div class="col" style="flex:0 0 140px;">${new Date(l.created_at).toLocaleString()}</div>
      <div class="col" style="flex:0 0 140px;"><b>${escapeHtml(l.action)}</b></div>
      <div class="col">${escapeHtml(l.username || 'system')}</div>
      <div class="col" style="flex:2;color:var(--text-secondary);font-size:11.5px;">${escapeHtml((l.details || '').slice(0, 120))}</div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', bootstrapAdmin);

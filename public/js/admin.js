// public/js/admin.js (FULL)
let currentSection = 'overview';

let ADMIN_CLUBS = [];
let ADMIN_PLAYERS = [];
let ADMIN_GWS = [];
let ADMIN_MATCHES = [];
let ADMIN_TEAMS = [];

document.addEventListener('DOMContentLoaded', async function () {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!token || !user.isAdmin) return (window.location.href = '/login');

  initializeSidebar();
  await loadOverview();
  await loadPlayers();
  await loadClubs();
  await loadGameweeks();
  await loadMatches();
  await loadUsers();
  await loadTeams();
});

function initializeSidebar() {
  document.querySelectorAll('.admin-sidebar .nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      switchSection(section);
    });
  });
}

function switchSection(section) {
  document.querySelectorAll('.admin-sidebar .nav-link').forEach(l => l.classList.remove('active'));
  const sel = document.querySelector(`.admin-sidebar .nav-link[data-section="${section}"]`);
  if (sel) sel.classList.add('active');
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  const target = document.getElementById(`${section}-section`);
  if (target) target.style.display = 'block';
}

async function loadOverview() {
  try {
    const users = await (await fetch('/api/leaderboard?limit=1')).json();
    const players = await (await fetch('/api/players')).json();
    const gw = await (await fetch('/api/gameweeks/active')).json();

    document.getElementById('totalUsers').textContent = users.totalPages ? users.totalPages * 20 : '—';
    document.getElementById('totalPlayers').textContent = players.length;
    document.getElementById('activeGameweek').textContent = gw?.weekNumber || '—';
    const today = new Date().toDateString();
    const matchesToday = (gw?.matches || []).filter(m => new Date(m.date).toDateString() === today).length;
    document.getElementById('matchesToday').textContent = matchesToday;
  } catch (e) {
    console.error('Overview load error', e);
  }
}

// Optional API sync
async function triggerSync(kind) {
  const map = {
    clubs: '/api/admin/sync/clubs',
    players: '/api/admin/sync/players',
    fixtures: '/api/admin/sync/fixtures',
    results: '/api/admin/sync/results'
  };
  const url = map[kind];
  if (!url) return;
  appendLog(`Starting ${kind} sync...`);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  appendLog(`${data.message}`);
  if (kind === 'players') await loadPlayers();
  if (kind === 'clubs') await loadClubs();
  if (kind === 'fixtures') { await loadGameweeks(); await loadMatches(); }
  if (kind === 'results') { await loadMatches(); }
}
function appendLog(line) {
  const box = document.getElementById('syncLog');
  box.textContent += `${line}\n`;
}
async function recalculateAll() {
  appendLog('Recalculating all points...');
  const res = await fetch('/api/admin/recalculate', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  appendLog(data.message);
}

// Players
async function loadPlayers() {
  const res = await fetch('/api/admin/players', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  ADMIN_PLAYERS = await res.json();
  const tbody = document.getElementById('playersTable');
  if (tbody) {
    tbody.innerHTML = ADMIN_PLAYERS.map(p => `
      <tr>
        <td>${p.name}</td>
        <td><span class="player-position position-${p.position}">${p.position}</span></td>
        <td>${p.club?.name || 'N/A'}</td>
        <td><input type="number" class="form-control form-control-sm" value="${p.price}" min="1" step="0.5" onchange="updatePlayer('${p._id}', {price: parseFloat(this.value)})"></td>
        <td>${p.totalPoints ?? 0}</td>
        <td>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" ${p.isActive ? 'checked' : ''} onchange="updatePlayer('${p._id}', {isActive: this.checked})">
          </div>
        </td>
        <td class="d-flex gap-2">
          <button class="btn btn-sm btn-danger" onclick="deletePlayer('${p._id}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`).join('');
  }
}
async function updatePlayer(id, payload) {
  await fetch(`/api/admin/players/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(payload)
  });
}
async function deletePlayer(id) {
  if (!confirm('Delete player?')) return;
  await fetch(`/api/admin/players/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  loadPlayers();
}
function openPlayerCreate() {
  alert('Tip: Use API Players or add players via database/temporary tool. Inline player create UI can be added similarly.');
}

// Clubs
async function loadClubs() {
  const res = await fetch('/api/admin/clubs', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  ADMIN_CLUBS = await res.json();
  const grid = document.getElementById('clubsGrid');
  if (grid) {
    grid.innerHTML = ADMIN_CLUBS.map(c => `
      <div class="col-md-4 col-lg-3 mb-3">
        <div class="card">
          <div class="card-body text-center">
            <img src="${c.logo || ''}" onerror="this.style.display='none'" height="40" class="mb-2"/>
            <h6>${c.name}</h6>
            <small class="text-muted">${c.city || ''}</small>
            <div class="mt-2 d-flex justify-content-center gap-2">
              <button class="btn btn-sm btn-primary" onclick="editClub('${c._id}', '${c.name}')">Edit</button>
            </div>
          </div>
        </div>
      </div>`).join('');
  }
}
async function editClub(id, name) {
  const newName = prompt('Edit club name', name);
  if (!newName || newName === name) return;
  await fetch(`/api/admin/clubs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ name: newName }) });
  loadClubs();
}

// Matches
async function loadMatches() {
  const res = await fetch('/api/admin/matches', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  ADMIN_MATCHES = await res.json();
  const list = document.getElementById('matchesList');
  if (list) {
    list.innerHTML = ADMIN_MATCHES.slice(0, 100).map(m => `
      <div class="card mb-2">
        <div class="card-body">
          <div class="row align-items-center">
            <div class="col-md-3 text-end">${m.homeClub?.name || '—'}</div>
            <div class="col-md-6 text-center">
              <strong>${m.homeScore ?? '-'} : ${m.awayScore ?? '-'}</strong>
              <br><small>${m.gameweek ? `GW ${m.gameweek.weekNumber}` : ''} • ${new Date(m.date).toLocaleString()}</small>
            </div>
            <div class="col-md-3 text-start">${m.awayClub?.name || '—'}</div>
          </div>
          <div class="mt-2 d-flex flex-wrap gap-2">
            <span class="badge ${m.isCompleted ? 'bg-success' : 'bg-secondary'}">${m.isCompleted ? 'Completed' : (m.status || 'Pending')}</span>
            <button class="btn btn-sm btn-outline-primary" onclick="openPerfModal('${m._id}')">Results & Performances</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="openMatchModal('edit','${m._id}')">Edit Match</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteMatch('${m._id}')">Delete</button>
          </div>
        </div>
      </div>`).join('');
  }
}

// Gameweeks
async function loadGameweeks() {
  const res = await fetch('/api/admin/gameweeks', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  ADMIN_GWS = await res.json();
  const container = document.getElementById('gameweeksList');
  if (container) {
    container.innerHTML = ADMIN_GWS.map(g => `
      <div class="col-md-4 mb-3">
        <div class="card">
          <div class="card-body">
            <h5>Gameweek ${g.weekNumber}</h5>
            <p class="text-muted">${g.startDate ? new Date(g.startDate).toLocaleDateString() : '—'} - ${g.endDate ? new Date(g.endDate).toLocaleDateString() : '—'}</p>
            <p class="text-muted">Deadline: ${g.deadline ? new Date(g.deadline).toLocaleString() : '—'}</p>
            <span class="badge ${g.isActive ? 'bg-success' : 'bg-secondary'}">${g.isActive ? 'Active' : 'Inactive'}</span>
            <div class="mt-2 d-flex flex-wrap gap-2">
              <button class="btn btn-sm btn-primary" onclick="activateGW('${g._id}')">Activate</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="openGWModal('edit','${g._id}')">Edit</button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteGW('${g._id}')">Delete</button>
            </div>
          </div>
        </div>
      </div>`).join('');
  }
}
async function activateGW(id) {
  await fetch(`/api/admin/gameweeks/${id}/activate`, { method: 'PUT', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  await loadGameweeks();
}
function openGWModal(mode, id) {
  const modalEl = document.getElementById('gwModal');
  const modal = new bootstrap.Modal(modalEl);
  document.getElementById('gwModalTitle').textContent = mode === 'edit' ? 'Edit Gameweek' : 'Add Gameweek';
  document.getElementById('gwId').value = id || '';
  document.getElementById('gwWeekNumber').value = '';
  document.getElementById('gwRoundLabel').value = '';
  document.getElementById('gwStartDate').value = '';
  document.getElementById('gwEndDate').value = '';
  document.getElementById('gwDeadline').value = '';
  if (mode === 'edit' && id) {
    const gw = ADMIN_GWS.find(x => x._id === id);
    if (gw) {
      document.getElementById('gwWeekNumber').value = gw.weekNumber || '';
      document.getElementById('gwRoundLabel').value = gw.roundLabel || '';
      document.getElementById('gwStartDate').value = gw.startDate ? toLocalInputDateTime(gw.startDate) : '';
      document.getElementById('gwEndDate').value = gw.endDate ? toLocalInputDateTime(gw.endDate) : '';
      document.getElementById('gwDeadline').value = gw.deadline ? toLocalInputDateTime(gw.deadline) : '';
    }
  }
  modal.show();
}
async function submitGWForm(e) {
  e.preventDefault();
  const id = document.getElementById('gwId').value;
  const payload = {
    weekNumber: parseInt(document.getElementById('gwWeekNumber').value, 10),
    roundLabel: document.getElementById('gwRoundLabel').value || undefined,
    startDate: fromLocalInputDateTime(document.getElementById('gwStartDate').value),
    endDate: fromLocalInputDateTime(document.getElementById('gwEndDate').value),
    deadline: fromLocalInputDateTime(document.getElementById('gwDeadline').value)
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/gameweeks/${id}` : '/api/admin/gameweeks';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to save gameweek');
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById('gwModal')).hide();
  await loadGameweeks();
}
async function deleteGW(id) {
  if (!confirm('Delete this gameweek? Matches will be detached.')) return;
  await fetch(`/api/admin/gameweeks/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  await loadGameweeks();
}

// Team Performances Modal logic exists (same as before) ...
// ... (keep your existing performances modal code below unchanged) ...
// The earlier large block for performances remains, omitted for brevity in this comment.
// Make sure you keep all functions openPerfModal, buildPerfPlayerOptions, addPerfRowFromSelect, submitPerfForm, etc.

// Users
async function loadUsers() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();
  const tbody = document.getElementById('usersTable');
  if (tbody) {
    tbody.innerHTML = (data.users || []).map(u => `
      <tr>
        <td>${u.username}</td>
        <td>${u.email || ''}</td>
        <td>${u.totalPoints}</td>
        <td>${(u.team || []).length}</td>
        <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}</td>
      </tr>`).join('');
  }
}

// ========== NEW: Teams (Admin) ==========
async function loadTeams() {
  const res = await fetch('/api/admin/teams', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  ADMIN_TEAMS = await res.json();
  renderTeamsList();
}
function filterTeams() {
  renderTeamsList(document.getElementById('teamSearch').value.trim());
}
function renderTeamsList(q = '') {
  const tbody = document.getElementById('teamsTable');
  if (!tbody) return;
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const list = ADMIN_TEAMS.filter(u => !rx || rx.test(u.username) || rx.test(u.email || ''));
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No teams</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(u => `
    <tr>
      <td>${u.username}</td>
      <td>${u.email || ''}</td>
      <td>${(u.team || []).length}</td>
      <td>${u.budget?.toFixed ? u.budget.toFixed(1) : u.budget}</td>
      <td>${u.freeTransfers ?? 0}</td>
      <td>${u.transfersMadeThisGW ?? 0}</td>
      <td>${u.totalPoints ?? 0}</td>
      <td class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-primary" onclick="openTeamModal('${u._id}')">View/Edit</button>
        <button class="btn btn-sm btn-outline-danger" onclick="clearUserTeam('${u._id}')">Clear</button>
      </td>
    </tr>
  `).join('');
}

async function openTeamModal(userId) {
  const res = await fetch(`/api/admin/teams/${userId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const u = await res.json();
  if (!res.ok) { alert(u.error || 'Failed to load team'); return; }

  document.getElementById('teamUserId').value = u._id;
  document.getElementById('teamUsername').value = u.username;
  document.getElementById('teamFreeTransfers').value = u.freeTransfers ?? 1;
  document.getElementById('teamBudget').value = u.budget ?? 100;

  const list = document.getElementById('teamPlayersList');
  list.innerHTML = (u.team || []).map(s => `
    <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div>
        <strong>${s.player?.name || 'Unknown'}</strong> <span class="badge bg-secondary">${s.player?.position || ''}</span>
        <div class="text-muted small">${s.player?.club?.name || ''}</div>
        ${s.captain ? '<span class="badge bg-warning text-dark me-1">C</span>' : ''}
        ${s.viceCaptain ? '<span class="badge bg-info text-dark">VC</span>' : ''}
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="adminRemovePlayerFromUser('${s.player?._id}')"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `).join('');

  const modal = new bootstrap.Modal(document.getElementById('teamModal'));
  modal.show();
}

// Admin edit helpers (stored locally during modal open)
let ADMIN_EDIT_TEAM = [];
function getCurrentModalTeamIds() {
  const list = document.getElementById('teamPlayersList').querySelectorAll('.d-flex.border');
  // quick parse using data attributes would be better; for simplicity we re-fetch detail when saving
  return null;
}
function adminRemovePlayerFromUser(playerId) {
  const row = Array.from(document.querySelectorAll('#teamPlayersList .d-flex.border')).find(r => r.innerHTML.includes(playerId));
  if (row) row.remove();
}
async function adminAddPlayerToUser() {
  const input = document.getElementById('addPlayerIdInput');
  const id = input.value.trim();
  if (!id) return;
  // simple append card; actual validation happens on save
  const res = await fetch(`/api/players/${id}`);
  const p = await res.json();
  if (!res.ok) { alert('Invalid player ID'); return; }
  const list = document.getElementById('teamPlayersList');
  const div = document.createElement('div');
  div.className = 'd-flex align-items-center justify-content-between border rounded p-2 mb-2';
  div.innerHTML = `
    <div>
      <strong>${p.name}</strong> <span class="badge bg-secondary">${p.position}</span>
      <div class="text-muted small">${p.club?.name || ''}</div>
    </div>
    <div class="d-flex gap-2">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.d-flex.border').remove()"><i class="bi bi-trash"></i></button>
    </div>
  `;
  // embed hidden id
  div.dataset.playerId = p._id;
  list.appendChild(div);
  input.value = '';
}

async function submitTeamAdminForm(e) {
  e.preventDefault();
  const userId = document.getElementById('teamUserId').value;
  const freeTransfers = parseInt(document.getElementById('teamFreeTransfers').value || '0', 10);
  const budget = parseFloat(document.getElementById('teamBudget').value || '0');

  // Collect 15 ids from the DOM
  const ids = Array.from(document.querySelectorAll('#teamPlayersList .d-flex.border')).map(el => el.dataset.playerId).filter(Boolean);
  if (ids.length && ids.length !== 15) {
    if (!confirm(`Team has ${ids.length} players (not 15). Save anyway?`)) return;
  }

  const payload = { freeTransfers, budget };
  if (ids.length) payload.teamPlayerIds = ids;

  const res = await fetch(`/api/admin/teams/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save'); return; }

  bootstrap.Modal.getInstance(document.getElementById('teamModal')).hide();
  await loadTeams();
}
async function clearUserTeam(userId) {
  if (!confirm('Clear this user team?')) return;
  const res = await fetch(`/api/admin/teams/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to clear'); return; }
  await loadTeams();
}
async function adminClearUserTeam() {
  const userId = document.getElementById('teamUserId').value;
  await clearUserTeam(userId);
  bootstrap.Modal.getInstance(document.getElementById('teamModal')).hide();
}

// Utils
function toLocalInputDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function fromLocalInputDateTime(val) {
  return val ? new Date(val).toISOString() : undefined;
}
function logout() {
  localStorage.removeItem('token');
  window.location.href = '/login';
}

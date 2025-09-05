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

  // Optional: refresh section-specific data
  if (section === 'clubs') loadClubs();
  if (section === 'players') loadPlayers();
  if (section === 'matches') loadMatches();
  if (section === 'gameweeks') loadGameweeks();
  if (section === 'teams') loadTeams();
  if (section === 'users') loadUsers();
}

async function loadOverview() {
  try {
    const [teamsRes, playersRes, gwRes] = await Promise.all([
      fetch('/api/admin/teams', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
      fetch('/api/admin/players', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
      fetch('/api/admin/gameweeks/active', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    ]);
    const teams = await teamsRes.json();
    const players = await playersRes.json();
    const gw = await gwRes.json();

    document.getElementById('totalUsers').textContent = Array.isArray(teams) ? teams.length : '—';
    document.getElementById('totalPlayers').textContent = Array.isArray(players) ? players.length : '—';
    document.getElementById('activeGameweek').textContent = gw?.weekNumber || '—';

    const matchesRes = await fetch('/api/admin/matches', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const matches = await matchesRes.json();
    const today = new Date().toDateString();
    const matchesToday = (matches || []).filter(m => m.date && new Date(m.date).toDateString() === today).length;
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
        <div class="card h-100">
          <div class="card-body text-center d-flex flex-column">
            <img src="${c.logo || ''}" onerror="this.style.display='none'" height="40" class="mb-2"/>
            <h6 class="mb-0">${c.name}</h6>
            <small class="text-muted">${c.shortName || ''}</small>
            <div class="mt-2">
              <small class="text-muted d-block">${c.city || ''}</small>
              <small class="text-muted d-block">${c.stadium || ''}</small>
            </div>
            <div class="mt-2 d-flex justify-content-center gap-2">
              <span class="badge" style="background:${c.primaryColor || '#000'};">&nbsp;&nbsp;</span>
              <span class="badge" style="background:${c.secondaryColor || '#fff'};border:1px solid #ddd;">&nbsp;&nbsp;</span>
            </div>
            <div class="mt-auto d-flex justify-content-center gap-2 pt-3">
              <button class="btn btn-sm btn-primary" onclick="openClubModal('edit','${c._id}')">Edit</button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteClub('${c._id}')">Delete</button>
            </div>
          </div>
        </div>
      </div>`).join('');
  }
}

function openClubModal(mode, id) {
  const modalEl = document.getElementById('clubModal');
  const modal = new bootstrap.Modal(modalEl);
  document.getElementById('clubModalTitle').textContent = mode === 'edit' ? 'Edit Club' : 'Add Club';

  // Reset form
  document.getElementById('clubForm').reset();
  document.getElementById('clubId').value = '';
  document.getElementById('clubApiId').value = '';
  document.getElementById('clubPrimaryColor').value = '#000000';
  document.getElementById('clubSecondaryColor').value = '#FFFFFF';

  if (mode === 'edit' && id) {
    const c = ADMIN_CLUBS.find(x => String(x._id) === String(id));
    if (!c) {
      alert('Club not found');
      return;
    }
    document.getElementById('clubId').value = c._id;
    document.getElementById('clubApiId').value = c.apiId ?? '';
    document.getElementById('clubName').value = c.name || '';
    document.getElementById('clubShortName').value = c.shortName || '';
    document.getElementById('clubLogo').value = c.logo || '';
    document.getElementById('clubStadium').value = c.stadium || '';
    document.getElementById('clubCity').value = c.city || '';
    document.getElementById('clubPrimaryColor').value = c.primaryColor || '#000000';
    document.getElementById('clubSecondaryColor').value = c.secondaryColor || '#FFFFFF';
  }

  modal.show();
}

async function submitClubForm(e) {
  e.preventDefault();
  const id = document.getElementById('clubId').value;
  const payload = {
    apiId: document.getElementById('clubApiId').value ? Number(document.getElementById('clubApiId').value) : undefined,
    name: document.getElementById('clubName').value.trim(),
    shortName: document.getElementById('clubShortName').value.trim() || undefined,
    logo: document.getElementById('clubLogo').value.trim() || undefined,
    stadium: document.getElementById('clubStadium').value.trim() || undefined,
    city: document.getElementById('clubCity').value.trim() || undefined,
    primaryColor: document.getElementById('clubPrimaryColor').value || '#000000',
    secondaryColor: document.getElementById('clubSecondaryColor').value || '#FFFFFF'
  };
  if (!payload.name) {
    alert('Name is required');
    return;
  }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/clubs/${id}` : '/api/admin/clubs';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to save club');
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById('clubModal')).hide();
  await loadClubs();
}

async function deleteClub(id) {
  if (!confirm('Delete this club?')) return;
  const res = await fetch(`/api/admin/clubs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to delete club');
    return;
  }
  await loadClubs();
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

function openMatchModal(mode, id) {
  const modalEl = document.getElementById('matchModal');
  const modal = new bootstrap.Modal(modalEl);
  document.getElementById('matchModalTitle').textContent = mode === 'edit' ? 'Edit Match' : 'Add Match';
  document.getElementById('matchId').value = id || '';
  document.getElementById('matchHomeClub').innerHTML = '<option>Loading...</option>';
  document.getElementById('matchAwayClub').innerHTML = '<option>Loading...</option>';
  document.getElementById('matchGameweek').innerHTML = '<option value="">-- none --</option>';
  document.getElementById('matchDate').value = '';
  document.getElementById('matchRound').value = '';
  document.getElementById('matchWeekNumber').value = '';
  document.getElementById('matchStatus').value = '';

  Promise.all([
    fetch('/api/admin/clubs', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }).then(r => r.json()),
    fetch('/api/admin/gameweeks', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }).then(r => r.json())
  ]).then(async ([clubs, gws]) => {
    const clubOpts = clubs.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
    document.getElementById('matchHomeClub').innerHTML = `<option value="">-- select --</option>` + clubOpts;
    document.getElementById('matchAwayClub').innerHTML = `<option value="">-- select --</option>` + clubOpts;
    document.getElementById('matchGameweek').innerHTML = `<option value="">-- none --</option>` + gws.map(g => `<option value="${g._id}">GW ${g.weekNumber}</option>`).join('');

    if (mode === 'edit' && id) {
      const res = await fetch(`/api/admin/matches/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const m = await res.json();
      if (!res.ok) { alert(m.error || 'Failed to load match'); return; }
      document.getElementById('matchHomeClub').value = m.homeClub?._id || '';
      document.getElementById('matchAwayClub').value = m.awayClub?._id || '';
      document.getElementById('matchGameweek').value = m.gameweek?._id || '';
      document.getElementById('matchDate').value = m.date ? toLocalInputDateTime(m.date) : '';
      document.getElementById('matchRound').value = m.round || '';
      document.getElementById('matchWeekNumber').value = m.weekNumber || '';
      document.getElementById('matchStatus').value = m.status || '';
    }

    modal.show();
  });
}

async function submitMatchForm(e) {
  e.preventDefault();
  const id = document.getElementById('matchId').value;
  const payload = {
    homeClub: document.getElementById('matchHomeClub').value,
    awayClub: document.getElementById('matchAwayClub').value,
    gameweekId: document.getElementById('matchGameweek').value || undefined,
    date: document.getElementById('matchDate').value ? new Date(document.getElementById('matchDate').value).toISOString() : undefined,
    round: document.getElementById('matchRound').value || undefined,
    weekNumber: document.getElementById('matchWeekNumber').value ? Number(document.getElementById('matchWeekNumber').value) : undefined,
    status: document.getElementById('matchStatus').value || undefined
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/matches/${id}` : '/api/admin/matches';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save match'); return; }
  bootstrap.Modal.getInstance(document.getElementById('matchModal')).hide();
  await loadMatches();
}

async function deleteMatch(id) {
  if (!confirm('Delete match?')) return;
  await fetch(`/api/admin/matches/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  await loadMatches();
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
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save gameweek'); return; }
  bootstrap.Modal.getInstance(document.getElementById('gwModal')).hide();
  await loadGameweeks();
}
async function deleteGW(id) {
  if (!confirm('Delete this gameweek? Matches will be detached.')) return;
  await fetch(`/api/admin/gameweeks/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  await loadGameweeks();
}

// Performances modal & helpers
function openPerfModal(matchId) {
  const modalEl = document.getElementById('perfModal');
  const modal = new bootstrap.Modal(modalEl);
  document.getElementById('perfMatchId').value = matchId;
  document.getElementById('perfHomeScore').value = '';
  document.getElementById('perfAwayScore').value = '';
  document.getElementById('perfStatus').value = '';
  document.getElementById('perfTbody').innerHTML = '';
  document.getElementById('perfPlayerSelect').innerHTML = '<option>Loading...</option>';
  fetch(`/api/admin/matches/${matchId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    .then(r => r.json())
    .then(m => {
      if (!m || m.error) return alert(m.error || 'Failed to load match');
      document.getElementById('perfHomeScore').value = m.homeScore ?? '';
      document.getElementById('perfAwayScore').value = m.awayScore ?? '';
      document.getElementById('perfStatus').value = m.status || '';
      const opts = ADMIN_PLAYERS
        .filter(p => String(p.club?._id) === String(m.homeClub?._id) || String(p.club?._id) === String(m.awayClub?._id))
        .map(p => `<option value="${p._id}">${p.name} — ${p.position} — ${p.club?.name || ''}</option>`).join('');
      document.getElementById('perfPlayerSelect').innerHTML = `<option value="">-- select player --</option>` + opts;
      if (Array.isArray(m.playerPerformances) && m.playerPerformances.length) {
        for (const perf of m.playerPerformances) {
          addPerfRow(prefillPerformanceRow(perf));
        }
      }
      modal.show();
    }).catch(err => { console.error(err); alert('Error loading match'); });
}

function prefillPerformanceRow(perf) {
  return {
    playerId: perf.player?._id || perf.player,
    minutesPlayed: perf.minutesPlayed || 0,
    goals: perf.goals || 0,
    assists: perf.assists || 0,
    conceded: perf.conceded || 0,
    cleanSheet: perf.cleanSheet ? true : false,
    yellowCard: perf.yellowCard ? true : false,
    redCard: perf.redCard ? true : false,
    saves: perf.saves || 0,
    penaltiesSaved: perf.penaltiesSaved || 0,
    penaltiesMissed: perf.penaltiesMissed || 0,
    ownGoals: perf.ownGoals || 0
  };
}

function buildPerfPlayerOptions() {
  return ADMIN_PLAYERS.map(p => `<option value="${p._id}">${p.name} — ${p.position} — ${p.club?.name || ''}</option>`).join('');
}

function addPerfRowFromSelect() {
  const sel = document.getElementById('perfPlayerSelect');
  const pid = sel.value;
  if (!pid) return;
  const p = ADMIN_PLAYERS.find(x => String(x._id) === String(pid));
  addPerfRow({
    playerId: pid,
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    conceded: 0,
    cleanSheet: false,
    yellowCard: false,
    redCard: false,
    saves: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    ownGoals: 0,
    name: p ? p.name : ''
  });
}

function addPerfRow(data = {}) {
  const tbody = document.getElementById('perfTbody');
  const tr = document.createElement('tr');
  tr.dataset.playerId = data.playerId || '';
  tr.innerHTML = `
    <td style="min-width:180px;">
      <select class="form-select form-select-sm perf-player-select" onchange="onPerfPlayerChange(this)">
        <option value="">-- select player --</option>
        ${buildPerfPlayerOptions()}
      </select>
    </td>
    <td><input type="number" class="form-control form-control-sm perf-min" value="${data.minutesPlayed || 0}"></td>
    <td><input type="number" class="form-control form-control-sm perf-goals" value="${data.goals || 0}"></td>
    <td><input type="number" class="form-control form-control-sm perf-assists" value="${data.assists || 0}"></td>
    <td><input type="number" class="form-control form-control-sm perf-conceded" value="${data.conceded || 0}"></td>
    <td><input type="checkbox" class="form-check-input perf-cs" ${data.cleanSheet ? 'checked' : ''}></td>
    <td><input type="checkbox" class="form-check-input perf-yc" ${data.yellowCard ? 'checked' : ''}></td>
    <td><input type="checkbox" class="form-check-input perf-rc" ${data.redCard ? 'checked' : ''}></td>
    <td><input type="number" class="form-control form-control-sm perf-saves" value="${data.saves || 0}"></td>
    <td><input type="number" class="form-control form-control-sm perf-ps" value="${data.penaltiesSaved || 0}"></td>
    <td><input type="number" class="form-control form-control-sm perf-pm" value="${data.penaltiesMissed || 0}"></td>
    <td><input type="number" class="form-control form-control-sm perf-og" value="${data.ownGoals || 0}"></td>
    <td><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">Remove</button></td>
  `;
  tbody.appendChild(tr);
  if (data.playerId) {
    const sel = tr.querySelector('.perf-player-select');
    if (sel) sel.value = data.playerId;
  }
}

function onPerfPlayerChange(sel) {
  const val = sel.value;
  if (!val) return;
  const rows = Array.from(document.querySelectorAll('#perfTbody tr'));
  const ids = rows.map(r => r.querySelector('.perf-player-select')?.value).filter(Boolean);
  const dup = ids.filter(i => i === val);
  if (dup.length > 1) {
    alert('Player already added in another row');
    sel.value = '';
  }
}

async function submitPerfForm(e) {
  e.preventDefault();
  const matchId = document.getElementById('perfMatchId').value;
  const homeScore = document.getElementById('perfHomeScore').value !== '' ? Number(document.getElementById('perfHomeScore').value) : undefined;
  const awayScore = document.getElementById('perfAwayScore').value !== '' ? Number(document.getElementById('perfAwayScore').value) : undefined;
  const status = document.getElementById('perfStatus').value || undefined;

  const rows = Array.from(document.querySelectorAll('#perfTbody tr'));
  const perfArr = [];
  for (const r of rows) {
    const playerId = r.querySelector('.perf-player-select')?.value;
    if (!playerId) continue;
    perfArr.push({
      player: playerId,
      minutesPlayed: Number(r.querySelector('.perf-min')?.value || 0),
      goals: Number(r.querySelector('.perf-goals')?.value || 0),
      assists: Number(r.querySelector('.perf-assists')?.value || 0),
      conceded: Number(r.querySelector('.perf-conceded')?.value || 0),
      cleanSheet: !!r.querySelector('.perf-cs')?.checked,
      yellowCard: !!r.querySelector('.perf-yc')?.checked,
      redCard: !!r.querySelector('.perf-rc')?.checked,
      saves: Number(r.querySelector('.perf-saves')?.value || 0),
      penaltiesSaved: Number(r.querySelector('.perf-ps')?.value || 0),
      penaltiesMissed: Number(r.querySelector('.perf-pm')?.value || 0),
      ownGoals: Number(r.querySelector('.perf-og')?.value || 0)
    });
  }

  const payload = { homeScore, awayScore, status, playerPerformances: perfArr };
  const res = await fetch(`/api/admin/matches/${matchId}/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save results'); return; }
  bootstrap.Modal.getInstance(document.getElementById('perfModal')).hide();
  await loadMatches();
  await loadGameweeks();
  await loadPlayers();
}

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

// Teams (admin)
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
    <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2 player-row" data-player-id="${s.player?._id}">
      <div>
        <strong>${s.player?.name || 'Unknown'}</strong> <span class="badge bg-secondary">${s.player?.position || ''}</span>
        <div class="text-muted small">${s.player?.club?.name || ''}</div>
        ${s.captain ? '<span class="badge bg-warning text-dark me-1">C</span>' : ''}
        ${s.viceCaptain ? '<span class="badge bg-info text-dark">VC</span>' : ''}
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.player-row').remove()"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `).join('');

  const modal = new bootstrap.Modal(document.getElementById('teamModal'));
  modal.show();
}

async function adminAddPlayerToUser() {
  const input = document.getElementById('addPlayerIdInput');
  const id = input.value.trim();
  if (!id) return;
  const res = await fetch(`/api/players/${id}`);
  const p = await res.json();
  if (!res.ok) { alert(p.error || 'Invalid player ID'); return; }
  const list = document.getElementById('teamPlayersList');
  const div = document.createElement('div');
  div.className = 'd-flex align-items-center justify-content-between border rounded p-2 mb-2 player-row';
  div.dataset.playerId = p._id;
  div.innerHTML = `
    <div>
      <strong>${p.name}</strong> <span class="badge bg-secondary">${p.position}</span>
      <div class="text-muted small">${p.club?.name || ''}</div>
    </div>
    <div class="d-flex gap-2">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.player-row').remove()"><i class="bi bi-trash"></i></button>
    </div>
  `;
  list.appendChild(div);
  input.value = '';
}

async function submitTeamAdminForm(e) {
  e.preventDefault();
  const userId = document.getElementById('teamUserId').value;
  const freeTransfers = parseInt(document.getElementById('teamFreeTransfers').value || '0', 10);
  const budget = parseFloat(document.getElementById('teamBudget').value || '0');

  const ids = Array.from(document.querySelectorAll('#teamPlayersList .player-row')).map(el => el.dataset.playerId).filter(Boolean);
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

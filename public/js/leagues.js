let MY_LEAGUES = [];
let CURRENT_LEAGUE = null;
let CURRENT_USER = null;

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) return window.location.href = '/login';
  CURRENT_USER = JSON.parse(localStorage.getItem('user') || '{}');
  await loadMyLeagues();

  document.getElementById('copyCodeBtn').addEventListener('click', copyCodeToClipboard);
  document.getElementById('leaveLeagueBtn').addEventListener('click', leaveCurrentLeague);
});

function alertBox(message, type = 'success') {
  const box = document.getElementById('leaguesAlert');
  box.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
    ${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

async function loadMyLeagues() {
  const res = await fetch('/api/leagues/mine', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  MY_LEAGUES = await res.json();
  document.getElementById('myLeaguesCount').textContent = MY_LEAGUES.length;

  const wrapper = document.getElementById('myLeaguesList');
  if (!MY_LEAGUES.length) {
    wrapper.innerHTML = `<div class="text-muted">No leagues yet</div>`;
    return;
  }

  wrapper.innerHTML = MY_LEAGUES.map(l => `
    <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div>
        <div class="fw-semibold">${l.name}</div>
        <div class="text-muted small">Code: ${l.code}</div>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-primary" onclick="openLeague('${l._id}')"><i class="bi bi-list-ol"></i> Standings</button>
      </div>
    </div>
  `).join('');
}

async function openLeague(id) {
  const res = await fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to load league', 'danger');
  CURRENT_LEAGUE = data.league;

  document.getElementById('detailLeagueName').textContent = data.league.name;
  document.getElementById('detailLeagueCode').textContent = data.league.code;
  document.getElementById('leagueDetailCard').style.display = 'block';

  // Owner cannot leave
  const isOwner = String(data.league.owner) === String(CURRENT_USER.id);
  const leaveBtn = document.getElementById('leaveLeagueBtn');
  if (isOwner) {
    leaveBtn.disabled = true;
    leaveBtn.title = 'Owner cannot leave own league';
  } else {
    leaveBtn.disabled = false;
    leaveBtn.title = '';
  }

  const tbody = document.getElementById('leagueStandings');
  const standings = data.standings || [];
  if (!standings.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">No members yet</td></tr>`;
    return;
  }
  tbody.innerHTML = standings.map((u, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${u.username}</td>
      <td>${u.email || ''}</td>
      <td>${u.totalPoints || 0}</td>
    </tr>
  `).join('');
}

function copyCodeToClipboard() {
  const code = document.getElementById('detailLeagueCode').textContent;
  if (!code) return;
  navigator.clipboard.writeText(code);
  alertBox('Invite code copied to clipboard');
}

async function leaveCurrentLeague() {
  if (!CURRENT_LEAGUE) return;
  if (!confirm('Leave this league?')) return;
  const res = await fetch(`/api/leagues/${CURRENT_LEAGUE._id}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to leave', 'danger');
  alertBox('Left league', 'secondary');
  document.getElementById('leagueDetailCard').style.display = 'none';
  await loadMyLeagues();
}

async function createLeague(e) {
  e.preventDefault();
  const name = document.getElementById('leagueName').value.trim();
  if (!name) return;
  const res = await fetch('/api/leagues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to create league', 'danger');
  alertBox('League created');
  document.getElementById('leagueName').value = '';
  await loadMyLeagues();
  await openLeague(data._id);
}

async function joinLeague(e) {
  e.preventDefault();
  const code = document.getElementById('inviteCode').value.trim();
  if (!code) return;
  const res = await fetch('/api/leagues/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ code })
  });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to join league', 'danger');
  alertBox('Joined league');
  document.getElementById('inviteCode').value = '';
  await loadMyLeagues();
  await openLeague(data._id);
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

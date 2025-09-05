// public/js/dashboard.js (FULL - REPLACE your existing file with this)

let selectedPlayers = []; // array of player objects (size 15)
let startingXI = [];      // array of player IDs (11)
let benchOrder = [];      // array of player IDs (4)
let captainId = null;
let viceCaptainId = null;

let totalBudget = 100;
let remainingBudget = 100;
let allPlayers = [];
let allClubs = [];
let transferMode = false;
let pendingOutId = null;

const LIMITS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

document.addEventListener('DOMContentLoaded', async function () {
  const token = localStorage.getItem('token');
  if (!token) return (window.location.href = '/login');

  await loadGWStatusLabels();
  await loadClubs();
  await loadPlayers();
  await loadMyTeam();
});

function showAlert(message, type = 'success') {
  const el = document.getElementById('alertContainer');
  el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

// GW status
async function loadGWStatusLabels() {
  try {
    const res = await fetch('/api/teams/status', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const st = await res.json();
    const gwLabel = document.getElementById('activeGWLabel');
    const deadlineLabel = document.getElementById('deadlineLabel');
    const lockBadge = document.getElementById('lockStatus');
    const lockText = document.getElementById('lockStatusLabel');

    if (!st || !st.isActive) {
      gwLabel.textContent = '—';
      deadlineLabel.textContent = '—';
      lockBadge.classList.remove('badge-locked', 'badge-open');
      lockBadge.classList.add('badge-secondary');
      lockText.textContent = 'No active GW';
      return;
    }
    gwLabel.textContent = st.roundLabel || `GW ${st.weekNumber}`;
    if (st.deadline) deadlineLabel.textContent = new Date(st.deadline).toLocaleString();
    if (st.locked) {
      lockBadge.classList.remove('badge-open'); lockBadge.classList.add('badge-locked');
      lockText.textContent = 'Locked';
    } else {
      lockBadge.classList.remove('badge-locked'); lockBadge.classList.add('badge-open');
      lockText.textContent = 'Open';
    }
  } catch (e) {
    // ignore
  }
}

// Clubs & Players
async function loadClubs() {
  const res = await fetch('/api/clubs');
  allClubs = await res.json();

  const cf = document.getElementById('clubFilter');
  const cfo = document.getElementById('clubFilterOC');
  const options = `<option value="">All Clubs</option>` + allClubs.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
  if (cf) cf.innerHTML = options;
  if (cfo) cfo.innerHTML = options;
}

async function loadPlayers() {
  try {
    const res = await fetch('/api/players?sort=price');
    allPlayers = await res.json();
    displayPlayersByPosition(allPlayers);
  } catch (e) {
    console.error('Error loading players:', e);
  }
}

function playerCardHTML(player) {
  const inTeam = selectedPlayers.some(p => p._id === player._id);
  const locked = document.getElementById('lockStatusLabel').textContent === 'Locked';
  const btnLabel = transferMode ? (pendingOutId ? 'Transfer In' : (inTeam ? 'In Squad' : 'Transfer In')) : (inTeam ? 'Selected' : 'Add');
  const btnDisabled = transferMode ? (pendingOutId ? false : inTeam) : inTeam;
  return `
    <div class="player-card" data-player='${JSON.stringify(player)}'>
      <div class="d-flex justify-content-between align-items-center">
        <div class="me-2">
          <div class="fw-semibold">${player.name}</div>
          <div class="text-muted small">${player.club?.name || ''}</div>
        </div>
        <div class="text-end">
          <span class="player-position position-${player.position}">${player.position}</span>
          <div class="fw-bold">${player.price}M</div>
        </div>
      </div>
      <div class="d-flex justify-content-between align-items-center mt-2">
        <small>Pts: ${player.totalPoints || 0}</small>
        <button class="btn btn-sm ${btnDisabled ? 'btn-outline-secondary' : 'btn-outline-primary'}" ${btnDisabled || locked ? 'disabled' : ''} onclick="onPlayerCardAction('${player._id}', event)">${btnLabel}</button>
      </div>
    </div>
  `;
}

function displayPlayersByPosition(players) {
  const positions = ['GK', 'DEF', 'MID', 'FWD'];
  positions.forEach(pos => {
    const container = document.getElementById(`${pos.toLowerCase()}-players`);
    const list = players.filter(p => p.position === pos);
    container.innerHTML = list.map(playerCardHTML).join('');
  });
}

function filterPlayers() {
  const q = document.getElementById('searchInput')?.value?.toLowerCase() || '';
  const qm = document.getElementById('searchInputMobile')?.value?.toLowerCase() || '';
  const qoc = document.getElementById('searchInputOC')?.value?.toLowerCase() || '';
  const query = (q || qm || qoc || '').trim();

  const club = document.getElementById('clubFilter')?.value || document.getElementById('clubFilterOC')?.value || '';
  const sort = document.getElementById('sortFilter')?.value || document.getElementById('sortFilterOC')?.value || 'price';

  let filtered = [...allPlayers];
  if (query) filtered = filtered.filter(p => p.name.toLowerCase().includes(query));
  if (club) filtered = filtered.filter(p => p.club && String(p.club._id) === String(club));

  if (sort === 'price') filtered.sort((a, b) => b.price - a.price);
  else if (sort === 'points') filtered.sort((a, b) => b.totalPoints - a.totalPoints);
  else filtered.sort((a, b) => a.name.localeCompare(b.name));

  displayPlayersByPosition(filtered);
}

// My Team
async function loadMyTeam() {
  try {
    const res = await fetch('/api/teams/my-team', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    if (!res.ok) return;
    const data = await res.json();
    window.myTeam = data.team || [];
    document.getElementById('totalPoints').textContent = data.totalPoints || 0;
    document.getElementById('freeTransfersLabel').textContent = data.freeTransfers ?? '—';
    document.getElementById('transfersGWLabel').textContent = data.transfersMadeThisGW ?? '—';

    if (data.team && data.team.length > 0) {
      // each item: { player: {...}, captain, viceCaptain, starting, benchOrder }
      selectedPlayers = data.team.map(t => t.player);
      captainId = (data.team.find(t => t.captain) || {}).player?._id || null;
      viceCaptainId = (data.team.find(t => t.viceCaptain) || {}).player?._id || null;
    } else {
      selectedPlayers = [];
      captainId = null; viceCaptainId = null;
    }

    // server may provide startingXI/benchOrder metadata; if not, build defaults later
    startingXI = (data.startingXI || []).map(p => (p._id || p));
    benchOrder = (data.benchOrder || []).map(p => (p._id || p));

    updateSquadDisplay();
    updateBudget();
    populateCaptainSelectors();
    buildLineupBuilder();
    displayPlayersByPosition(allPlayers);
  } catch (e) {
    console.error('Error loading team:', e);
  }
}

function populateCaptainSelectors() {
  const capSel = document.getElementById('captainSelect');
  const viceSel = document.getElementById('viceCaptainSelect');
  const options = `<option value="">—</option>` + selectedPlayers.map(p => `<option value="${p._id}" ${String(captainId) === String(p._id) ? 'selected' : ''}>${p.name}</option>`).join('');
  capSel.innerHTML = options;
  viceSel.innerHTML = `<option value="">—</option>` + selectedPlayers.map(p => `<option value="${p._id}" ${String(viceCaptainId) === String(p._id) ? 'selected' : ''}>${p.name}</option>`).join('');
}

function updateSquadDisplay() {
  const formation = document.getElementById('formation-display');
  const pos = {
    GK: selectedPlayers.filter(p => p.position === 'GK'),
    DEF: selectedPlayers.filter(p => p.position === 'DEF'),
    MID: selectedPlayers.filter(p => p.position === 'MID'),
    FWD: selectedPlayers.filter(p => p.position === 'FWD')
  };
  const row = (arr) => `<div class="formation-row">${arr.map(p => createFormationPlayer(p)).join('')}</div>`;
  formation.innerHTML = row(pos.GK) + row(pos.DEF) + row(pos.MID) + row(pos.FWD);

  document.getElementById('gk-count').textContent = pos.GK.length;
  document.getElementById('def-count').textContent = pos.DEF.length;
  document.getElementById('mid-count').textContent = pos.MID.length;
  document.getElementById('fwd-count').textContent = pos.FWD.length;

  document.getElementById('selectedCountLabel').textContent = selectedPlayers.length;
  displayPlayersByPosition(allPlayers);
}

function createFormationPlayer(player) {
  const isCaptain = String(captainId || '') === String(player._id);
  const isVice = String(viceCaptainId || '') === String(player._id);
  const markOut = String(pendingOutId || '') === String(player._id);
  return `
    <div class="formation-player ${isCaptain ? 'captain' : ''} ${markOut ? 'mark-out' : ''}" onclick="onSquadPlayerClick('${player._id}')">
      <small class="d-block">${player.name.split(' ')[0]}</small>
      <small class="text-white-50 d-block">${player.price}M</small>
      ${isCaptain ? '<span class="captain-badge">C</span>' : ''}
      ${isVice ? '<span class="vice-badge">VC</span>' : ''}
    </div>
  `;
}

function updateBudget() {
  const spent = selectedPlayers.reduce((sum, p) => sum + p.price, 0);
  remainingBudget = totalBudget - spent;
  document.getElementById('budget-remaining').textContent = remainingBudget.toFixed(1);
  document.getElementById('budget-spent').textContent = spent.toFixed(1);
  document.querySelector('.budget-fill').style.width = `${(spent / totalBudget) * 100}%`;
}

// Selection/Transfer mode
function toggleTransferMode(checked) {
  transferMode = checked;
  pendingOutId = null;
  updateSquadDisplay();
  displayPlayersByPosition(allPlayers);
}

function onSquadPlayerClick(playerId) {
  // allow marking/unmarking an outgoing player even if transferMode is off
  if (pendingOutId && String(pendingOutId) === String(playerId)) {
    pendingOutId = null;
    updateSquadDisplay();
    displayPlayersByPosition(allPlayers);
    return;
  }
  pendingOutId = playerId;
  // Automatically enable transferMode when marking someone (makes the next click behave as a transfer)
  transferMode = true;
  updateSquadDisplay();
  displayPlayersByPosition(allPlayers);
  showAlert('Player marked OUT — now tap the player you want to transfer IN', 'info');
}

async function onPlayerCardAction(playerId, e) {
  e?.stopPropagation();
  const locked = document.getElementById('lockStatusLabel').textContent === 'Locked';
  if (locked) return;

  const player = allPlayers.find(p => p._id === playerId);
  if (!player) return;

  const inTeam = selectedPlayers.some(p => p._id === playerId);

  if (transferMode) {
    // Transfer flow
    if (!pendingOutId) {
      // If no outgoing selected yet, ask user to mark one (we show an alert and return)
      showAlert('Tap a player in your squad to mark as OUT, then tap the player to transfer IN', 'secondary');
      return;
    }
    // If user accidentally clicked an in-team player as "transfer in", ignore
    if (inTeam) {
      showAlert('Player already in your squad', 'warning');
      return;
    }
    await makeTransfer(pendingOutId, playerId);
    pendingOutId = null;
    transferMode = false;
    return;
  }

  // Normal add/remove flow
  if (inTeam) {
    // remove player from selected squad
    const idx = selectedPlayers.findIndex(p => p._id === playerId);
    if (idx > -1) selectedPlayers.splice(idx, 1);
    // also remove from startingXI / benchOrder if present
    startingXI = startingXI.filter(id => String(id) !== String(playerId));
    benchOrder = benchOrder.filter(id => String(id) !== String(playerId));
    updateSquadDisplay();
    updateBudget();
    populateCaptainSelectors();
    buildLineupBuilder();
    return;
  } else {
    // trying to add a player
    if (selectedPlayers.length >= 15) {
      // team full -> steer user to transfer flow automatically
      transferMode = true;
      pendingOutId = null;
      updateSquadDisplay();
      displayPlayersByPosition(allPlayers);
      showAlert('Squad is full. Tap a player in your squad to mark as OUT, then tap the player you want to add (Transfer Mode enabled).', 'warning');
      return;
    }

    // Add normally
    const limits = LIMITS;
    const count = {
      GK: selectedPlayers.filter(p => p.position === 'GK').length,
      DEF: selectedPlayers.filter(p => p.position === 'DEF').length,
      MID: selectedPlayers.filter(p => p.position === 'MID').length,
      FWD: selectedPlayers.filter(p => p.position === 'FWD').length
    };
    if (count[player.position] >= limits[player.position]) return showAlert(`Max ${limits[player.position]} ${player.position}s`, 'warning');
    if (selectedPlayers.length >= 15) return showAlert('You can only select 15 players', 'warning');

    const totalCost = selectedPlayers.reduce((sum, p) => sum + p.price, 0) + player.price;
    if (totalCost > totalBudget) return showAlert('Not enough budget!', 'warning');

    selectedPlayers.push(player);
    updateSquadDisplay();
    updateBudget();
    populateCaptainSelectors();
    buildLineupBuilder();
  }
}

async function makeTransfer(outId, inId) {
  try {
    const res = await fetch('/api/teams/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ outPlayerId: outId, inPlayerId: inId })
    });
    const data = await res.json();
    if (!res.ok) return showAlert(data.error || 'Transfer failed', 'danger');

    // Refresh local team from server (keeps consistency)
    await loadMyTeam();

    document.getElementById('freeTransfersLabel').textContent = data.freeTransfers ?? document.getElementById('freeTransfersLabel').textContent;
    document.getElementById('transfersGWLabel').textContent = data.transfersMadeThisGW ?? document.getElementById('transfersGWLabel').textContent;
    showAlert(data.message || 'Transfer completed', 'success');
    updateBudget();
    updateSquadDisplay();
    populateCaptainSelectors();
    buildLineupBuilder();
  } catch (e) {
    showAlert('Transfer error', 'danger');
  }
}

// Save endpoints
async function saveTeam() {
  if (selectedPlayers.length !== 15) return showAlert('You must select exactly 15 players', 'warning');

  const payload = selectedPlayers.map(p => ({ player: p._id, captain: String(p._id) === String(captainId), viceCaptain: String(p._id) === String(viceCaptainId) }));
  const res = await fetch('/api/teams/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ team: payload })
  });
  const data = await res.json();
  if (!res.ok) return showAlert(data.error || 'Failed to save team', 'danger');
  showAlert('Team saved successfully!');
}

async function clearTeam() {
  const res = await fetch('/api/teams/clear', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) return showAlert(data.error || 'Failed to clear', 'danger');
  selectedPlayers = [];
  startingXI = [];
  benchOrder = [];
  captainId = null; viceCaptainId = null;
  updateSquadDisplay(); updateBudget(); populateCaptainSelectors(); buildLineupBuilder();
  showAlert('Team cleared', 'secondary');
}

async function saveLineup() {
  if (startingXI.length !== 11 || benchOrder.length !== 4) return showAlert('Starting XI must be 11 and bench 4 players', 'warning');
  const res = await fetch('/api/teams/lineup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ starters: startingXI, benchOrder })
  });
  const data = await res.json();
  if (!res.ok) return showAlert(data.error || 'Failed to save lineup', 'danger');
  showAlert('Lineup saved');
}

async function saveCaptains() {
  const c = document.getElementById('captainSelect').value || null;
  const v = document.getElementById('viceCaptainSelect').value || null;
  if (!c || !v) return showAlert('Select both Captain and Vice-Captain', 'warning');
  if (c === v) return showAlert('Captain and Vice must be different', 'warning');

  const res = await fetch('/api/teams/captains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ captainId: c, viceCaptainId: v })
  });
  const data = await res.json();
  if (!res.ok) return showAlert(data.error || 'Failed to save captains', 'danger');
  captainId = c; viceCaptainId = v;
  updateSquadDisplay();
  showAlert('Captains saved');
}

// Lineup builder (simple toggles)
function buildLineupBuilder() {
  const wrap = document.getElementById('lineup-builder');
  if (!selectedPlayers.length) { wrap.innerHTML = `<div class="text-muted">Add players to your squad first.</div>`; return; }

  // Ensure arrays consistent
  const ids = selectedPlayers.map(p => p._id);
  startingXI = startingXI.filter(id => ids.includes(id));
  benchOrder = benchOrder.filter(id => ids.includes(id));
  const unused = ids.filter(id => !startingXI.includes(id) && !benchOrder.includes(id));
  // Autofill if empty
  while (startingXI.length < 11 && unused.length) startingXI.push(unused.shift());
  while (benchOrder.length < 4 && unused.length) benchOrder.push(unused.shift());

  // If bench is full and a starter is moved to bench, we'll swap
  const startersHTML = startingXI.map(id => {
    const p = selectedPlayers.find(x => x._id === id);
    return `<div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div class="small"><strong>${p?.name || ''}</strong> <span class="badge bg-secondary">${p?.position || ''}</span></div>
      <button class="btn btn-sm btn-outline-warning" onclick="moveToBench('${id}')">To Bench</button>
    </div>`;
  }).join('');

  const benchHTML = benchOrder.map((id, i) => {
    const p = selectedPlayers.find(x => x._id === id);
    return `<div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div class="small"><strong>${p?.name || ''}</strong> <span class="badge bg-secondary">${p?.position || ''}</span></div>
      <div class="d-flex align-items-center gap-2">
        <select class="form-select form-select-sm bench-select" onchange="benchRankChange('${id}', this.value)">
          ${[1,2,3,4].map(n => `<option value="${n}" ${i+1===n?'selected':''}>${n}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-outline-success" onclick="moveToStarters('${id}')">To XI</button>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="row g-2">
      <div class="col-md-6">
        <h6>Starting XI (${startingXI.length}/11)</h6>
        <div>${startersHTML || '<div class="text-muted small">Select XI players.</div>'}</div>
      </div>
      <div class="col-md-6">
        <h6>Bench (${benchOrder.length}/4)</h6>
        <div>${benchHTML || '<div class="text-muted small">Select 4 bench players.</div>'}</div>
      </div>
    </div>
  `;
}

function moveToBench(id) {
  const idx = startingXI.indexOf(id);
  if (idx === -1) return;
  if (benchOrder.length < 4) {
    startingXI.splice(idx, 1);
    benchOrder.push(id);
  } else {
    // bench full -> swap with first bench (FIFO)
    const replacedBenchId = benchOrder.shift(); // remove first bench
    // replace starter in XI with replacedBenchId
    startingXI[idx] = replacedBenchId;
    // add old starter to end of bench
    benchOrder.push(id);
  }
  buildLineupBuilder();
}

function moveToStarters(id) {
  const idx = benchOrder.indexOf(id);
  if (idx === -1) return;
  if (startingXI.length < 11) {
    benchOrder.splice(idx, 1);
    startingXI.push(id);
  } else {
    // starters full -> swap with last starter (FIFO-like)
    const replacedStarterId = startingXI.pop(); // remove last starter
    // put bench player into starters
    startingXI.push(id);
    // replace bench slot with the removed starter (preserve bench length)
    benchOrder[idx] = replacedStarterId;
  }
  buildLineupBuilder();
}

function benchRankChange(id, val) {
  const idx = benchOrder.indexOf(id);
  const to = parseInt(val, 10) - 1;
  if (idx === -1 || to < 0 || to > 3) return;
  const [it] = benchOrder.splice(idx, 1);
  benchOrder.splice(to, 0, it);
  buildLineupBuilder();
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

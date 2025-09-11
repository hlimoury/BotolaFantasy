// public/js/dashboard.js

// Global state
let selectedPlayers = []; // [{...playerDoc, slotPosition: 'START'|'BENCH', slotIndex: number}]
let currentPosition = null;
let currentSlotIndex = null;
let allPlayers = [];
let allClubs = [];
let captainId = null;
let viceCaptainId = null;
const totalBudget = 100;
let freeTransfers = 1;
let teamCreated = false;
let transferMode = false;
let transferOutPlayer = null;

// Active GW live points
let gwWeekNumber = null;
let gwPointsMap = {}; // { playerId: pointsInActiveGW }
let gwTeamTotal = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  try {
    // IMPORTANT: load players first, then derive clubs from them
    await loadPlayers();
    await loadClubs();
    await loadUserTeam();
    await loadActiveGWPoints();
  } catch (e) {
    console.error(e);
  }

  setupEventListeners();
  updateUI();
});

function setupEventListeners() {
  const searchInput = document.getElementById('searchPlayer');
  const clubFilter = document.getElementById('clubFilter');
  const sortBy = document.getElementById('sortBy');
  if (searchInput) searchInput.addEventListener('input', filterPlayersInModal);
  if (clubFilter) clubFilter.addEventListener('change', filterPlayersInModal);
  if (sortBy) sortBy.addEventListener('change', filterPlayersInModal);
}

async function loadPlayers() {
  try {
    const res = await fetch('/api/players');
    allPlayers = await res.json();
  } catch (e) {
    console.error('Error loading players:', e);
  }
}

async function loadClubs() {
  try {
    // derive clubs from allPlayers (ensures only clubs with players show)
    const map = new Map();
    for (const p of allPlayers) {
      const c = p.club;
      if (c && c._id && !map.has(String(c._id))) {
        map.set(String(c._id), { _id: String(c._id), name: c.name, shortName: c.shortName });
      }
    }
    allClubs = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    const clubFilter = document.getElementById('clubFilter');
    if (clubFilter) {
      clubFilter.innerHTML =
        '<option value="">All Clubs</option>' +
        allClubs.map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('');
    }
  } catch (error) {
    console.error('Error loading clubs:', error);
  }
}

async function loadUserTeam() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/teams/my-team', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return;
    const data = await response.json();

    freeTransfers = Number(data.freeTransfers ?? 1);
    const budgetBank = Number(data.budget ?? 100);
    setText('freeTransfers', freeTransfers.toString());
    setText('budgetRemaining', `${budgetBank.toFixed(1)}M`);

    const teamArr = Array.isArray(data.team) ? data.team : [];
    teamCreated = teamArr.length === 15;

    // Captain/VC from saved squad
    const capSlot = teamArr.find(t => t.captain);
    const vcSlot = teamArr.find(t => t.viceCaptain);
    captainId = capSlot?.player?._id ? String(capSlot.player._id) : null;
    viceCaptainId = vcSlot?.player?._id ? String(vcSlot.player._id) : null;

    // Build a map from id -> populated player doc from team
    const teamMap = new Map();
    for (const s of teamArr) {
      const p = s.player;
      if (p && p._id) teamMap.set(String(p._id), p);
    }
    const getDoc = (id) =>
      teamMap.get(String(id)) ||
      allPlayers.find(ap => String(ap._id) === String(id));

    // Prepare selectedPlayers
    selectedPlayers = [];

    // Try to place using saved lineup (startingXI + benchOrder)
    const startingXI = Array.isArray(data.startingXI) ? data.startingXI : [];
    const benchOrder = Array.isArray(data.benchOrder) ? data.benchOrder : [];

    const xiDocs = startingXI
      .map(x => (x && x._id ? x._id : x))
      .map(id => getDoc(id))
      .filter(Boolean);

    const benchDocs = benchOrder
      .map(x => (x && x._id ? x._id : x))
      .map(id => getDoc(id))
      .filter(Boolean);

    if (xiDocs.length === 11) {
      // Arrange into fixed UI: GK(0), DEF(1-4), MID(5-8), FWD(9-10)
      const byPos = {
        GK: xiDocs.filter(p => p.position === 'GK'),
        DEF: xiDocs.filter(p => p.position === 'DEF'),
        MID: xiDocs.filter(p => p.position === 'MID'),
        FWD: xiDocs.filter(p => p.position === 'FWD')
      };

      // GK slot 0
      if (byPos.GK[0]) place(byPos.GK[0], 'START', 0);

      // DEF 1..4
      for (let i = 0; i < 4; i++) {
        if (byPos.DEF[i]) place(byPos.DEF[i], 'START', 1 + i);
      }
      // MID 5..8
      for (let i = 0; i < 4; i++) {
        if (byPos.MID[i]) place(byPos.MID[i], 'START', 5 + i);
      }
      // FWD 9..10
      for (let i = 0; i < 2; i++) {
        if (byPos.FWD[i]) place(byPos.FWD[i], 'START', 9 + i);
      }

      // Fill any empty START slots from remaining xiDocs
      const takenIds = new Set(selectedPlayers.filter(p => p.slotPosition === 'START').map(p => String(p._id)));
      const remaining = xiDocs.filter(p => !takenIds.has(String(p._id)));

      const emptyStartSlots = [
        { idx: 0, pos: 'GK' },
        { idx: 1, pos: 'DEF' }, { idx: 2, pos: 'DEF' }, { idx: 3, pos: 'DEF' }, { idx: 4, pos: 'DEF' },
        { idx: 5, pos: 'MID' }, { idx: 6, pos: 'MID' }, { idx: 7, pos: 'MID' }, { idx: 8, pos: 'MID' },
        { idx: 9, pos: 'FWD' }, { idx: 10, pos: 'FWD' }
      ];
      for (const slot of emptyStartSlots) {
        if (!selectedPlayers.find(p => p.slotPosition === 'START' && p.slotIndex === slot.idx)) {
          const rep = remaining.find(p => p.position === slot.pos) || remaining.shift();
          if (rep) place(rep, 'START', slot.idx);
        }
      }

      // Bench: enforce GK at 0; then outfield 1: DEF, 2: MID, 3: FWD if available
      if (benchDocs.length) {
        const benchGK = benchDocs.find(p => p.position === 'GK');
        if (benchGK) place(benchGK, 'BENCH', 0);
        const benchDEF = benchDocs.find(p => p.position === 'DEF');
        const benchMID = benchDocs.find(p => p.position === 'MID');
        const benchFWD = benchDocs.find(p => p.position === 'FWD');
        if (benchDEF) place(benchDEF, 'BENCH', 1);
        if (benchMID) place(benchMID, 'BENCH', 2);
        if (benchFWD) place(benchFWD, 'BENCH', 3);
      }

      // Fill any missing bench slots from the rest of team not in XI
      const startIds = new Set(selectedPlayers.filter(p => p.slotPosition === 'START').map(p => String(p._id)));
      const currentBenchIds = new Set(selectedPlayers.filter(p => p.slotPosition === 'BENCH').map(p => String(p._id)));
      const notInXI = teamArr.map(s => s.player).filter(p => !startIds.has(String(p._id)));
      // ensure GK bench slot 0 is GK
      if (!selectedPlayers.find(p => p.slotPosition === 'BENCH' && p.slotIndex === 0)) {
        const gk = notInXI.find(p => p.position === 'GK' && !currentBenchIds.has(String(p._id)));
        if (gk) place(gk, 'BENCH', 0);
      }
      // Fill DEF/MID/FWD if empty
      if (!selectedPlayers.find(p => p.slotPosition === 'BENCH' && p.slotIndex === 1)) {
        const def = notInXI.find(p => p.position === 'DEF' && !currentBenchIds.has(String(p._id)));
        if (def) place(def, 'BENCH', 1);
      }
      if (!selectedPlayers.find(p => p.slotPosition === 'BENCH' && p.slotIndex === 2)) {
        const mid = notInXI.find(p => p.position === 'MID' && !currentBenchIds.has(String(p._id)));
        if (mid) place(mid, 'BENCH', 2);
      }
      if (!selectedPlayers.find(p => p.slotPosition === 'BENCH' && p.slotIndex === 3)) {
        const fwd = notInXI.find(p => p.position === 'FWD' && !currentBenchIds.has(String(p._id)));
        if (fwd) place(fwd, 'BENCH', 3);
      }
    } else {
      // Fallback simple placement using team
      const teamPlayers = teamArr.map(item => item.player);
      const gks = teamPlayers.filter(p => p.position === 'GK');
      if (gks[0]) place(gks[0], 'START', 0);

      let idx = 1;
      teamPlayers.filter(p => p.position === 'DEF').slice(0, 4).forEach(p => place(p, 'START', idx++));
      idx = 5;
      teamPlayers.filter(p => p.position === 'MID').slice(0, 4).forEach(p => place(p, 'START', idx++));
      idx = 9;
      teamPlayers.filter(p => p.position === 'FWD').slice(0, 2).forEach(p => place(p, 'START', idx++));
      // Bench: GK then DEF, MID, FWD if available
      if (gks[1]) place(gks[1], 'BENCH', 0);
      const defRem = teamPlayers.filter(p => p.position === 'DEF').slice(4);
      const midRem = teamPlayers.filter(p => p.position === 'MID').slice(4);
      const fwdRem = teamPlayers.filter(p => p.position === 'FWD').slice(2);
      if (defRem[0]) place(defRem[0], 'BENCH', 1);
      if (midRem[0]) place(midRem[0], 'BENCH', 2);
      if (fwdRem[0]) place(fwdRem[0], 'BENCH', 3);
    }

    updateTeamDisplay();
    updateUI();
  } catch (e) {
    console.error('Error loading team:', e);
  }
}

function place(playerDoc, slotPosition, slotIndex) {
  const id = String(playerDoc._id);
  // Try to replace existing slot if any
  const idx = selectedPlayers.findIndex(p => p.slotPosition === slotPosition && p.slotIndex === slotIndex);
  const full = allPlayers.find(p => String(p._id) === id) || playerDoc;
  if (idx >= 0) {
    selectedPlayers[idx] = { ...full, _id: id, slotPosition, slotIndex };
  } else {
    selectedPlayers.push({ ...full, _id: id, slotPosition, slotIndex });
  }
}

async function loadActiveGWPoints() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/teams/gw-points', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      gwWeekNumber = null;
      gwPointsMap = {};
      gwTeamTotal = 0;
      updateTeamDisplay();
      updateUI();
      return;
    }
    const data = await res.json();
    gwWeekNumber = data.weekNumber;
    gwPointsMap = data.perPlayer || {};
    gwTeamTotal = Number(data.teamTotal || 0);

    // Update GW points + status
    setText('totalPoints', gwTeamTotal.toString());
    const gwStatusEl = document.getElementById('gwStatus');
    if (gwStatusEl) {
      const locked = !!data.locked;
      const badge = locked ? '<span class="badge bg-secondary">Locked</span>' : '<span class="badge bg-success">Open</span>';
      gwStatusEl.innerHTML = `${badge}${gwWeekNumber ? ` <small class="ms-1">GW ${gwWeekNumber}</small>` : ''}`;
    }

    updateTeamDisplay();
  } catch (e) {
    console.error('Error loading active GW points:', e);
  }
}

// Selection flow
function selectPosition(position, index) {
  currentPosition = position; // 'START'|'BENCH'
  currentSlotIndex = index;

  const existingPlayer = selectedPlayers.find(p => p.slotPosition === position && p.slotIndex === index);

  // If team is already created and not in transfer mode, block removal/replacement
  if (teamCreated && existingPlayer && !transferMode) {
    alert('Enable Transfer Mode to replace players.');
    return;
  }

  // In transfer mode: clicking a filled slot starts transfer out
  if (transferMode && existingPlayer) {
    transferOutPlayer = existingPlayer;
    openPlayerModal(existingPlayer.position); // restrict to same position to keep limits
    return;
  }

  // Initial creation or empty slot
  let positionFilter = null;
  if (position === 'START') {
    if (index === 0) positionFilter = 'GK';
    else if (index >= 1 && index <= 4) positionFilter = 'DEF';
    else if (index >= 5 && index <= 8) positionFilter = 'MID';
    else if (index >= 9 && index <= 10) positionFilter = 'FWD';
  } else if (position === 'BENCH') {
    if (index === 0) positionFilter = 'GK'; // bench GK
    else positionFilter = null; // any outfield, filter out GK below
  }
  openPlayerModal(positionFilter);
}

function openPlayerModal(positionFilter) {
  const modal = document.getElementById('playerModal');
  const modalPosition = document.getElementById('modalPosition');
  modalPosition.textContent = positionFilter ? positionFilter : (currentPosition === 'BENCH' && currentSlotIndex > 0 ? 'Outfield' : 'Any');

  // Base list based on slot constraints
  let list = allPlayers.slice();
  if (positionFilter) {
    list = list.filter(p => p.position === positionFilter);
  } else if (currentPosition === 'BENCH' && currentSlotIndex > 0) {
    list = list.filter(p => p.position !== 'GK');
  }
  // If transferring, restrict to same position as transferOutPlayer
  if (transferMode && transferOutPlayer) {
    list = list.filter(p => p.position === transferOutPlayer.position);
  }

  // Exclude already selected players (except transfer out player)
  const selectedIds = new Set(selectedPlayers.map(p => String(p._id)));
  if (transferOutPlayer) selectedIds.delete(String(transferOutPlayer._id));
  list = list.filter(p => !selectedIds.has(String(p._id)));

  setClubFilterOptions(list);
  displayPlayersInModal(list);
  modal.classList.add('active');
}

function setClubFilterOptions(players) {
  const clubFilter = document.getElementById('clubFilter');
  if (!clubFilter) return;
  const clubIds = Array.from(new Set(players.map(p => p.club?._id).filter(Boolean)));
  const clubs = allClubs.filter(c => clubIds.includes(String(c._id)));
  clubFilter.innerHTML = '<option value="">All Clubs</option>' + clubs.map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('');
}

function displayPlayersInModal(players) {
  const playersList = document.getElementById('playersList');
  const searchTerm = (document.getElementById('searchPlayer').value || '').toLowerCase();
  const clubId = document.getElementById('clubFilter').value;
  const sortBy = document.getElementById('sortBy').value;

  let filtered = players.slice();
  if (searchTerm) filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
  if (clubId) filtered = filtered.filter(p => p.club?._id === clubId);

  if (sortBy === 'price') filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  else if (sortBy === 'points') filtered.sort((a, b) => Number(b.totalPoints || 0) - Number(a.totalPoints || 0));
  else filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  playersList.innerHTML = filtered.map(player => `
    <div class="player-item" onclick="selectPlayer('${player._id}')">
      <div class="player-item-info">
        <div class="player-item-name">${escapeHtml(player.name)}</div>
        <div class="player-item-details">${escapeHtml(player.club?.name || 'No Club')} • ${player.position}</div>
      </div>
      <div class="player-item-stats">
        <div class="player-item-price">${Number(player.price || 0)}M</div>
        <div class="player-item-points">${Number(player.totalPoints || 0)} pts</div>
      </div>
    </div>
  `).join('');
}

function filterPlayersInModal() {
  const modal = document.getElementById('playerModal');
  if (!modal.classList.contains('active')) return;
  // Recompute list with current constraints
  openPlayerModal(null);
}

async function selectPlayer(playerId) {
  const player = allPlayers.find(p => String(p._id) === String(playerId));
  if (!player) return;

  // Transfer flow if team already created
  if (teamCreated && transferMode && transferOutPlayer) {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/teams/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ outPlayerId: transferOutPlayer._id, inPlayerId: player._id })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Transfer failed');

      // Replace player in same slot locally
      const idx = selectedPlayers.findIndex(p => p.slotPosition === transferOutPlayer.slotPosition && p.slotIndex === transferOutPlayer.slotIndex);
      if (idx >= 0) {
        selectedPlayers[idx] = { ...player, _id: String(player._id), slotPosition: transferOutPlayer.slotPosition, slotIndex: transferOutPlayer.slotIndex };
      }
      // Update budget and freeTransfers
      setText('budgetRemaining', `${Number(data.budget ?? 0).toFixed(1)}M`);
      freeTransfers = Number(data.freeTransfers ?? freeTransfers);
      setText('freeTransfers', freeTransfers.toString());

      transferOutPlayer = null;
      closePlayerModal();
      updateTeamDisplay();
      updateUI();
      await loadActiveGWPoints(); // refresh live GW totals after transfer
      return;
    } catch (e) {
      console.error('Transfer error:', e);
      alert('Transfer failed');
      return;
    }
  }

  // Initial creation: normal add/replace with budget checks
  const existingAtSlot = selectedPlayers.find(p => p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex);
  // Budget check (including removal of existing slot cost)
  const spent = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0) - (existingAtSlot ? Number(existingAtSlot.price || 0) : 0);
  if (spent + Number(player.price || 0) > totalBudget) {
    alert('Not enough budget!');
    return;
  }

  // Bench constraints
  if (currentPosition === 'BENCH') {
    if (currentSlotIndex === 0 && player.position !== 'GK') {
      alert('Bench slot 0 must be a GK');
      return;
    }
    if (currentSlotIndex > 0 && player.position === 'GK') {
      alert('Bench outfield slots cannot be GK');
      return;
    }
  }
  // Starter slot strict position
  if (currentPosition === 'START') {
    if (currentSlotIndex === 0 && player.position !== 'GK') return alert('This slot is GK only');
    if (currentSlotIndex >= 1 && currentSlotIndex <= 4 && player.position !== 'DEF') return alert('This slot is DEF only');
    if (currentSlotIndex >= 5 && currentSlotIndex <= 8 && player.position !== 'MID') return alert('This slot is MID only');
    if (currentSlotIndex >= 9 && currentSlotIndex <= 10 && player.position !== 'FWD') return alert('This slot is FWD only');
  }

  // Prevent duplicates
  if (selectedPlayers.some(p => String(p._id) === String(player._id)) && !(existingAtSlot && String(existingAtSlot._id) === String(player._id))) {
    alert('Player already in squad');
    return;
  }

  // Replace in slot
  if (existingAtSlot) {
    const idx = selectedPlayers.findIndex(p => p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex);
    selectedPlayers.splice(idx, 1);
    if (String(existingAtSlot._id) === String(captainId)) captainId = null;
    if (String(existingAtSlot._id) === String(viceCaptainId)) viceCaptainId = null;
  }
  selectedPlayers.push({ ...player, _id: String(player._id), slotPosition: currentPosition, slotIndex: currentSlotIndex });

  closePlayerModal();
  updateTeamDisplay();
  updateUI();
}

function closePlayerModal() {
  const modal = document.getElementById('playerModal');
  modal.classList.remove('active');
  currentPosition = null;
  currentSlotIndex = null;
}

// Display
function updateTeamDisplay() {
  document.querySelectorAll('.position-slot').forEach(slot => {
    const pos = slot.dataset.position; // 'START' or 'BENCH'
    const idx = parseInt(slot.dataset.index, 10);
    const player = selectedPlayers.find(p => p.slotPosition === pos && p.slotIndex === idx);

    slot.classList.toggle('filled', !!player);
    if (player) {
      const pid = String(player._id);
      const gwPts = Number(gwPointsMap[pid] || 0);
      const isC = pid === String(captainId);
      const isVC = pid === String(viceCaptainId);
      slot.innerHTML = `
        <span class="position-label">${pos === 'BENCH' ? (idx === 0 ? 'GK' : 'SUB') : player.position}</span>
        ${isC ? '<span class="captain-badge">C</span>' : ''}
        ${isVC ? '<span class="vice-badge">VC</span>' : ''}
        <div class="player-info">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-club">${escapeHtml(player.club?.shortName || player.club?.name || '')}</div>
          <div class="player-points">${gwWeekNumber ? `GW${gwWeekNumber}: ${gwPts} pts` : `${gwPts} pts`}</div>
          <div class="player-price">${Number(player.price || 0)}M</div>
        </div>
      `;
    } else {
      let label = '';
      if (pos === 'START') {
        if (idx === 0) label = 'GK';
        else if (idx >= 1 && idx <= 4) label = 'DEF';
        else if (idx >= 5 && idx <= 8) label = 'MID';
        else if (idx >= 9 && idx <= 10) label = 'FWD';
      } else {
        label = (idx === 0 ? 'GK' : 'OUT');
      }
      slot.innerHTML = `
        <span class="position-label">${label}</span>
        <i class="bi bi-plus-circle add-icon"></i>
      `;
    }
  });

  // Update live team points (Active GW)
  if (typeof gwTeamTotal === 'number' && !Number.isNaN(gwTeamTotal)) {
    setText('totalPoints', gwTeamTotal.toString());
  }
}

function updateUI() {
  const count = selectedPlayers.length;
  setText('selectedCount', `${count}/15`);

  const spent = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0);
  const budgetRemaining = totalBudget - spent;
  setText('budgetRemaining', `${budgetRemaining.toFixed(1)}M`);
  setText('freeTransfers', Number(freeTransfers).toString());

  // Squad value bar
  setText('squadValue', `${spent.toFixed(1)}M`);
  const usedPercent = Math.max(0, Math.min(100, (spent / totalBudget) * 100));
  setText('budgetPercent', `${usedPercent.toFixed(0)}%`);
  const fill = document.getElementById('valueFill');
  if (fill) fill.style.width = `${usedPercent}%`;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toggleTransferMode(checked) {
  transferMode = checked;
  transferOutPlayer = null;
}

// Save Team (creates/updates full 15-man squad; no free transfer deduction here)
async function saveTeam() {
  if (selectedPlayers.length !== 15) {
    alert('You must select exactly 15 players (11 starters + 4 bench)');
    return;
  }
  // Require C/VC
  if (!captainId || !viceCaptainId) {
    alert('Please set Captain and Vice-Captain.');
    return;
  }

  const token = localStorage.getItem('token');
  try {
    // Build team payload (15 players)
    const idsSet = new Set();
    const teamIds = [];
    // Order: XI by slots then bench by slots
    const xiOrder = selectedPlayers.filter(p => p.slotPosition === 'START').sort((a, b) => a.slotIndex - b.slotIndex);
    const benchOrder = selectedPlayers.filter(p => p.slotPosition === 'BENCH').sort((a, b) => a.slotIndex - b.slotIndex);
    for (const p of [...xiOrder, ...benchOrder]) {
      if (!idsSet.has(String(p._id))) {
        teamIds.push(String(p._id));
        idsSet.add(String(p._id));
      }
    }
    if (teamIds.length !== 15) {
      alert('Lineup must contain exactly your 15 players once.');
      return;
    }

    const team = teamIds.map(id => ({
      player: id,
      captain: String(id) === String(captainId),
      viceCaptain: String(id) === String(viceCaptainId)
    }));

    // Save 15-man squad
    let res = await fetch('/api/teams/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ team })
    });
    let data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to save team');

    // Save lineup (XI + bench order)
    const xiIds = xiOrder.map(p => p._id);
    const benchIds = benchOrder.map(p => p._id);
    res = await fetch('/api/teams/lineup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ startingXI: xiIds, benchOrder: benchIds })
    });
    data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to save lineup');

    teamCreated = true;
    alert('Team saved successfully!');
    await loadActiveGWPoints(); // refresh live GW totals
  } catch (e) {
    console.error('Error saving team:', e);
    alert('Error saving team');
  }
}

// Save lineup only (button action)
async function saveLineup() {
  if (selectedPlayers.length !== 15) {
    alert('You must select exactly 15 players first');
    return;
  }

  const starters = selectedPlayers.filter(p => p.slotPosition === 'START');
  const bench = selectedPlayers.filter(p => p.slotPosition === 'BENCH');

  if (starters.length !== 11) {
    alert('Starting XI must have exactly 11 players');
    return;
  }
  if (bench.length !== 4) {
    alert('Bench must have exactly 4 players');
    return;
  }

  try {
    const token = localStorage.getItem('token');
    const sortedStarters = starters.sort((a, b) => a.slotIndex - b.slotIndex);
    const sortedBench = bench.sort((a, b) => a.slotIndex - b.slotIndex);
    const startingXI = sortedStarters.map(p => p._id);
    const benchOrder = sortedBench.map(p => p._id);

    const response = await fetch('/api/teams/lineup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ startingXI, benchOrder })
    });

    if (response.ok) {
      alert('Lineup saved successfully!');
      await loadActiveGWPoints(); // Refresh live points
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save lineup');
    }
  } catch (error) {
    console.error('Error saving lineup:', error);
    alert('Error saving lineup');
  }
}

// Ensure team is saved before saving captains (used by modal flow)
async function ensureTeamSaved() {
  if (teamCreated) return true;

  if (selectedPlayers.length !== 15) {
    alert('Please complete your squad to 15 players before setting captains.');
    return false;
  }

  // Build and save team + lineup
  const xiOrder = selectedPlayers.filter(p => p.slotPosition === 'START').sort((a, b) => a.slotIndex - b.slotIndex);
  const benchOrder = selectedPlayers.filter(p => p.slotPosition === 'BENCH').sort((a, b) => a.slotIndex - b.slotIndex);
  const idsSet = new Set();
  const teamIds = [];
  for (const p of [...xiOrder, ...benchOrder]) {
    if (!idsSet.has(String(p._id))) {
      teamIds.push(String(p._id));
      idsSet.add(String(p._id));
    }
  }
  if (teamIds.length !== 15) {
    alert('Lineup must contain exactly your 15 players once.');
    return false;
  }

  const team = teamIds.map(id => ({
    player: id,
    captain: String(id) === String(captainId),
    viceCaptain: String(id) === String(viceCaptainId)
  }));

  const token = localStorage.getItem('token');
  // Save squad
  let res = await fetch('/api/teams/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ team })
  });
  let data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to save team');
    return false;
  }

  // Save lineup
  const xiIds = xiOrder.map(p => p._id);
  const benchIds = benchOrder.map(p => p._id);
  res = await fetch('/api/teams/lineup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ startingXI: xiIds, benchOrder: benchIds })
  });
  data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to save lineup');
    return false;
  }

  teamCreated = true;
  return true;
}

// Auto-Complete: fill exact formation and bench (GK, DEF, MID, FWD) within budget
async function autoComplete() {
  // Build remaining slots
  const desiredStart = [
    { pos: 'GK', slotPosition: 'START', slotIndex: 0 },
    { pos: 'DEF', slotPosition: 'START', slotIndex: 1 },
    { pos: 'DEF', slotPosition: 'START', slotIndex: 2 },
    { pos: 'DEF', slotPosition: 'START', slotIndex: 3 },
    { pos: 'DEF', slotPosition: 'START', slotIndex: 4 },
    { pos: 'MID', slotPosition: 'START', slotIndex: 5 },
    { pos: 'MID', slotPosition: 'START', slotIndex: 6 },
    { pos: 'MID', slotPosition: 'START', slotIndex: 7 },
    { pos: 'MID', slotPosition: 'START', slotIndex: 8 },
    { pos: 'FWD', slotPosition: 'START', slotIndex: 9 },
    { pos: 'FWD', slotPosition: 'START', slotIndex: 10 }
  ];
  const desiredBench = [
    { pos: 'GK', slotPosition: 'BENCH', slotIndex: 0 },
    { pos: 'DEF', slotPosition: 'BENCH', slotIndex: 1 },
    { pos: 'MID', slotPosition: 'BENCH', slotIndex: 2 },
    { pos: 'FWD', slotPosition: 'BENCH', slotIndex: 3 }
  ];

  // Compute remaining budget
  const currentSpend = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0);
  let remainingBudget = totalBudget - currentSpend;

  // Helper: current selected ids
  const selectedIds = new Set(selectedPlayers.map(p => String(p._id)));

  // Candidates per position sorted by cheapest first (tie-break by higher points)
  const byPos = {
    GK: allPlayers.filter(p => p.position === 'GK').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
    DEF: allPlayers.filter(p => p.position === 'DEF').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
    MID: allPlayers.filter(p => p.position === 'MID').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
    FWD: allPlayers.filter(p => p.position === 'FWD').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
  };

  // Helper: try to fill a single slot
  const fillSlot = (slot) => {
    if (selectedPlayers.find(p => p.slotPosition === slot.slotPosition && p.slotIndex === slot.slotIndex)) return true;
    const list = byPos[slot.pos];
    for (const cand of list) {
      const id = String(cand._id);
      if (selectedIds.has(id)) continue;
      if (slot.slotPosition === 'BENCH' && slot.slotIndex > 0 && cand.position === 'GK') continue;
      const price = Number(cand.price || 0);
      if (price <= remainingBudget) {
        selectedPlayers.push({ ...cand, _id: id, slotPosition: slot.slotPosition, slotIndex: slot.slotIndex });
        selectedIds.add(id);
        remainingBudget -= price;
        return true;
      }
    }
    return false;
  };

  // Fill starters
  for (const slot of desiredStart) {
    if (!fillSlot(slot)) {
      alert(`Auto-complete failed: not enough budget or ${slot.pos}s available for starters.`);
      updateTeamDisplay(); updateUI();
      return;
    }
  }

  // Fill bench exactly (GK, DEF, MID, FWD)
  for (const slot of desiredBench) {
    if (!fillSlot(slot)) {
      alert(`Auto-complete failed: not enough budget or ${slot.pos}s available for bench.`);
      updateTeamDisplay(); updateUI();
      return;
    }
  }

  // Auto-assign captain and vice-captain if not set
  if (!captainId || !viceCaptainId) {
    const starters = selectedPlayers.filter(p => p.slotPosition === 'START');
    const sortedStarters = starters.sort((a, b) => (Number(b.totalPoints) || 0) - (Number(a.totalPoints) || 0));
    if (!captainId && sortedStarters[0]) captainId = String(sortedStarters[0]._id);
    if (!viceCaptainId && sortedStarters[1]) {
      const vc = sortedStarters.find(p => String(p._id) !== String(captainId));
      if (vc) viceCaptainId = String(vc._id);
    }
  }

  updateTeamDisplay();
  updateUI();
  alert('Team auto-completed successfully!');
}

// Old captains save (prompt flow) retained for compatibility
function openCaptainsModal() {
  if (selectedPlayers.length < 11) {
    alert('Select your starting XI first.');
    return;
  }
  const starters = selectedPlayers.filter(p => p.slotPosition === 'START');
  const cName = prompt('Enter Captain name (must be in starting XI):');
  if (!cName) return;
  const cap = starters.find(p => p.name.toLowerCase().includes(cName.toLowerCase()));
  if (!cap) return alert('Captain not found in starters');
  const vcName = prompt('Enter Vice-Captain name (must be different and in starting XI):');
  if (!vcName) return;
  const vc = starters.find(p => p.name.toLowerCase().includes(vcName.toLowerCase()) && p._id !== cap._id);
  if (!vc) return alert('Vice not found in starters or same as Captain');

  captainId = String(cap._id);
  viceCaptainId = String(vc._id);
  updateTeamDisplay();

  saveCaptainsToServer().catch(() => {});
}

async function saveCaptainsToServer() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/teams/captains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ captainId, viceCaptainId })
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Failed to save captains');
    else await loadActiveGWPoints();
  } catch (e) {
    console.warn('Save captains failed:', e);
  }
}

async function clearTeam() {
  try {
    if (!confirm('Are you sure you want to clear your team?')) return;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/teams/clear', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to clear team');
      return;
    }
    selectedPlayers = [];
    captainId = null;
    viceCaptainId = null;
    teamCreated = false;
    gwPointsMap = {};
    gwTeamTotal = 0;
    setText('budgetRemaining', '100.0M');
    updateTeamDisplay();
    updateUI();
  } catch (e) {
    console.error('Clear team error:', e);
    alert('Failed to clear team');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

// Expose ensureTeamSaved globally for inline modal script
window.ensureTeamSaved = ensureTeamSaved;

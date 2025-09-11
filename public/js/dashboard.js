// public/js/dashboard.js

// Global state
let selectedPlayers = []; // [{...player, slotPosition: 'START'|'BENCH', slotIndex: number}]
let currentPosition = null; // 'START' or 'BENCH'
let currentSlotIndex = null;
let allPlayers = [];
let allClubs = [];
let captainId = null;
let viceCaptainId = null;
let totalBudget = 100;
let freeTransfers = 1;
let teamCreated = false; // true if team is already saved (15 players)
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
  await loadPlayers();
  await loadClubs();
  await loadUserTeam();
  await loadActiveGWPoints(); // load live GW points after team + clubs

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
    const res = await fetch('/api/players?sort=price');
    allPlayers = await res.json();
  } catch (e) {
    console.error('Error loading players:', e);
  }
}

async function loadClubs() {
  try {
    const playersResponse = await fetch('/api/players');
    const players = await playersResponse.json();
    const clubsWithPlayers = new Map();
    players.forEach(player => {
      if (player.club && player.club._id) {
        clubsWithPlayers.set(player.club._id, {
          _id: player.club._id,
          name: player.club.name,
          shortName: player.club.shortName
        });
      }
    });
    allClubs = Array.from(clubsWithPlayers.values()).sort((a, b) => a.name.localeCompare(b.name));
    const clubFilter = document.getElementById('clubFilter');
    if (clubFilter) {
      clubFilter.innerHTML = '<option value="">All Clubs</option>' +
        allClubs.map(club => `<option value="${club._id}">${escapeHtml(club.name)}</option>`).join('');
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
    document.getElementById('freeTransfers').textContent = freeTransfers.toString();
    document.getElementById('budgetRemaining').textContent = `${Number(data.budget ?? 100).toFixed(1)}M`;

    // Build selectedPlayers based on stored lineup if present
    selectedPlayers = [];
    const teamArr = data.team || [];
    teamCreated = teamArr.length === 15;

    captainId = teamArr.find(t => t.captain)?.player?._id || null;
    viceCaptainId = teamArr.find(t => t.viceCaptain)?.player?._id || null;

    const place = (playerDoc, slotPosition, slotIndex) => {
      const id = String(playerDoc._id);
      const full = allPlayers.find(p => String(p._id) === id) || playerDoc;
      selectedPlayers.push({ ...full, _id: id, slotPosition, slotIndex });
    };

    // If lineup stored
    if (data.startingXI && data.startingXI.length === 11) {
      let defIdx = 1, midIdx = 5, fwdIdx = 9;
      // GK first
      for (const p of data.startingXI) {
        if (p.position === 'GK') { place(p, 'START', 0); }
      }
      // DEF (slots 1-4)
      for (const p of data.startingXI) if (p.position === 'DEF') { place(p, 'START', defIdx++); }
      // MID (slots 5-8)
      for (const p of data.startingXI) if (p.position === 'MID') { place(p, 'START', midIdx++); }
      // FWD (slots 9-10)
      for (const p of data.startingXI) if (p.position === 'FWD') { place(p, 'START', fwdIdx++); }
      // Bench (0: GK, 1: outfield, 2: outfield, 3: outfield)
      if (Array.isArray(data.benchOrder)) {
        for (let i = 0; i < data.benchOrder.length; i++) {
          const p = data.benchOrder[i];
          place(p, 'BENCH', i);
        }
      }
    } else {
      // Fallback simple placement
      const teamPlayers = teamArr.map(item => item.player);
      // GK
      const gks = teamPlayers.filter(p => p.position === 'GK');
      if (gks[0]) place(gks[0], 'START', 0);
      // DEF 4
      let idx = 1;
      teamPlayers.filter(p => p.position === 'DEF').slice(0,4).forEach(p => place(p, 'START', idx++));
      // MID 4
      idx = 5;
      teamPlayers.filter(p => p.position === 'MID').slice(0,4).forEach(p => place(p, 'START', idx++));
      // FWD 2
      idx = 9;
      teamPlayers.filter(p => p.position === 'FWD').slice(0,2).forEach(p => place(p, 'START', idx++));
      // Bench: GK then 3 outfield
      const benchGK = gks[1];
      if (benchGK) place(benchGK, 'BENCH', 0);
      const outRem = [
        ...teamPlayers.filter(p => p.position === 'DEF').slice(4),
        ...teamPlayers.filter(p => p.position === 'MID').slice(4),
        ...teamPlayers.filter(p => p.position === 'FWD').slice(2)
      ];
      for (let i = 0; i < 3 && outRem[i]; i++) {
        place(outRem[i], 'BENCH', i + 1);
      }
    }

    updateTeamDisplay();
    updateUI();
  } catch (e) {
    console.error('Error loading team:', e);
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

    // Update Points in stats bar to live team total for active GW
    document.getElementById('totalPoints').textContent = gwTeamTotal.toString();

    updateTeamDisplay(); // to reflect per-player GW points
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
  // Re-open modal with current constraints to apply filters
  const modal = document.getElementById('playerModal');
  if (!modal.classList.contains('active')) return;
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
      document.getElementById('budgetRemaining').textContent = `${Number(data.budget ?? 0).toFixed(1)}M`;
      freeTransfers = Number(data.freeTransfers ?? freeTransfers);
      document.getElementById('freeTransfers').textContent = freeTransfers.toString();

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
    const el = document.getElementById('totalPoints');
    if (el) el.textContent = gwTeamTotal.toString();
  }
}

function updateUI() {
  const count = selectedPlayers.length;
  document.getElementById('selectedCount').textContent = `${count}/15`;
  const spent = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0);
  const budgetRemaining = totalBudget - spent;
  document.getElementById('budgetRemaining').textContent = `${budgetRemaining.toFixed(1)}M`;
  document.getElementById('freeTransfers').textContent = Number(freeTransfers).toString();
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

// Captains modal helpers
function openCaptainsModal() {
  if (selectedPlayers.length < 11) {
    alert('Select your starting XI first.');
    return;
  }
  // Create simple prompt alternative or a modal you already have
  // For brevity, prompt-based approach can be replaced by your existing modal
  const starters = selectedPlayers.filter(p => p.slotPosition === 'START');
  // Use a quick chooser (you can keep your existing modal code)
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

  // Save immediately
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

function clearTeam() {
  if (!confirm('Are you sure you want to clear your team?')) return;
  selectedPlayers = [];
  captainId = null;
  viceCaptainId = null;
  teamCreated = false;
  updateTeamDisplay();
  updateUI();
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

// Add this function to your dashboard.js file

async function autoComplete() {
  if (selectedPlayers.length >= 15) {
    alert('Team is already full!');
    return;
  }

  if (!confirm('This will automatically fill your remaining slots with budget-friendly players. Continue?')) {
    return;
  }

  try {
    // Get already selected player IDs
    const selectedIds = new Set(selectedPlayers.map(p => String(p._id)));
    
    // Get available players, sorted by value (price vs points ratio)
    const availablePlayers = allPlayers
      .filter(p => !selectedIds.has(String(p._id)))
      .map(p => ({
        ...p,
        value: (Number(p.totalPoints) || 0) / (Number(p.price) || 0.5) // points per million
      }))
      .sort((a, b) => b.value - a.value); // best value first

    // Calculate remaining budget
    const currentSpend = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0);
    let remainingBudget = totalBudget - currentSpend;

    // Fill starting XI first
    const startingSlots = [
      { position: 'START', index: 0, posFilter: 'GK', required: true },
      { position: 'START', index: 1, posFilter: 'DEF', required: true },
      { position: 'START', index: 2, posFilter: 'DEF', required: true },
      { position: 'START', index: 3, posFilter: 'DEF', required: true },
      { position: 'START', index: 4, posFilter: 'DEF', required: true },
      { position: 'START', index: 5, posFilter: 'MID', required: true },
      { position: 'START', index: 6, posFilter: 'MID', required: true },
      { position: 'START', index: 7, posFilter: 'MID', required: true },
      { position: 'START', index: 8, posFilter: 'MID', required: true },
      { position: 'START', index: 9, posFilter: 'FWD', required: true },
      { position: 'START', index: 10, posFilter: 'FWD', required: true }
    ];

    // Fill bench slots
    const benchSlots = [
      { position: 'BENCH', index: 0, posFilter: 'GK', required: true },
      { position: 'BENCH', index: 1, posFilter: 'OUTFIELD', required: true },
      { position: 'BENCH', index: 2, posFilter: 'OUTFIELD', required: true },
      { position: 'BENCH', index: 3, posFilter: 'OUTFIELD', required: true }
    ];

    const allSlots = [...startingSlots, ...benchSlots];

    // Fill empty slots
    for (const slot of allSlots) {
      const existingPlayer = selectedPlayers.find(p => 
        p.slotPosition === slot.position && p.slotIndex === slot.index
      );
      
      if (existingPlayer) continue; // slot already filled

      let candidates = [];
      
      if (slot.posFilter === 'GK') {
        candidates = availablePlayers.filter(p => p.position === 'GK');
      } else if (slot.posFilter === 'OUTFIELD') {
        candidates = availablePlayers.filter(p => p.position !== 'GK');
      } else {
        candidates = availablePlayers.filter(p => p.position === slot.posFilter);
      }

      // Remove already selected players
      const currentSelectedIds = new Set(selectedPlayers.map(p => String(p._id)));
      candidates = candidates.filter(p => !currentSelectedIds.has(String(p._id)));

      // Find affordable player
      const affordableCandidate = candidates.find(p => Number(p.price || 0) <= remainingBudget);
      
      if (affordableCandidate) {
        // Add player to selected
        selectedPlayers.push({
          ...affordableCandidate,
          _id: String(affordableCandidate._id),
          slotPosition: slot.position,
          slotIndex: slot.index
        });
        
        remainingBudget -= Number(affordableCandidate.price || 0);
      } else {
        console.warn(`No affordable ${slot.posFilter} found for slot ${slot.position}[${slot.index}]`);
      }
    }

    // Auto-assign captain and vice-captain if not set
    if (!captainId || !viceCaptainId) {
      const starters = selectedPlayers.filter(p => p.slotPosition === 'START');
      const sortedStarters = starters.sort((a, b) => (Number(b.totalPoints) || 0) - (Number(a.totalPoints) || 0));
      
      if (!captainId && sortedStarters[0]) {
        captainId = String(sortedStarters[0]._id);
      }
      if (!viceCaptainId && sortedStarters[1]) {
        viceCaptainId = String(sortedStarters[1]._id);
      }
    }

    updateTeamDisplay();
    updateUI();
    alert('Team auto-completed successfully!');

  } catch (error) {
    console.error('Auto-complete error:', error);
    alert('Error during auto-complete');
  }
}

// Add this saveLineup function to your dashboard.js

async function saveLineup() {
  if (selectedPlayers.length !== 15) {
    alert('You must select exactly 15 players first');
    return;
  }

  // Verify we have 11 starters and 4 bench
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
    
    // Sort starters and bench by their slot indices
    const sortedStarters = starters.sort((a, b) => a.slotIndex - b.slotIndex);
    const sortedBench = bench.sort((a, b) => a.slotIndex - b.slotIndex);
    
    const startingXI = sortedStarters.map(p => p._id);
    const benchOrder = sortedBench.map(p => p._id);

    const response = await fetch('/api/teams/lineup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        startingXI,
        benchOrder
      })
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
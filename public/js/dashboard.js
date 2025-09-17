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
let userWeeklyPoints = []; // [{ gameweek, points }]
let userCareerTotal = 0;   // season total from server
let gwLocked = false;
// Club limits
const STARTER_CLUB_LIMIT = 5;   // max starters per club
const BENCH_CLUB_LIMIT = 2;     // max bench per club

// Active GW live points
let gwWeekNumber = null;
let gwPointsMap = {}; // { playerId: pointsInActiveGW }
let gwTeamTotal = 0;
// Live transfer hit for the active GW (from server)
let activeGwHit = 0;
// Swap system
let swapAnchor = null;            // { slotPosition: 'START'|'BENCH', slotIndex: number, player: object }
let swapAllowedTargets = new Set(); // e.g., new Set(['START-1','BENCH-2'])

const START_MAP = { 0:'GK', 1:'DEF', 2:'DEF', 3:'DEF', 4:'DEF', 5:'MID', 6:'MID', 7:'MID', 8:'MID', 9:'FWD', 10:'FWD' };
const BENCH_MAP = { 0:'GK', 1:'DEF', 2:'MID', 3:'FWD' };

function slotRequiredPosition(slotPosition, slotIndex) {
  return slotPosition === 'START' ? START_MAP[slotIndex] : BENCH_MAP[slotIndex];
}
function slotKey(slotPosition, slotIndex) {
  return `${slotPosition}-${slotIndex}`;
}

// Recompute header totals: Career live = sum(other GWs from weeklyPoints) + live active GW
function updateHeaderTotals() {
  // Sum all GWs except the active one from stored weeklyPoints
  const prevSum = (userWeeklyPoints || []).reduce((sum, w) => {
    if (gwWeekNumber && Number(w.gameweek) === Number(gwWeekNumber)) return sum;
    return sum + Number(w.points || 0);
  }, 0);

  // Add live active GW (if any)
  const careerLive = prevSum + (gwWeekNumber ? Number(gwTeamTotal || 0) : 0);

  setText('careerTotalPoints', String(careerLive));
}

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

function getClubId(p) {
  // Works for populated docs {club: {_id, ...}} or raw ids
  if (!p || !p.club) return null;
  return String(p.club._id || p.club);
}
function getClubName(p) {
  return p?.club?.shortName || p?.club?.name || 'club';
}

// Build per-club counts for current selection
function computeClubCounts(list = selectedPlayers) {
  const starters = new Map();
  const bench = new Map();
  for (const sp of list) {
    const cid = getClubId(sp);
    if (!cid) continue;
    if (sp.slotPosition === 'START') {
      starters.set(cid, (starters.get(cid) || 0) + 1);
    } else if (sp.slotPosition === 'BENCH') {
      bench.set(cid, (bench.get(cid) || 0) + 1);
    }
  }
  return { starters, bench };
}

// Check if adding/replacing would exceed per-club limits.
// replacingAtSlot is the existing player in that slot (if any) so we
// subtract their count before simulating the new one.
function exceedsClubLimitFor(player, targetPosition, replacingAtSlot = null) {
  const cid = getClubId(player);
  if (!cid) return null;

  const counts = computeClubCounts();
  // If replacing someone in this slot, subtract that player's club from the right map
  if (replacingAtSlot) {
    const rcid = getClubId(replacingAtSlot);
    if (rcid) {
      if (replacingAtSlot.slotPosition === 'START') {
        counts.starters.set(rcid, Math.max(0, (counts.starters.get(rcid) || 0) - 1));
      } else if (replacingAtSlot.slotPosition === 'BENCH') {
        counts.bench.set(rcid, Math.max(0, (counts.bench.get(rcid) || 0) - 1));
      }
    }
  }

  if (targetPosition === 'START') {
    const next = (counts.starters.get(cid) || 0) + 1;
    if (next > STARTER_CLUB_LIMIT) {
      return `Max ${STARTER_CLUB_LIMIT} starters per club. ${getClubName(player)} would be ${next}/${STARTER_CLUB_LIMIT}.`;
    }
  } else if (targetPosition === 'BENCH') {
    const next = (counts.bench.get(cid) || 0) + 1;
    if (next > BENCH_CLUB_LIMIT) {
      return `Max ${BENCH_CLUB_LIMIT} bench players per club. ${getClubName(player)} would be ${next}/${BENCH_CLUB_LIMIT}.`;
    }
  }
  return null;
}

// Validate the whole lineup against limits (used before saving)
function validateClubLimits() {
  const { starters, bench } = computeClubCounts();
  const startersExceeded = [];
  const benchExceeded = [];
  for (const [cid, cnt] of starters.entries()) if (cnt > STARTER_CLUB_LIMIT) startersExceeded.push({ cid, cnt });
  for (const [cid, cnt] of bench.entries()) if (cnt > BENCH_CLUB_LIMIT) benchExceeded.push({ cid, cnt });

  return { startersExceeded, benchExceeded, ok: (startersExceeded.length === 0 && benchExceeded.length === 0) };
}
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
    userCareerTotal = Number(data.totalPoints || 0);
    userWeeklyPoints = Array.isArray(data.weeklyPoints) ? data.weeklyPoints.slice().sort((a, b) => a.gameweek - b.gameweek) : [];
    
    // Show chips now (will use stored values for past GWs)
    renderGwChips();
    
    // Compute header with whatever we have so far (active GW may not be loaded yet)
    updateHeaderTotals();
    
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
function updateTransferWarning() {
  const el = document.getElementById('transferWarning');
  const ftEl = document.getElementById('freeTransfers');
  if (ftEl) ftEl.classList.toggle('text-danger', Number(freeTransfers) <= 0);

  if (!el) return;
  if (Number(freeTransfers) > 0) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  const msg = gwLocked
    ? 'No free transfers left. Each extra transfer costs -4 points (applied to this Gameweek).'
    : 'No free transfers left. Each extra transfer costs -4 points (carried to next Gameweek).';
  el.style.display = 'block';
  el.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i> ${msg}`;
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
    gwLocked = !!data.locked;

    // Show "Active GW" with hit hint if any
    activeGwHit = Number(data.transferCost || 0);
    const label = gwWeekNumber
      ? `GW ${gwWeekNumber}: ${gwTeamTotal}${activeGwHit > 0 ? ` (−${activeGwHit} hit)` : ''}`
      : 'GW —';
    setText('activeGwPoints', label);
    

    const gwStatusEl = document.getElementById('gwStatus');
    if (gwStatusEl) {
      const badge = gwLocked
        ? '<span class="badge bg-secondary">Locked</span>'
        : '<span class="badge bg-success">Open</span>';
      gwStatusEl.innerHTML = `${badge}${gwWeekNumber ? ` <small class="ms-1">GW ${gwWeekNumber}</small>` : ''}`;
    }

    updateTeamDisplay();
    // Recompute career live total and refresh the chips (active GW chip uses live)
updateHeaderTotals();
renderGwChips();

  } catch (e) {
    console.error('Error loading active GW points:', e);
  }
}


// Selection flow
// REPLACE selectPosition
function selectPosition(position, index) {
  currentPosition = position; // 'START'|'BENCH'
  currentSlotIndex = index;

  const existingPlayer = selectedPlayers.find(p => p.slotPosition === position && p.slotIndex === index);

  // If a swap anchor is already selected: try to swap with this clicked slot
  if (swapAnchor) {
    trySwapWithAnchor(position, index, existingPlayer);
    return;
  }

  // If team is already created and not in transfer mode, clicking a filled slot will start swap (not transfer)
  if (teamCreated && existingPlayer && !transferMode) {
    if (gwLocked) {
      showToast('Lineup is locked for the active Gameweek', 'warning', 2500);
      return;
    }
    beginSwap(position, index, existingPlayer);
    return;
  }

  // Transfer mode: clicking filled slot -> transfer out flow (existing behavior)
  if (transferMode && existingPlayer) {
    transferOutPlayer = existingPlayer;
    // For bench: fixed mapping
    const benchMap = { 0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD' };
    const fixedBenchPos = (position === 'BENCH') ? benchMap[index] : null;
    openPlayerModal(fixedBenchPos || existingPlayer.position);
    return;
  }

  // Empty slot -> open modal to add a new player (initial team creation remains intact)
  let positionFilter = null;
  if (position === 'START') {
    if (index === 0) positionFilter = 'GK';
    else if (index >= 1 && index <= 4) positionFilter = 'DEF';
    else if (index >= 5 && index <= 8) positionFilter = 'MID';
    else if (index >= 9 && index <= 10) positionFilter = 'FWD';
  } else if (position === 'BENCH') {
    const benchMap = { 0:'GK', 1:'DEF', 2:'MID', 3:'FWD' };
    positionFilter = benchMap[index] || null;
  }
  openPlayerModal(positionFilter);
}

function beginSwap(slotPosition, slotIndex, player) {
  clearSwapState();
  swapAnchor = { slotPosition, slotIndex, player };

  // Compute allowed targets: opposite zone only, must be filled, positions must fit both slots, and club limits must hold
  swapAllowedTargets = computeAllowedTargets(swapAnchor);

  // Visual + toast
  updateTeamDisplay();
  showToast('Tap a target slot to swap', 'info', 2000);
}

function clearSwapState() {
  swapAnchor = null;
  swapAllowedTargets = new Set();
}

function computeAllowedTargets(anchor) {
  const targets = new Set();
  const opposite = (anchor.slotPosition === 'START') ? 'BENCH' : 'START';

  // Consider every slot on the opposite side
  const maxIdx = (opposite === 'START') ? 10 : 3;
  for (let idx = 0; idx <= maxIdx; idx++) {
    const targetPlayer = selectedPlayers.find(p => p.slotPosition === opposite && p.slotIndex === idx);
    if (!targetPlayer) continue; // swap requires a filled slot

    if (canSwapBetween(
      { slotPosition: anchor.slotPosition, slotIndex: anchor.slotIndex, player: anchor.player },
      { slotPosition: opposite, slotIndex: idx, player: targetPlayer }
    )) {
      targets.add(slotKey(opposite, idx));
    }
  }
  return targets;
}

function canSwapBetween(a, b) {
  // Must be bench <-> start
  if (a.slotPosition === b.slotPosition) return false;

  // GW lock blocks any lineup change
  if (teamCreated && gwLocked) return false;

  // Position constraints for both sides
  const reqA = slotRequiredPosition(a.slotPosition, a.slotIndex);
  const reqB = slotRequiredPosition(b.slotPosition, b.slotIndex);
  if (a.player.position !== reqA) return false; // anchor currently sits in correct slot type by construction
  if (b.player.position !== reqB) return false;

  // After swap: a goes to b.slot; b goes to a.slot -> both must match the new slot requirements
  if (a.player.position !== reqB) return false;
  if (b.player.position !== reqA) return false;

  // Club limits simulation:
  const { starters, bench } = computeClubCounts(selectedPlayers);

  const aCid = getClubId(a.player);
  const bCid = getClubId(b.player);

  // Remove current occupancy
  if (a.slotPosition === 'START') starters.set(aCid, Math.max(0, (starters.get(aCid) || 0) - 1));
  else bench.set(aCid, Math.max(0, (bench.get(aCid) || 0) - 1));

  if (b.slotPosition === 'START') starters.set(bCid, Math.max(0, (starters.get(bCid) || 0) - 1));
  else bench.set(bCid, Math.max(0, (bench.get(bCid) || 0) - 1));

  // Add swapped occupancy
  if (b.slotPosition === 'START') starters.set(aCid, (starters.get(aCid) || 0) + 1);
  else bench.set(aCid, (bench.get(aCid) || 0) + 1);

  if (a.slotPosition === 'START') starters.set(bCid, (starters.get(bCid) || 0) + 1);
  else bench.set(bCid, (bench.get(bCid) || 0) + 1);

  // Validate limits
  if ((starters.get(aCid) || 0) > STARTER_CLUB_LIMIT) return false;
  if ((starters.get(bCid) || 0) > STARTER_CLUB_LIMIT) return false;
  if ((bench.get(aCid) || 0) > BENCH_CLUB_LIMIT) return false;
  if ((bench.get(bCid) || 0) > BENCH_CLUB_LIMIT) return false;

  return true;
}

function trySwapWithAnchor(clickedSlotPosition, clickedSlotIndex, clickedPlayer) {
  // Cancel if clicking the anchor again
  if (swapAnchor && swapAnchor.slotPosition === clickedSlotPosition && swapAnchor.slotIndex === clickedSlotIndex) {
    clearSwapState();
    updateTeamDisplay();
    return;
  }

  const key = slotKey(clickedSlotPosition, clickedSlotIndex);
  if (!swapAllowedTargets.has(key)) {
    showToast('Invalid swap target', 'warning', 1800);
    return;
  }
  if (!clickedPlayer) {
    showToast('Target slot is empty', 'warning', 1800);
    return;
  }

  // Perform swap
  performSwap(swapAnchor, { slotPosition: clickedSlotPosition, slotIndex: clickedSlotIndex, player: clickedPlayer });
}

function performSwap(a, b) {
  const iA = selectedPlayers.findIndex(p => p.slotPosition === a.slotPosition && p.slotIndex === a.slotIndex);
  const iB = selectedPlayers.findIndex(p => p.slotPosition === b.slotPosition && p.slotIndex === b.slotIndex);
  if (iA < 0 || iB < 0) return;

  // Swap slot markers
  const tmpPos = selectedPlayers[iA].slotPosition;
  const tmpIdx = selectedPlayers[iA].slotIndex;

  selectedPlayers[iA].slotPosition = selectedPlayers[iB].slotPosition;
  selectedPlayers[iA].slotIndex    = selectedPlayers[iB].slotIndex;

  selectedPlayers[iB].slotPosition = tmpPos;
  selectedPlayers[iB].slotIndex    = tmpIdx;

  clearSwapState();
  updateTeamDisplay();
  updateUI();
  showToast('Players swapped. Don’t forget to Save Lineup!', 'success', 2500);
}

// REPLACE this function
function openPlayerModal(positionFilter) {
  const modal = document.getElementById('playerModal');
  const modalPosition = document.getElementById('modalPosition');

  // If BENCH slot and no explicit filter provided, enforce fixed mapping
  const benchMap = { 0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD' };
  if (currentPosition === 'BENCH' && (positionFilter == null || positionFilter === '')) {
    positionFilter = benchMap[currentSlotIndex] || null;
  }

  // Header text
  modalPosition.textContent = positionFilter
    ? positionFilter
    : (currentPosition === 'BENCH' ? (benchMap[currentSlotIndex] || 'Any') : 'Any');

  // Build base list from current slot constraints
  let list = allPlayers.slice();
  if (positionFilter) {
    list = list.filter(p => p.position === positionFilter);
  }

  // If in transfer mode, still restrict to the same position being replaced
  if (transferMode && transferOutPlayer) {
    list = list.filter(p => p.position === (positionFilter || transferOutPlayer.position));
  }

  // Exclude already selected players (except the one being transferred out)
  const selectedIds = new Set(selectedPlayers.map(p => String(p._id)));
  if (transferOutPlayer) selectedIds.delete(String(transferOutPlayer._id));
  list = list.filter(p => !selectedIds.has(String(p._id)));

  // Cache for search/sort filtering
  modalBaseList = list;

  // Populate club dropdown and render
  setClubFilterOptions(modalBaseList);
  displayPlayersInModal(modalBaseList);

  modal.classList.add('active');
}



function setClubFilterOptions(players) {
  const clubFilter = document.getElementById('clubFilter');
  if (!clubFilter) return;

  const prev = clubFilter.value; // keep current selection if still valid

  const clubIds = Array.from(new Set(
    players
      .map(p => p.club && p.club._id && String(p.club._id))
      .filter(Boolean)
  ));

  const clubs = allClubs.filter(c => clubIds.includes(String(c._id)));

  clubFilter.innerHTML = '<option value="">All Clubs</option>' +
    clubs.map(c => `<option value="${String(c._id)}">${escapeHtml(c.name)}</option>`).join('');

  if (prev && clubIds.includes(prev)) clubFilter.value = prev;
}


function displayPlayersInModal(players) {
  const playersList = document.getElementById('playersList');
  const searchTerm = (document.getElementById('searchPlayer').value || '').toLowerCase();
  const clubId = document.getElementById('clubFilter').value;
  const sortBy = document.getElementById('sortBy').value;

  let filtered = players.slice();

  if (clubId) {
    filtered = filtered.filter(p => String(p.club?._id) === String(clubId));
  }
  if (searchTerm) {
    filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(searchTerm));
  }

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
  // Just re-render from cached base list; do NOT rebuild dropdown or base list
  displayPlayersInModal(modalBaseList);
}


async function selectPlayer(playerId) {
  const player = allPlayers.find(p => String(p._id) === String(playerId));
  if (!player) return;

  // Transfer flow: team created + transfer mode + replacing a specific slot
// Transfer flow: team created + transfer mode + replacing a specific slot
if (teamCreated && transferMode && transferOutPlayer) {
  // Ensure the server has a saved squad and contains the outgoing player
  const ready = await ensureServerSquadReadyForTransfer(String(transferOutPlayer._id));
  if (!ready) {
    // Do NOT call /api/teams/transfer; UI freeTransfers remains unchanged
    return;
  }

  // Confirm hit messaging if no free transfers
  if (Number(freeTransfers) <= 0) {
    const msg = gwLocked
      ? 'You have 0 free transfers. This transfer will cost -4 points in THIS Gameweek.\nContinue?'
      : 'You have 0 free transfers. This transfer will cost -4 points NEXT Gameweek.\nContinue?';
    const ok = confirm(msg);
    if (!ok) return;
  }

  // Club limit check BEFORE calling API
  const reason = exceedsClubLimitFor(player, transferOutPlayer.slotPosition, transferOutPlayer);
  if (reason) { alert(reason); return; }

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/teams/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ outPlayerId: transferOutPlayer._id, inPlayerId: player._id })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Transfer failed');

    // Replace in same slot locally
    const idx = selectedPlayers.findIndex(p => p.slotPosition === transferOutPlayer.slotPosition && p.slotIndex === transferOutPlayer.slotIndex);
    if (idx >= 0) {
      selectedPlayers[idx] = { ...player, _id: String(player._id), slotPosition: transferOutPlayer.slotPosition, slotIndex: transferOutPlayer.slotIndex };
    }
    setText('budgetRemaining', `${Number(data.budget ?? 0).toFixed(1)}M`);
    freeTransfers = Number(data.freeTransfers ?? freeTransfers);
    setText('freeTransfers', freeTransfers.toString());
    updateTransferWarning();

    transferOutPlayer = null;
    closePlayerModal();
    updateTeamDisplay();
    updateUI();

    // Refresh header (Active GW, Career, and server team snapshot) after a transfer
    await loadActiveGWPoints();
    await loadUserTeam();

    return;
  } catch (e) {
    console.error('Transfer error:', e);
    alert('Transfer failed');
    return;
  }
}


  // Initial creation or replacement in local layout
  const existingAtSlot = selectedPlayers.find(p => p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex);

  // Budget check (consider removal of existing slot)
  const spent = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0) - (existingAtSlot ? Number(existingAtSlot.price || 0) : 0);
  if (spent + Number(player.price || 0) > totalBudget) {
    alert('Not enough budget!');
    return;
  }

  // Bench constraints by type
if (currentPosition === 'BENCH') {
  if (currentSlotIndex === 0 && player.position !== 'GK') return alert('Bench slot 0 must be a GK');
  if (currentSlotIndex === 1 && player.position !== 'DEF') return alert('Bench slot 1 must be a DEF');
  if (currentSlotIndex === 2 && player.position !== 'MID') return alert('Bench slot 2 must be a MID');
  if (currentSlotIndex === 3 && player.position !== 'FWD') return alert('Bench slot 3 must be a FWD');
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

  // NEW: per-club limits check for the slot we're filling
  const reason = exceedsClubLimitFor(player, currentPosition, existingAtSlot);
  if (reason) { alert(reason); return; }

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
// Auto-sub on the pitch (visual only) for injured/suspended starters
function applyAvailabilityAutoSubs(list) {
  // Deep-ish clone to avoid mutating selectedPlayers
  const clones = list.map(p => ({ ...p }));

  // Index helpers
  const getAt = (slotPosition, slotIndex) => clones.find(x => x.slotPosition === slotPosition && x.slotIndex === slotIndex);
  const swapSlots = (a, b) => {
    const aPos = a.slotPosition, aIdx = a.slotIndex;
    a.slotPosition = b.slotPosition; a.slotIndex = b.slotIndex;
    b.slotPosition = aPos; b.slotIndex = aIdx;
  };

  // Bench candidates by position (in bench order)
  const benchByPos = (pos) =>
    clones
      .filter(x => x.slotPosition === 'BENCH' && x.position === pos && !x.isInjured && !x.isSuspended)
      .sort((a, b) => a.slotIndex - b.slotIndex);

  // Start: GK (0), DEF (1-4), MID (5-8), FWD (9-10)
  const startSlots = [
    { idx: 0, pos: 'GK' },
    { idx: 1, pos: 'DEF' }, { idx: 2, pos: 'DEF' }, { idx: 3, pos: 'DEF' }, { idx: 4, pos: 'DEF' },
    { idx: 5, pos: 'MID' }, { idx: 6, pos: 'MID' }, { idx: 7, pos: 'MID' }, { idx: 8, pos: 'MID' },
    { idx: 9, pos: 'FWD' }, { idx: 10, pos: 'FWD' }
  ];

  for (const slot of startSlots) {
    const starter = getAt('START', slot.idx);
    if (!starter) continue;

    const unavailable = !!starter.isInjured || !!starter.isSuspended;
    if (!unavailable) continue;

    const candidates = benchByPos(slot.pos);
    if (!candidates.length) continue;

    // take earliest bench candidate of the same position
    const benchPick = candidates[0];
    swapSlots(starter, benchPick);
  }

  return clones;
}

// Display
function updateTeamDisplay() {
  const renderPlayers = applyAvailabilityAutoSubs(selectedPlayers);

  // Compute per-club counts for starters to highlight violations
  const { starters } = computeClubCounts(renderPlayers);
  const exceededClubIds = new Set();
  for (const [cid, cnt] of starters.entries()) {
    if (cnt > STARTER_CLUB_LIMIT) exceededClubIds.add(String(cid));
  }

  document.querySelectorAll('.position-slot').forEach(slot => {
    slot.classList.remove('limit-exceeded', 'swap-anchor', 'swap-allowed');  // reset visual
    const pos = slot.dataset.position; // 'START' or 'BENCH'
    const idx = parseInt(slot.dataset.index, 10);
    const player = renderPlayers.find(p => p.slotPosition === pos && p.slotIndex === idx);

    slot.classList.toggle('filled', !!player);
    if (player) {
      const pid = String(player._id);
      const gwPts = Number(gwPointsMap[pid] || 0);
      const isC = pid === String(captainId);
      const isVC = pid === String(viceCaptainId);
      const clubDisplay = player.club?.shortName || player.club?.name || '';
      const statusBadge = player.isInjured
        ? '<span class="badge bg-danger position-absolute" style="top:22px;right:4px;">INJ</span>'
        : (player.isSuspended ? '<span class="badge bg-warning text-dark position-absolute" style="top:22px;right:4px;">SUS</span>' : '');
        const label = (pos === 'BENCH')
        ? (idx === 0 ? 'GK' : idx === 1 ? 'DEF' : idx === 2 ? 'MID' : 'FWD')
        : player.position;
      

      // If starters of this player's club exceed limit, mark starter slots of that club
      if (pos === 'START') {
        const cid = getClubId(player);
        if (cid && exceededClubIds.has(String(cid))) {
          slot.classList.add('limit-exceeded');
        }
      }

      slot.innerHTML = `
        <span class="position-label">${label}</span>
        ${isC ? '<span class="captain-badge">C</span>' : ''}
        ${isVC ? '<span class="vice-badge">VC</span>' : ''}
        ${statusBadge}
        <div class="player-info">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-club">${escapeHtml(clubDisplay)}</div>
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
        label = (idx === 0 ? 'GK' : idx === 1 ? 'DEF' : idx === 2 ? 'MID' : 'FWD');
      }
      slot.innerHTML = `
        <span class="position-label">${label}</span>
        <i class="bi bi-plus-circle add-icon"></i>
      `;
    }
    const isAnchor = swapAnchor && swapAnchor.slotPosition === pos && swapAnchor.slotIndex === idx;
if (isAnchor) slot.classList.add('swap-anchor');

const key = slotKey(pos, idx);
if (swapAllowedTargets.has(key)) slot.classList.add('swap-allowed');

  });

  // Banner warning if any club exceeds starter limit
  const banner = document.getElementById('clubLimitWarning');
  if (banner) {
    if (exceededClubIds.size > 0) {
      // Build "RCA (6/5), WAC (7/5)" style message
      const parts = [];
      for (const cid of exceededClubIds) {
        // find a sample player for this club to get a name
        const sample = renderPlayers.find(p => p.slotPosition === 'START' && getClubId(p) === cid);
        const name = sample ? (sample.club?.shortName || sample.club?.name || 'Club') : 'Club';
        const cnt = starters.get(cid) || 0;
        parts.push(`${name} (${cnt}/${STARTER_CLUB_LIMIT})`);
      }
      banner.style.display = 'block';
      banner.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i> Starters per-club limit exceeded: ${parts.join(', ')}`;
    } else {
      banner.style.display = 'none';
      banner.textContent = '';
    }
  }

  if (gwWeekNumber != null) {
    setText('activeGwPoints', `GW ${gwWeekNumber}: ${gwTeamTotal}${activeGwHit > 0 ? ` (−${activeGwHit} hit)` : ''}`);
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
  // At end of updateUI():
updateTransferWarning();
}
function renderGwChips() {
  const el = document.getElementById('gwChips');
  if (!el) return;

  if (!userWeeklyPoints || userWeeklyPoints.length === 0) {
    el.innerHTML = '<small class="text-white-50">No GW history yet</small>';
    return;
  }

  el.innerHTML = userWeeklyPoints.map(w => {
    const isActive = gwWeekNumber && Number(w.gameweek) === Number(gwWeekNumber);
    const val = isActive ? Number(gwTeamTotal || 0) : Number(w.points || 0);
    const hitBadge = isActive && activeGwHit > 0
      ? `<span class="badge bg-danger ms-1">-${activeGwHit}</span>`
      : '';
    return `<span class="badge bg-light text-dark me-1 mb-1">GW ${w.gameweek}: ${val}</span>${hitBadge}`;
  }).join('');
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
  // Club limits guard
  {
    const { startersExceeded, benchExceeded, ok } = validateClubLimits();
    if (!ok) {
      const msg = [
        ...startersExceeded.map(e => {
          const any = selectedPlayers.find(p => p.slotPosition === 'START' && getClubId(p) === e.cid);
          const name = any ? (any.club?.shortName || any.club?.name || 'Club') : 'Club';
          return `${name} starters: ${e.cnt}/${STARTER_CLUB_LIMIT}`;
        }),
        ...benchExceeded.map(e => {
          const any = selectedPlayers.find(p => p.slotPosition === 'BENCH' && getClubId(p) === e.cid);
          const name = any ? (any.club?.shortName || any.club?.name || 'Club') : 'Club';
          return `${name} bench: ${e.cnt}/${BENCH_CLUB_LIMIT}`;
        })
      ].join('\n');
      alert('Club limits exceeded:\n' + msg);
      return;
    }
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
  {
    const { startersExceeded, benchExceeded, ok } = validateClubLimits();
    if (!ok) {
      const msg = [
        ...startersExceeded.map(e => {
          const any = selectedPlayers.find(p => p.slotPosition === 'START' && getClubId(p) === e.cid);
          const name = any ? (any.club?.shortName || any.club?.name || 'Club') : 'Club';
          return `${name} starters: ${e.cnt}/${STARTER_CLUB_LIMIT}`;
        }),
        ...benchExceeded.map(e => {
          const any = selectedPlayers.find(p => p.slotPosition === 'BENCH' && getClubId(p) === e.cid);
          const name = any ? (any.club?.shortName || any.club?.name || 'Club') : 'Club';
          return `${name} bench: ${e.cnt}/${BENCH_CLUB_LIMIT}`;
        })
      ].join('\n');
      alert('Club limits exceeded:\n' + msg);
      return;
    }
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
  {
    const { startersExceeded, benchExceeded, ok } = validateClubLimits();
    if (!ok) {
      const msg = [
        ...startersExceeded.map(e => {
          const any = selectedPlayers.find(p => p.slotPosition === 'START' && getClubId(p) === e.cid);
          const name = any ? (any.club?.shortName || any.club?.name || 'Club') : 'Club';
          return `${name} starters: ${e.cnt}/${STARTER_CLUB_LIMIT}`;
        }),
        ...benchExceeded.map(e => {
          const any = selectedPlayers.find(p => p.slotPosition === 'BENCH' && getClubId(p) === e.cid);
          const name = any ? (any.club?.shortName || any.club?.name || 'Club') : 'Club';
          return `${name} bench: ${e.cnt}/${BENCH_CLUB_LIMIT}`;
        })
      ].join('\n');
      alert('Club limits exceeded:\n' + msg);
      return false;
    }
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
// Fetch server-saved squad player IDs (15)
async function fetchServerTeamIds() {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/teams/my-team', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  const ids = (data.team || []).map(s => String(s.player?._id || s.player)).filter(Boolean);
  return ids;
}

// Ensure the server has a saved 15-man squad AND contains the outgoing player
// Returns true if OK (server has 15 and contains outId); otherwise tries to auto-save and re-checks
async function ensureServerSquadReadyForTransfer(outId) {
  // 1) Fetch server squad
  let ids = await fetchServerTeamIds();

  // 2) If not 15 on server, attempt to save current 15
  if (ids.length !== 15) {
    const okSaved = await ensureTeamSaved();
    if (!okSaved) {
      alert('Please complete and save your 15-man squad before making transfers.');
      return false;
    }
    // Re-fetch after save
    ids = await fetchServerTeamIds();
    if (ids.length !== 15) {
      alert('Your squad was not saved properly. Please try saving your team again.');
      return false;
    }
  }

  // 3) Verify the outgoing player is in the server squad
  if (!ids.includes(String(outId))) {
    // Try to reload server team view to catch a recent change
    await loadUserTeam();
    const reIds = await fetchServerTeamIds();
    if (!reIds.includes(String(outId))) {
      alert('This player is not in your saved squad on the server. Save your squad first, then try the transfer again.');
      return false;
    }
  }

  return true;
}

// Auto-Complete: fill exact formation and bench (GK, DEF, MID, FWD) within budget
async function autoComplete() {
  // Desired fixed layout
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

  // Budget left
  const currentSpend = selectedPlayers.reduce((sum, p) => sum + Number(p.price || 0), 0);
  let remainingBudget = totalBudget - currentSpend;

  // Track selected ids to avoid duplicates
  const selectedIds = new Set(selectedPlayers.map(p => String(p._id)));

  // Sort candidates by cheapest first (tie-break: higher points)
  const byPos = {
    GK: allPlayers.filter(p => p.position === 'GK').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
    DEF: allPlayers.filter(p => p.position === 'DEF').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
    MID: allPlayers.filter(p => p.position === 'MID').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
    FWD: allPlayers.filter(p => p.position === 'FWD').sort((a, b) => (a.price - b.price) || ((b.totalPoints || 0) - (a.totalPoints || 0))),
  };

  // Live counts (start with existing selection)
  const liveCounts = computeClubCounts();

  const tryAdd = (slot, candidate) => {
    const id = String(candidate._id);
    if (selectedIds.has(id)) return false;
    if (slot.slotPosition === 'BENCH' && slot.slotIndex > 0 && candidate.position === 'GK') return false;

    // Budget
    const price = Number(candidate.price || 0);
    if (price > remainingBudget) return false;

    // Club limit check using liveCounts
    const cid = getClubId(candidate);
    if (cid) {
      if (slot.slotPosition === 'START') {
        const next = (liveCounts.starters.get(cid) || 0) + 1;
        if (next > STARTER_CLUB_LIMIT) return false;
      } else {
        const next = (liveCounts.bench.get(cid) || 0) + 1;
        if (next > BENCH_CLUB_LIMIT) return false;
      }
    }

    // Place candidate
    selectedPlayers.push({ ...candidate, _id: id, slotPosition: slot.slotPosition, slotIndex: slot.slotIndex });
    selectedIds.add(id);
    remainingBudget -= price;
    if (cid) {
      if (slot.slotPosition === 'START') liveCounts.starters.set(cid, (liveCounts.starters.get(cid) || 0) + 1);
      else liveCounts.bench.set(cid, (liveCounts.bench.get(cid) || 0) + 1);
    }
    return true;
  };

  // Helper to fill a slot if empty
  const fillSlot = (slot) => {
    if (selectedPlayers.find(p => p.slotPosition === slot.slotPosition && p.slotIndex === slot.slotIndex)) return true;
    for (const cand of byPos[slot.pos]) {
      if (tryAdd(slot, cand)) return true;
    }
    return false;
  };

  // Fill starters
  for (const slot of desiredStart) {
    if (!fillSlot(slot)) {
      alert(`Auto-complete failed: budget/availability/club limit for ${slot.pos} (starters).`);
      updateTeamDisplay(); updateUI();
      return;
    }
  }

  // Fill bench (GK, DEF, MID, FWD) respecting bench club limit
  for (const slot of desiredBench) {
    if (!fillSlot(slot)) {
      alert(`Auto-complete failed: budget/availability/club limit for ${slot.pos} (bench).`);
      updateTeamDisplay(); updateUI();
      return;
    }
  }

  // Auto-assign C/VC if missing
  if (!captainId || !viceCaptainId) {
    const starters = selectedPlayers.filter(p => p.slotPosition === 'START');
    const sortedStarters = starters.slice().sort((a, b) => (Number(b.totalPoints) || 0) - (Number(a.totalPoints) || 0));
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
// Pretty toast helper (non-blocking prompt)
function showToast(message, type = 'info', timeout = 2000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `app-toast toast-${type}`;
  el.innerHTML = `<span>${message}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, timeout);
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

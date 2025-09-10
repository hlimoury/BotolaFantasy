// dashboard.js - Complete JavaScript for the new dashboard.ejs

// Global state variables
// Add this with other global variables at the top
let currentPositionFilter = null;
let selectedPlayers = [];
let currentPosition = null;
let currentSlotIndex = null;
let allPlayers = [];
let allClubs = [];
let transferMode = false;
let transferOutPlayer = null;
let captainId = null;
let viceCaptainId = null;
let freeTransfers = 1;
let totalBudget = 100;


// Position limits
const POSITION_LIMITS = {
  GK: 2,
  DEF: 5,
  MID: 5,
  FWD: 3
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login';
    return;
  }
  
  await loadClubs();
  await loadPlayers();
  await loadUserTeam();
  setupEventListeners();
  updateUI();
});

// Setup event listeners
function setupEventListeners() {
  // Search functionality
  const searchInput = document.getElementById('searchPlayer');
  if (searchInput) {
    searchInput.addEventListener('input', filterPlayersInModal);
  }
  
  // Club filter
  const clubFilter = document.getElementById('clubFilter');
  if (clubFilter) {
    clubFilter.addEventListener('change', filterPlayersInModal);
  }
  
  // Sort filter
  const sortBy = document.getElementById('sortBy');
  if (sortBy) {
    sortBy.addEventListener('change', filterPlayersInModal);
  }
}

// Load clubs from API
async function loadClubs() {
  try {
    const response = await fetch('/api/clubs');
    allClubs = await response.json();
    
    const clubFilter = document.getElementById('clubFilter');
    if (clubFilter && allClubs.length > 0) {
      clubFilter.innerHTML = '<option value="">All Clubs</option>' +
        allClubs.map(club => `<option value="${club._id}">${club.name}</option>`).join('');
    }
  } catch (error) {
    console.error('Error loading clubs:', error);
  }
}

// Load players from API
async function loadPlayers() {
  try {
    const response = await fetch('/api/players?sort=price');
    allPlayers = await response.json();
  } catch (error) {
    console.error('Error loading players:', error);
  }
}

// Load user's team
async function loadUserTeam() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/teams/my-team', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.team && data.team.length > 0) {
        selectedPlayers = [];
        
        // Map team to selectedPlayers with START positions
        data.team.forEach((item, index) => {
          // First 11 are starters, rest are bench
          const slotPosition = index < 11 ? 'START' : 'BENCH';
          const slotIndex = index < 11 ? index : index - 11;
          
          selectedPlayers.push({
            ...item.player,
            slotPosition,
            slotIndex,
            isCaptain: item.captain,
            isViceCaptain: item.viceCaptain
          });
        });
        
        captainId = data.team.find(p => p.captain)?.player._id;
        viceCaptainId = data.team.find(p => p.viceCaptain)?.player._id;
      }
      
      freeTransfers = data.freeTransfers || 1;
      updateTeamDisplay();
      updateUI();
    }
  } catch (error) {
    console.error('Error loading team:', error);
  }
}
// Position slot click handler
// REPLACE selectPosition function
function selectPosition(position, index) {
  if (transferMode && transferOutPlayer) return;
  currentPosition = position; // 'START' or 'BENCH'
  currentSlotIndex = index;

  const existingPlayer = selectedPlayers.find(p => p.slotPosition === position && p.slotIndex === index);
  if (existingPlayer && !transferMode) {
    showPlayerOptions(existingPlayer);
  } else {
    // Determine position filter based on slot
    let positionFilter = null;
    if (position === 'START') {
      // For starting XI, determine position by row
      if (index === 0) positionFilter = 'GK'; // First slot is GK
      else if (index >= 1 && index <= 4) positionFilter = 'DEF'; // Slots 1-4 are DEF
      else if (index >= 5 && index <= 8) positionFilter = 'MID'; // Slots 5-8 are MID
      else if (index >= 9 && index <= 10) positionFilter = 'FWD'; // Slots 9-10 are FWD
    } else if (position === 'BENCH') {
      // For bench, first slot must be GK, others can be any outfield
      if (index === 0) positionFilter = 'GK';
      // For slots 1-3, we'll filter out GKs in the modal
    }
    openPlayerModal(positionFilter);
  }
}

// REPLACE openPlayerModal function
function openPlayerModal(positionFilter) {
  const modal = document.getElementById('playerModal');
  const modalPosition = document.getElementById('modalPosition');
  
  currentPositionFilter = positionFilter; // Store this globally
  
  if (positionFilter) {
    modalPosition.textContent = positionFilter;
  } else if (currentPosition === 'BENCH' && currentSlotIndex > 0) {
    modalPosition.textContent = 'Outfield (DEF/MID/FWD)';
  } else {
    modalPosition.textContent = 'Any Position';
  }
  
  // Filter players based on position
  let filteredPlayers = [...allPlayers];
  if (positionFilter) {
    filteredPlayers = filteredPlayers.filter(p => p.position === positionFilter);
  } else if (currentPosition === 'BENCH' && currentSlotIndex > 0) {
    // For bench slots 2-4, exclude GKs
    filteredPlayers = filteredPlayers.filter(p => p.position !== 'GK');
  }
  
  displayPlayersInModal(filteredPlayers);
  modal.classList.add('active');
}


// Display players in modal
function displayPlayersInModal(players) {
  const playersList = document.getElementById('playersList');
  const selectedIds = selectedPlayers.map(p => p._id);
  
  playersList.innerHTML = players.map(player => {
    const isSelected = selectedIds.includes(player._id);
    const canAfford = getRemainingBudget() >= player.price || isSelected;
    
    return `
      <div class="player-item ${isSelected ? 'selected' : ''}" 
           onclick="selectPlayer('${player._id}')"
           style="${!canAfford && !isSelected ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
        <div class="player-item-info">
          <div class="player-item-name">${player.name}</div>
          <div class="player-item-details">
            ${player.club?.name || 'No Club'} • ${player.position}
          </div>
        </div>
        <div class="player-item-stats">
          <div class="player-item-price">${player.price}M</div>
          <div class="player-item-points">${player.totalPoints || 0} pts</div>
        </div>
      </div>
    `;
  }).join('');
}

// Filter players in modal
// REPLACE filterPlayersInModal function
function filterPlayersInModal() {
  const searchTerm = document.getElementById('searchPlayer').value.toLowerCase();
  const clubId = document.getElementById('clubFilter').value;
  const sortBy = document.getElementById('sortBy').value;

  let filtered = [...allPlayers];

  // Apply position filter first
  if (currentPositionFilter) {
    filtered = filtered.filter(p => p.position === currentPositionFilter);
  } else if (currentPosition === 'BENCH' && currentSlotIndex > 0) {
    // For bench slots 2-4, exclude GKs
    filtered = filtered.filter(p => p.position !== 'GK');
  }

  // Additional filters
  if (clubId) filtered = filtered.filter(p => p.club?._id === clubId);
  if (searchTerm) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
  }
  
  // Sort
  if (sortBy === 'points') filtered.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  else if (sortBy === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else filtered.sort((a, b) => b.price - a.price);

  displayPlayersInModal(filtered);
}


// Select a player
// REPLACE selectPlayer
// REPLACE the validation section in selectPlayer function (around line 220-240)
function selectPlayer(playerId) {
  const player = allPlayers.find(p => p._id === playerId);
  if (!player) return;

  const existingAtSlot = selectedPlayers.find(p => p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex);
  const alreadyInSquad = selectedPlayers.some(p => p._id === playerId);
  
  if (alreadyInSquad && (!existingAtSlot || existingAtSlot._id !== playerId)) {
    alert('Player already in squad');
    return;
  }

  // Validate bench composition (1 GK + 3 outfield)
  if (currentPosition === 'BENCH') {
    const currentBench = selectedPlayers.filter(p => p.slotPosition === 'BENCH' && p._id !== existingAtSlot?._id);
    const benchGKs = currentBench.filter(p => p.position === 'GK');
    
    if (currentSlotIndex === 0 && player.position !== 'GK') {
      alert('First bench slot must be a goalkeeper');
      return;
    }
    if (currentSlotIndex > 0 && player.position === 'GK') {
      alert('Only one goalkeeper allowed on bench (first slot)');
      return;
    }
    if (player.position === 'GK' && benchGKs.length >= 1) {
      alert('Only one goalkeeper allowed on bench');
      return;
    }
  }

  // Validate starting XI positions
  if (currentPosition === 'START') {
    if (currentSlotIndex === 0 && player.position !== 'GK') {
      alert('First starting slot must be a goalkeeper');
      return;
    }
    if (currentSlotIndex >= 1 && currentSlotIndex <= 4 && player.position !== 'DEF') {
      alert('Slots 2-5 are for defenders only');
      return;
    }
    if (currentSlotIndex >= 5 && currentSlotIndex <= 8 && player.position !== 'MID') {
      alert('Slots 6-9 are for midfielders only');
      return;
    }
    if (currentSlotIndex >= 9 && currentSlotIndex <= 10 && player.position !== 'FWD') {
      alert('Slots 10-11 are for forwards only');
      return;
    }
  }

  // Budget validation
  const currentSpent = selectedPlayers
    .filter(p => !(p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex))
    .reduce((sum, p) => sum + p.price, 0);
  
  if (currentSpent + player.price > totalBudget) {
    alert(`Cannot afford this player. Would exceed budget by ${(currentSpent + player.price - totalBudget).toFixed(1)}M`);
    return;
  }

  // Remove existing player at this slot
  if (existingAtSlot) {
    const index = selectedPlayers.findIndex(p => p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex);
    selectedPlayers.splice(index, 1);
    
    // Clear captain/vice captain if removing them
    if (existingAtSlot._id === captainId) captainId = null;
    if (existingAtSlot._id === viceCaptainId) viceCaptainId = null;
  }

  // Add new player with correct slot assignment
  selectedPlayers.push({
    ...player,
    slotPosition: currentPosition, // 'START' or 'BENCH'
    slotIndex: currentSlotIndex    // 0-10 for START, 0-3 for BENCH
  });

  updateTeamDisplay();
  updateUI();
  closePlayerModal();
}

  // Rest of the function remains the same...
  // (continue with existing budget checks and squad size limits)


// Close player modal
function closePlayerModal() {
  const modal = document.getElementById('playerModal');
  modal.classList.remove('active');
  currentPosition = null;
  currentSlotIndex = null;
}

// Update team display
// REPLACE updateTeamDisplay
// Replace the updateTeamDisplay function in dashboard.js with this updated version
function updateTeamDisplay() {
  document.querySelectorAll('.position-slot').forEach(slot => {
    const pos = slot.dataset.position; // 'START' or 'BENCH'
    const idx = parseInt(slot.dataset.index, 10);
    const player = selectedPlayers.find(p => p.slotPosition === pos && p.slotIndex === idx);

    if (player) {
      slot.classList.add('filled');
      
      // Get position for display - show actual player position instead of "XI" or "SUB"
      const displayPosition = player.position || 'POS';
      
      // Get club short name or first 3 letters of full name
      let clubDisplay = '';
      if (player.club?.shortName) {
        clubDisplay = player.club.shortName;
      } else if (player.club?.name) {
        clubDisplay = player.club.name.substring(0, 3).toUpperCase();
      }
      
      slot.innerHTML = `
        <span class="position-label">${displayPosition}</span>
        ${player._id === captainId ? '<span class="captain-badge">C</span>' : ''}
        ${player._id === viceCaptainId ? '<span class="vice-badge">VC</span>' : ''}
        <div class="player-info">
          <div class="player-name">${player.name}</div>
          <div class="player-club">${clubDisplay}</div>
          <div class="player-points">${player.totalPoints || 0} pts</div>
          <div class="player-price">${player.price}M</div>
        </div>
      `;
    } else {
      slot.classList.remove('filled');
      
      // Determine position label for empty slots
      let positionLabel = '';
      if (pos === 'START') {
        if (idx === 0) positionLabel = 'GK';
        else if (idx >= 1 && idx <= 4) positionLabel = 'DEF';
        else if (idx >= 5 && idx <= 8) positionLabel = 'MID';
        else if (idx >= 9 && idx <= 10) positionLabel = 'FWD';
      } else if (pos === 'BENCH') {
        if (idx === 0) positionLabel = 'GK';
        else positionLabel = 'OUT';
      }
      
      slot.innerHTML = `
        <span class="position-label">${positionLabel}</span>
        <i class="bi bi-plus-circle add-icon"></i>
      `;
    }
  });
}

// Update UI elements
function updateUI() {
  // Update player count
  const playerCount = selectedPlayers.length;
  document.getElementById('selectedCount').textContent = `${playerCount}/15`;
  
  // Update budget
  const budget = getRemainingBudget();
  document.getElementById('budgetRemaining').textContent = `${budget.toFixed(1)}M`;
  
  // Update squad value
  const squadValue = selectedPlayers.reduce((sum, p) => sum + p.price, 0);
  document.getElementById('squadValue').textContent = `${squadValue.toFixed(1)}M`;
  
  // Update budget percentage
  const budgetPercent = (squadValue / totalBudget * 100).toFixed(0);
  document.getElementById('budgetPercent').textContent = `${budgetPercent}%`;
  document.getElementById('valueFill').style.width = `${budgetPercent}%`;
  
  // Update transfers
  document.getElementById('freeTransfers').textContent = freeTransfers;
}

// Get remaining budget
function getRemainingBudget() {
  const spent = selectedPlayers.reduce((sum, p) => sum + p.price, 0);
  return totalBudget - spent;
}

// Toggle transfer mode
function toggleTransferMode(enabled) {
  transferMode = enabled;
  if (!enabled) {
    transferOutPlayer = null;
    updateTeamDisplay();
  }
}

// Save team
async function saveTeam() {
  if (selectedPlayers.length !== 15) {
    alert('You must select exactly 15 players');
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    
    // Create team array - backend expects array of objects with player, captain, viceCaptain
    const team = selectedPlayers.map(p => ({
      player: p._id,
      captain: p._id === captainId,
      viceCaptain: p._id === viceCaptainId
    }));
    
    console.log('Sending team data:', team); // Debug log
    
    const response = await fetch('/api/teams/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ team })
    });
    
    if (response.ok) {
      const result = await response.json();
      alert('Team saved successfully!');
      
      // Reload team data to sync with backend
      await loadUserTeam();
    } else {
      const error = await response.json();
      console.error('Save team error:', error);
      alert(error.error || error.message || 'Failed to save team');
    }
  } catch (error) {
    console.error('Error saving team:', error);
    alert('Failed to save team: ' + error.message);
  }

// Set captains
function saveCaptains() {
  if (selectedPlayers.length === 0) {
    alert('Add players to your team first');
    return;
  }
  
  // Simple captain selection - you might want to create a modal for this
  const captainName = prompt('Enter captain player name:');
  if (!captainName) return;
  
  const captain = selectedPlayers.find(p => 
    p.name.toLowerCase().includes(captainName.toLowerCase())
  );
  
  if (!captain) {
    alert('Player not found');
    return;
  }
  
  const viceName = prompt('Enter vice-captain player name:');
  if (!viceName) return;
  
  const vice = selectedPlayers.find(p => 
    p.name.toLowerCase().includes(viceName.toLowerCase()) && p._id !== captain._id
  );
  
  if (!vice) {
    alert('Player not found or same as captain');
    return;
  }
  
  captainId = captain._id;
  viceCaptainId = vice._id;
  updateTeamDisplay();
  alert('Captains set successfully!');
}
}
// Auto-complete team
// Replace the autoComplete function in dashboard.js with this corrected version
async function autoComplete() {
  selectedPlayers = [];
  let remainingBudget = totalBudget;
  
  // Define slot mapping based on your HTML structure
  const slotMapping = {
    // Starting XI positions
    START: [
      { index: 0, position: 'GK' },     // GK slot
      { index: 1, position: 'DEF' },   // DEF slots
      { index: 2, position: 'DEF' },
      { index: 3, position: 'DEF' },
      { index: 4, position: 'DEF' },
      { index: 5, position: 'MID' },   // MID slots
      { index: 6, position: 'MID' },
      { index: 7, position: 'MID' },
      { index: 8, position: 'MID' },
      { index: 9, position: 'FWD' },   // FWD slots
      { index: 10, position: 'FWD' }
    ],
    // Bench positions
    BENCH: [
      { index: 0, position: 'GK' },    // Bench GK
      { index: 1, position: 'DEF' },   // Bench outfield (can be any position except GK)
      { index: 2, position: 'MID' },   // Bench outfield
      { index: 3, position: 'FWD' }    // Bench outfield
    ]
  };
  
  // Get available players for each position, sorted by points descending
  const getPlayersForPosition = (position) => {
    return allPlayers
      .filter(p => p.position === position)
      .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  };
  
  const availablePlayers = {
    GK: getPlayersForPosition('GK'),
    DEF: getPlayersForPosition('DEF'),
    MID: getPlayersForPosition('MID'),
    FWD: getPlayersForPosition('FWD')
  };
  
  // Track used players
  const usedPlayerIds = new Set();
  
  // Fill starting XI first
  for (const slot of slotMapping.START) {
    const candidates = availablePlayers[slot.position].filter(p => 
      !usedPlayerIds.has(p._id) && p.price <= remainingBudget
    );
    
    if (candidates.length > 0) {
      // Try to find affordable player that leaves reasonable budget for remaining slots
      let selectedPlayer = null;
      const remainingSlots = slotMapping.START.length + slotMapping.BENCH.length - selectedPlayers.length - 1;
      const avgBudgetPerSlot = remainingBudget / (remainingSlots + 1);
      
      // First try to find a player around average budget
      selectedPlayer = candidates.find(p => p.price <= avgBudgetPerSlot * 1.5) || candidates[0];
      
      selectedPlayers.push({
        ...selectedPlayer,
        slotPosition: 'START',
        slotIndex: slot.index
      });
      
      usedPlayerIds.add(selectedPlayer._id);
      remainingBudget -= selectedPlayer.price;
    }
  }
  
  // Fill bench
  for (const slot of slotMapping.BENCH) {
    let candidates;
    
    if (slot.position === 'GK') {
      // Bench GK must be goalkeeper
      candidates = availablePlayers.GK.filter(p => 
        !usedPlayerIds.has(p._id) && p.price <= remainingBudget
      );
    } else {
      // Bench outfield can be DEF, MID, or FWD (prioritize cheaper players)
      candidates = [
        ...availablePlayers.DEF,
        ...availablePlayers.MID,
        ...availablePlayers.FWD
      ]
      .filter(p => !usedPlayerIds.has(p._id) && p.price <= remainingBudget)
      .sort((a, b) => a.price - b.price); // Sort by price ascending for bench
    }
    
    if (candidates.length > 0) {
      const selectedPlayer = candidates[0];
      
      selectedPlayers.push({
        ...selectedPlayer,
        slotPosition: 'BENCH',
        slotIndex: slot.index
      });
      
      usedPlayerIds.add(selectedPlayer._id);
      remainingBudget -= selectedPlayer.price;
    }
  }
  
  // If we couldn't fill all slots due to budget constraints, try cheaper alternatives
  const totalSlotsNeeded = 15;
  if (selectedPlayers.length < totalSlotsNeeded) {
    // Clear and try with budget-friendly approach
    selectedPlayers = [];
    usedPlayerIds.clear();
    remainingBudget = totalBudget;
    
    // Get cheapest players by position
    const cheapestPlayers = {
      GK: availablePlayers.GK.sort((a, b) => a.price - b.price),
      DEF: availablePlayers.DEF.sort((a, b) => a.price - b.price),
      MID: availablePlayers.MID.sort((a, b) => a.price - b.price),
      FWD: availablePlayers.FWD.sort((a, b) => a.price - b.price)
    };
    
    // Fill with cheapest players first
    for (const slot of slotMapping.START) {
      const candidates = cheapestPlayers[slot.position].filter(p => 
        !usedPlayerIds.has(p._id)
      );
      
      if (candidates.length > 0) {
        const selectedPlayer = candidates[0];
        selectedPlayers.push({
          ...selectedPlayer,
          slotPosition: 'START',
          slotIndex: slot.index
        });
        usedPlayerIds.add(selectedPlayer._id);
        remainingBudget -= selectedPlayer.price;
      }
    }
    
    // Fill bench with cheapest available
    for (const slot of slotMapping.BENCH) {
      let candidates;
      
      if (slot.position === 'GK') {
        candidates = cheapestPlayers.GK.filter(p => !usedPlayerIds.has(p._id));
      } else {
        candidates = [
          ...cheapestPlayers.DEF,
          ...cheapestPlayers.MID,
          ...cheapestPlayers.FWD
        ].filter(p => !usedPlayerIds.has(p._id));
      }
      
      if (candidates.length > 0) {
        const selectedPlayer = candidates[0];
        selectedPlayers.push({
          ...selectedPlayer,
          slotPosition: 'BENCH',
          slotIndex: slot.index
        });
        usedPlayerIds.add(selectedPlayer._id);
        remainingBudget -= selectedPlayer.price;
      }
    }
  }
  
  // Update display
  updateTeamDisplay();
  updateUI();
  
  if (selectedPlayers.length < 15) {
    alert(`Auto-complete partially successful. Selected ${selectedPlayers.length}/15 players. You may need to manually select remaining players or adjust budget.`);
  } else {
    alert('Team auto-completed successfully!');
  }
}

// ADD THIS FUNCTION
async function saveLineup() {
  if (selectedPlayers.length !== 15) {
    alert('You must select exactly 15 players first');
    return;
  }

  // Get starting XI (players with slotPosition 'START')
  const starters = selectedPlayers
    .filter(p => p.slotPosition === 'START')
    .sort((a, b) => a.slotIndex - b.slotIndex) // Sort by slot index
    .map(p => p._id);

  // Get bench players (players with slotPosition 'BENCH')  
  const benchPlayers = selectedPlayers
    .filter(p => p.slotPosition === 'BENCH')
    .sort((a, b) => a.slotIndex - b.slotIndex) // Sort by slot index
    .map(p => p._id);

  if (starters.length !== 11) {
    alert(`You must select exactly 11 starters. Currently have ${starters.length}`);
    return;
  }
  
  if (benchPlayers.length !== 4) {
    alert(`You must select exactly 4 bench players. Currently have ${benchPlayers.length}`);
    return;
  }

  console.log('Starting XI:', starters); // Debug log
  console.log('Bench:', benchPlayers); // Debug log

  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/teams/lineup', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        startingXI: starters, 
        benchOrder: benchPlayers 
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      alert('Lineup saved successfully!');
    } else {
      console.error('Lineup save error:', data);
      alert(data.error || 'Failed to save lineup');
    }
  } catch (error) {
    console.error('saveLineup error:', error);
    alert('Error saving lineup: ' + error.message);
  }
}



// Clear team
function clearTeam() {
  if (confirm('Are you sure you want to clear your team?')) {
    selectedPlayers = [];
    captainId = null;
    viceCaptainId = null;
    updateTeamDisplay();
    updateUI();
  }
}

// Show player options (when clicking on filled slot)
function showPlayerOptions(player) {
  if (transferMode) {
    // Mark for transfer out
    transferOutPlayer = player;
    updateTeamDisplay();
    alert(`${player.name} marked for transfer. Select replacement player.`);
  } else {
    // Show options menu (remove, make captain, etc.)
    const options = confirm(`${player.name}\n\nRemove from squad?`);
    if (options) {
      const index = selectedPlayers.findIndex(p => p._id === player._id);
      selectedPlayers.splice(index, 1);
      if (player._id === captainId) captainId = null;
      if (player._id === viceCaptainId) viceCaptainId = null;
      updateTeamDisplay();
      updateUI();
    }
  }
}

// Logout function
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}
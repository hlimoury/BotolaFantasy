// dashboard.js - Complete JavaScript for the new dashboard.ejs

// Global state variables
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
        // Convert team data to selected players
        selectedPlayers = data.team.map(item => ({
          ...item.player,
          slotPosition: item.position,
          slotIndex: item.index,
          isCaptain: item.captain,
          isViceCaptain: item.viceCaptain
        }));
        
        captainId = data.team.find(p => p.captain)?.player._id;
        viceCaptainId = data.team.find(p => p.viceCaptain)?.player._id;
      }
      
      freeTransfers = data.freeTransfers || 1;
      updateTeamDisplay();
    }
  } catch (error) {
    console.error('Error loading team:', error);
  }
}

// Position slot click handler
function selectPosition(position, index) {
  if (transferMode && transferOutPlayer) {
    // In transfer mode, clicking a slot doesn't open modal
    return;
  }
  
  currentPosition = position;
  currentSlotIndex = index;
  
  // Check if slot is already filled
  const existingPlayer = selectedPlayers.find(p => 
    p.slotPosition === position && p.slotIndex === index
  );
  
  if (existingPlayer && !transferMode) {
    // If player exists and not in transfer mode, show options
    showPlayerOptions(existingPlayer);
  } else {
    // Open player selection modal
    openPlayerModal(position);
  }
}

// Open player selection modal
function openPlayerModal(position) {
  const modal = document.getElementById('playerModal');
  const modalPosition = document.getElementById('modalPosition');
  
  modalPosition.textContent = position === 'BENCH' ? 'Substitute' : position;
  
  // Filter players by position
  let filteredPlayers = allPlayers;
  if (position !== 'BENCH') {
    filteredPlayers = allPlayers.filter(p => p.position === position);
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
function filterPlayersInModal() {
  const searchTerm = document.getElementById('searchPlayer').value.toLowerCase();
  const clubId = document.getElementById('clubFilter').value;
  const sortBy = document.getElementById('sortBy').value;
  
  let filtered = allPlayers;
  
  // Filter by position
  if (currentPosition && currentPosition !== 'BENCH') {
    filtered = filtered.filter(p => p.position === currentPosition);
  }
  
  // Filter by search term
  if (searchTerm) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(searchTerm)
    );
  }
  
  // Filter by club
  if (clubId) {
    filtered = filtered.filter(p => p.club?._id === clubId);
  }
  
  // Sort
  switch(sortBy) {
    case 'points':
      filtered.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
      break;
    case 'name':
      filtered.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default: // price
      filtered.sort((a, b) => b.price - a.price);
  }
  
  displayPlayersInModal(filtered);
}

// Select a player
function selectPlayer(playerId) {
  const player = allPlayers.find(p => p._id === playerId);
  if (!player) return;
  
  // Check budget
  const remainingBudget = getRemainingBudget();
  const existingPlayer = selectedPlayers.find(p => 
    p.slotPosition === currentPosition && p.slotIndex === currentSlotIndex
  );
  
  if (!existingPlayer && player.price > remainingBudget) {
    alert('Not enough budget!');
    return;
  }
  
  // Check position limits
  if (!existingPlayer && currentPosition !== 'BENCH') {
    const positionCount = selectedPlayers.filter(p => 
      p.position === currentPosition && p.slotPosition !== 'BENCH'
    ).length;
    
    if (positionCount >= POSITION_LIMITS[currentPosition]) {
      alert(`Maximum ${POSITION_LIMITS[currentPosition]} ${currentPosition} players allowed`);
      return;
    }
  }
  
  // Check for duplicates
  if (selectedPlayers.some(p => p._id === playerId)) {
    alert('Player already in squad');
    return;
  }
  
  // Remove existing player if any
  if (existingPlayer) {
    const index = selectedPlayers.findIndex(p => 
      p._id === existingPlayer._id
    );
    selectedPlayers.splice(index, 1);
  }
  
  // Add new player
  selectedPlayers.push({
    ...player,
    slotPosition: currentPosition,
    slotIndex: currentSlotIndex
  });
  
  closePlayerModal();
  updateTeamDisplay();
  updateUI();
}

// Close player modal
function closePlayerModal() {
  const modal = document.getElementById('playerModal');
  modal.classList.remove('active');
  currentPosition = null;
  currentSlotIndex = null;
}

// Update team display
function updateTeamDisplay() {
  // Clear all slots first
  document.querySelectorAll('.position-slot').forEach(slot => {
    const position = slot.dataset.position;
    const index = parseInt(slot.dataset.index);
    
    const player = selectedPlayers.find(p => 
      p.slotPosition === position && p.slotIndex === index
    );
    
    if (player) {
      slot.classList.add('filled');
      slot.innerHTML = `
        <span class="position-label">${position === 'BENCH' ? 'SUB' : player.position}</span>
        ${player._id === captainId ? '<span class="captain-badge">C</span>' : ''}
        ${player._id === viceCaptainId ? '<span class="vice-badge">VC</span>' : ''}
        ${transferOutPlayer?._id === player._id ? '<div class="transfer-out"></div>' : ''}
        <div class="player-info">
          <div class="player-name">${player.name}</div>
          <div class="player-price">${player.price}M</div>
          <div class="player-club">${player.club?.shortName || player.club?.name || ''}</div>
        </div>
      `;
    } else {
      slot.classList.remove('filled');
      slot.innerHTML = `
        <span class="position-label">${position === 'BENCH' ? 'SUB' : position}</span>
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
    const team = selectedPlayers.map(p => ({
      player: p._id,
      position: p.slotPosition,
      index: p.slotIndex,
      captain: p._id === captainId,
      viceCaptain: p._id === viceCaptainId
    }));
    
    const response = await fetch('/api/teams/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ team })
    });
    
    if (response.ok) {
      alert('Team saved successfully!');
    } else {
      const error = await response.json();
      alert(error.message || 'Failed to save team');
    }
  } catch (error) {
    console.error('Error saving team:', error);
    alert('Failed to save team');
  }
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

// Auto-complete team
async function autoComplete() {
  // Basic auto-complete logic
  const positions = ['GK', 'DEF', 'MID', 'FWD'];
  const requirements = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  
  selectedPlayers = [];
  let remainingBudget = totalBudget;
  
  for (const pos of positions) {
    const needed = requirements[pos];
    const available = allPlayers
      .filter(p => p.position === pos && p.price <= remainingBudget / 2)
      .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
    
    for (let i = 0; i < needed && i < available.length; i++) {
      const player = available[i];
      if (player.price <= remainingBudget) {
        selectedPlayers.push({
          ...player,
          slotPosition: pos,
          slotIndex: i
        });
        remainingBudget -= player.price;
      }
    }
  }
  
  updateTeamDisplay();
  updateUI();
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
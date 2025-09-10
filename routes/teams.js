// routes/teams.js
const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const Player = require('../models/Player');
const Gameweek = require('../models/Gameweek');

const router = express.Router();

const LIMITS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const TEAM_SIZE = 15;
const STARTERS = 11;
const BENCH = 4;
const BUDGET_CAP = 100;
const EXTRA_TRANSFER_COST = 4;

// Helpers
async function getActiveGameweek() {
  return await Gameweek.findOne({ isActive: true }).sort({ weekNumber: 1 });
}
function isLocked(deadline) {
  if (!deadline) return false;
  return Date.now() >= new Date(deadline).getTime();
}
async function computeTeamCost(playerIds) {
  const players = await Player.find({ _id: { $in: playerIds } });
  return players.reduce((sum, p) => sum + (p.price || 0), 0);
}
async function getPositionsCount(playerIds) {
  const players = await Player.find({ _id: { $in: playerIds } }).select('position');
  const cnt = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of players) cnt[p.position] = (cnt[p.position] || 0) + 1;
  return cnt;
}
function unique(arr) {
  return Array.from(new Set(arr.map(x => String(x)))).map(x => arr.find(y => String(y) === x));
}

// ROUTES

// Status: active GW + lock state
router.get('/status', authMiddleware, async (req, res) => {
  const gw = await getActiveGameweek();
  if (!gw) return res.json({ isActive: false, locked: false, deadline: null, weekNumber: null });
  const locked = isLocked(gw.deadline || gw.startDate);
  res.json({
    isActive: true,
    locked,
    deadline: gw.deadline || gw.startDate || null,
    weekNumber: gw.weekNumber,
    roundLabel: gw.roundLabel || `Regular Season - ${gw.weekNumber}`
  });
});

// Get my team
router.get('/my-team', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName logo' } });
  
  // Sort team: starting XI first, then bench
  let sortedTeam = [];
  
  // Add starting XI in order
  if (user.startingXI && user.startingXI.length > 0) {
    for (const playerId of user.startingXI) {
      const slot = user.team.find(s => String(s.player._id) === String(playerId));
      if (slot) sortedTeam.push(slot);
    }
  }
  
  // Add bench in order
  if (user.benchOrder && user.benchOrder.length > 0) {
    for (const playerId of user.benchOrder) {
      const slot = user.team.find(s => String(s.player._id) === String(playerId));
      if (slot && !sortedTeam.includes(slot)) sortedTeam.push(slot);
    }
  }
  
  // Add any remaining players not in lineup
  for (const slot of user.team) {
    if (!sortedTeam.includes(slot)) sortedTeam.push(slot);
  }
  
  res.json({
    team: sortedTeam.length > 0 ? sortedTeam : user.team,
    startingXI: user.startingXI || [],
    benchOrder: user.benchOrder || [],
    budget: user.budget,
    totalPoints: user.totalPoints,
    freeTransfers: user.freeTransfers ?? 1,
    transfersMadeThisGW: user.transfersMadeThisGW ?? 0
  });
});

// Save/Update full squad (15 players)
// In routes/teams.js, replace the /save route with this:
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { team } = req.body;
    if (!Array.isArray(team) || team.length !== TEAM_SIZE) {
      return res.status(400).json({ error: `You must select exactly ${TEAM_SIZE} players` });
    }
    
    const gw = await getActiveGameweek();
    if (gw && isLocked(gw.deadline || gw.startDate)) {
      return res.status(403).json({ error: 'Transfers are locked for the active Gameweek' });
    }

    // Validate players exist and counts
    const playerIds = team.map(t => t.player);
    const uniqueIds = [...new Set(playerIds.map(String))];
    if (uniqueIds.length !== TEAM_SIZE) {
      return res.status(400).json({ error: 'Duplicate players are not allowed' });
    }

    const posCount = await getPositionsCount(playerIds);
    for (const k of Object.keys(LIMITS)) {
      if (posCount[k] !== LIMITS[k]) {
        return res.status(400).json({ error: `Team must have exactly ${LIMITS[k]} ${k}` });
      }
    }

    const totalCost = await computeTeamCost(playerIds);
    if (totalCost > BUDGET_CAP) {
      return res.status(400).json({ error: `Team cost (${totalCost}M) exceeds budget limit (${BUDGET_CAP}M)` });
    }

    const user = await User.findById(req.user._id);
    
    // Store old lineup before updating team
    const oldStartingXI = user.startingXI || [];
    const oldBenchOrder = user.benchOrder || [];
    
    user.team = team.map(t => ({ player: t.player, captain: !!t.captain, viceCaptain: !!t.viceCaptain }));
    
    // Ensure only one captain and one vice
    let capSet = false, viceSet = false;
    user.team.forEach(s => {
      if (s.captain && !capSet) capSet = true; else s.captain = false;
      if (s.viceCaptain && !viceSet) viceSet = true; else s.viceCaptain = false;
    });

    user.budget = BUDGET_CAP - totalCost;

    // Only reset lineup if players have changed
    const newPlayerIds = playerIds.map(String).sort();
    const oldPlayerIds = user.team.map(s => String(s.player)).sort();
    const playersChanged = JSON.stringify(newPlayerIds) !== JSON.stringify(oldPlayerIds);
    
    if (playersChanged) {
      // Players changed, reset lineup
      user.startingXI = [];
      user.benchOrder = [];
    } else {
      // Keep existing valid lineup
      const validStartingXI = oldStartingXI.filter(id => playerIds.includes(String(id)));
      const validBenchOrder = oldBenchOrder.filter(id => playerIds.includes(String(id)));
      
      if (validStartingXI.length === 11 && validBenchOrder.length === 4) {
        user.startingXI = validStartingXI;
        user.benchOrder = validBenchOrder;
      } else {
        user.startingXI = [];
        user.benchOrder = [];
      }
    }
    
    await user.save();

    res.json({ 
      message: 'Team saved', 
      budget: user.budget,
      lineupPreserved: !playersChanged && user.startingXI.length > 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save lineup (starting XI + bench order)
// REPLACE /lineup route
router.post('/lineup', authMiddleware, async (req, res) => {
  try {
    const { startingXI, benchOrder } = req.body;
    if (!Array.isArray(startingXI) || startingXI.length !== 11) {
      return res.status(400).json({ error: 'Starting XI must have exactly 11 players' });
    }
    if (!Array.isArray(benchOrder) || benchOrder.length !== 4) {
      return res.status(400).json({ error: 'Bench must have exactly 4 players' });
    }

    const gw = await Gameweek.findOne({ isActive: true });
    const locked = gw && gw.deadline ? (Date.now() >= new Date(gw.deadline).getTime()) : false;
    if (locked) return res.status(403).json({ error: 'Lineup changes are locked for the active Gameweek' });

    const user = await User.findById(req.user._id);
    const teamIds = user.team.map(s => String(s.player));
    const all = [...startingXI, ...benchOrder].map(String);
    if (new Set(all).size !== 15) return res.status(400).json({ error: 'Lineup must include all 15 squad players exactly once' });
    for (const pid of all) {
      if (!teamIds.includes(pid)) return res.status(400).json({ error: 'Lineup contains players not in your squad' });
    }

    // Clear flags
    user.team.forEach(s => { s.starting = false; s.benchOrder = null; });

    // Apply starters
    for (const pid of startingXI) {
      const slot = user.team.find(s => String(s.player) === String(pid));
      if (slot) slot.starting = true;
    }
    // Apply bench order 1..4
    benchOrder.forEach((pid, i) => {
      const slot = user.team.find(s => String(s.player) === String(pid));
      if (slot) slot.benchOrder = i + 1;
    });

    await user.save();
    res.json({ message: 'Lineup saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Save captains (captain + vice)
router.post('/captains', authMiddleware, async (req, res) => {
  try {
    const { captainId, viceCaptainId } = req.body;
    const user = await User.findById(req.user._id);
    const teamIds = user.team.map(s => String(s.player));

    if (!teamIds.includes(String(captainId)) || !teamIds.includes(String(viceCaptainId))) {
      return res.status(400).json({ error: 'Captain and Vice must be in your squad' });
    }
    if (String(captainId) === String(viceCaptainId)) {
      return res.status(400).json({ error: 'Captain and Vice must be different players' });
    }

    user.team.forEach(s => {
      s.captain = String(s.player) === String(captainId);
      s.viceCaptain = String(s.player) === String(viceCaptainId);
    });
    await user.save();
    res.json({ message: 'Captains saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Make a single transfer (out -> in)
router.post('/transfer', authMiddleware, async (req, res) => {
  try {
    const { outPlayerId, inPlayerId } = req.body;
    if (!outPlayerId || !inPlayerId) return res.status(400).json({ error: 'outPlayerId and inPlayerId are required' });
    if (String(outPlayerId) === String(inPlayerId)) return res.status(400).json({ error: 'Select a different player to transfer in' });

    const gw = await getActiveGameweek();
    if (gw && isLocked(gw.deadline || gw.startDate)) {
      return res.status(403).json({ error: 'Transfers are locked for the active Gameweek' });
    }

    const [outP, inP] = await Promise.all([
      Player.findById(outPlayerId),
      Player.findById(inPlayerId)
    ]);
    if (!outP || !inP) return res.status(404).json({ error: 'Player not found' });

    const user = await User.findById(req.user._id);
    const idx = user.team.findIndex(s => String(s.player) === String(outPlayerId));
    if (idx === -1) return res.status(400).json({ error: 'The player to transfer out is not in your squad' });

    // Build new squad ids
    const currentIds = user.team.map(s => String(s.player));
    const newIds = currentIds.filter(id => id !== String(outPlayerId));
    if (newIds.includes(String(inPlayerId))) return res.status(400).json({ error: 'The player to transfer in is already in your squad' });
    newIds.push(String(inPlayerId));

    // Validate position limits remain
    const posCount = await getPositionsCount(newIds);
    for (const k of Object.keys(LIMITS)) {
      if (posCount[k] !== LIMITS[k]) {
        return res.status(400).json({ error: `Transfer breaks squad limits (${k}: ${posCount[k]}/${LIMITS[k]})` });
      }
    }

    // Validate budget
    const newCost = await computeTeamCost(newIds);
    if (newCost > BUDGET_CAP) {
      return res.status(400).json({ error: `Transfer exceeds budget (${newCost}M > ${BUDGET_CAP}M)` });
    }

    // Apply transfer
    const wasCaptain = user.team[idx].captain;
    const wasVice = user.team[idx].viceCaptain;
    user.team.splice(idx, 1);
    user.team.push({ player: inP._id, captain: false, viceCaptain: false });

    // If out was captain/vice, clear them and require re-set later
    if (wasCaptain || wasVice) {
      user.team.forEach(s => { s.captain = false; s.viceCaptain = false; });
    }

    // Budget update
    user.budget = BUDGET_CAP - newCost;

    // Transfer cost logic
    let cost = 0;
    if ((user.freeTransfers ?? 1) > 0) {
      user.freeTransfers = (user.freeTransfers ?? 1) - 1;
    } else {
      cost = EXTRA_TRANSFER_COST;
      // Apply cost to current GW weekly points immediately
      if (gw) {
        const wIdx = user.weeklyPoints.findIndex(w => w.gameweek === gw.weekNumber);
        if (wIdx >= 0) {
          user.weeklyPoints[wIdx].points -= cost;
          user.weeklyPoints[wIdx].transferCost = (user.weeklyPoints[wIdx].transferCost || 0) + cost;
        } else {
          user.weeklyPoints.push({ gameweek: gw.weekNumber, points: -cost, transferCost: cost });
        }
        // Recalculate total
        user.totalPoints = user.weeklyPoints.reduce((a, w) => a + (w.points || 0), 0);
      }
    }
    user.transfersMadeThisGW = (user.transfersMadeThisGW || 0) + 1;

    user.transferHistory.push({
      in: inP._id,
      out: outP._id,
      gameweek: gw ? gw.weekNumber : null,
      cost
    });

    await user.save();

    // Return updated team
    const updated = await User.findById(user._id)
      .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName logo' } });

    res.json({
      message: `Transfer completed${cost ? ` (-${cost} pts)` : ''}`,
      team: updated.team,
      budget: updated.budget,
      freeTransfers: updated.freeTransfers,
      transfersMadeThisGW: updated.transfersMadeThisGW
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Clear my team
router.post('/clear', authMiddleware, async (req, res) => {
  const gw = await getActiveGameweek();
  if (gw && isLocked(gw.deadline || gw.startDate)) {
    return res.status(403).json({ error: 'Transfers are locked for the active Gameweek' });
  }
  const user = await User.findById(req.user._id);
  user.team = [];
  user.startingXI = [];
  user.benchOrder = [];
  user.budget = BUDGET_CAP;
  await user.save();
  res.json({ message: 'Team cleared' });
});

module.exports = router;

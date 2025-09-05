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
    .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName logo' } })
    .populate('startingXI benchOrder');
  res.json({
    team: user.team,
    startingXI: user.startingXI || [],
    benchOrder: user.benchOrder || [],
    budget: user.budget,
    totalPoints: user.totalPoints,
    freeTransfers: user.freeTransfers ?? 1,
    transfersMadeThisGW: user.transfersMadeThisGW ?? 0
  });
});

// Save/Update full squad (15 players)
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { team } = req.body; // [{ player: id, captain, viceCaptain }]
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
    user.team = team.map(t => ({ player: t.player, captain: !!t.captain, viceCaptain: !!t.viceCaptain }));
    // Ensure only one captain and one vice in data
    let capSet = false, viceSet = false;
    user.team.forEach(s => {
      if (s.captain && !capSet) capSet = true; else s.captain = false;
      if (s.viceCaptain && !viceSet) viceSet = true; else s.viceCaptain = false;
    });

    user.budget = BUDGET_CAP - totalCost;

    // Reset lineup as needed if now invalid
    user.startingXI = [];
    user.benchOrder = [];
    await user.save();

    res.json({ message: 'Team saved', budget: user.budget });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save lineup (starting XI + bench order)
router.post('/lineup', authMiddleware, async (req, res) => {
  try {
    const { startingXI, benchOrder } = req.body;
    if (!Array.isArray(startingXI) || startingXI.length !== STARTERS) {
      return res.status(400).json({ error: `Starting XI must have exactly ${STARTERS} players` });
    }
    if (!Array.isArray(benchOrder) || benchOrder.length !== BENCH) {
      return res.status(400).json({ error: `Bench must have exactly ${BENCH} players` });
    }
    const gw = await getActiveGameweek();
    if (gw && isLocked(gw.deadline || gw.startDate)) {
      return res.status(403).json({ error: 'Lineup changes are locked for the active Gameweek' });
    }

    const user = await User.findById(req.user._id).populate('team.player');
    const teamIds = user.team.map(s => String(s.player));
    const all = [...startingXI.map(String), ...benchOrder.map(String)];
    if (new Set(all).size !== TEAM_SIZE) {
      return res.status(400).json({ error: 'Lineup + bench must contain each squad player exactly once' });
    }
    for (const pid of all) {
      if (!teamIds.includes(String(pid))) {
        return res.status(400).json({ error: 'Lineup contains players not in squad' });
      }
    }
    // Ensure at least 1 GK among starters
    const startersPlayers = await Player.find({ _id: { $in: startingXI } }).select('position');
    const gkStarters = startersPlayers.filter(p => p.position === 'GK').length;
    if (gkStarters < 1) return res.status(400).json({ error: 'Starting XI must include at least 1 goalkeeper' });

    user.startingXI = startingXI;
    user.benchOrder = benchOrder;
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

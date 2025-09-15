const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const Player = require('../models/Player');
const Gameweek = require('../models/Gameweek');
const Match = require('../models/Match');

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

// Get my team (sorted: XI then bench if stored)
// Get my team (sorted: XI then bench if stored)
router.get('/my-team', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName logo' } })
    .populate('startingXI benchOrder');

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Create a sorted view based on saved lineup (if any)
  const team = Array.isArray(user.team) ? user.team : [];

  let sortedTeam = [];
  const xiIds = (user.startingXI || []).map(p => String(p._id || p));
  const benchIds = (user.benchOrder || []).map(p => String(p._id || p));

  if (xiIds.length) {
    for (const pid of xiIds) {
      const slot = team.find(s => String(s.player?._id) === pid);
      if (slot) sortedTeam.push(slot);
    }
  }
  if (benchIds.length) {
    for (const pid of benchIds) {
      const slot = team.find(s => String(s.player?._id) === pid);
      if (slot && !sortedTeam.includes(slot)) sortedTeam.push(slot);
    }
  }
  for (const slot of team) {
    if (!sortedTeam.includes(slot)) sortedTeam.push(slot);
  }

  // Sort weeklyPoints ascending by gameweek for UI
  const weeklyPointsSorted = (user.weeklyPoints || []).slice().sort((a, b) => a.gameweek - b.gameweek);

  res.json({
    team: sortedTeam.length > 0 ? sortedTeam : team,
    startingXI: user.startingXI || [],
    benchOrder: user.benchOrder || [],
    budget: user.budget,
    totalPoints: user.totalPoints,          // Career/season total
    weeklyPoints: weeklyPointsSorted,       // ADD THIS
    freeTransfers: user.freeTransfers ?? 1,
    transfersMadeThisGW: user.transfersMadeThisGW ?? 0
  });
});

// Save full squad (15 players)
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
    const prevIds = (user.team || []).map(s => String(s.player)).sort();
    const newIds = playerIds.map(String).sort();
    const playersChanged = JSON.stringify(prevIds) !== JSON.stringify(newIds);

    user.team = team.map(t => ({ player: t.player, captain: !!t.captain, viceCaptain: !!t.viceCaptain }));

    // Ensure only one C and one VC
    let capSet = false, vcSet = false;
    user.team.forEach(s => {
      if (s.captain && !capSet) capSet = true; else s.captain = false;
      if (s.viceCaptain && !vcSet) vcSet = true; else s.viceCaptain = false;
    });

    user.budget = BUDGET_CAP - totalCost;

    // Reset lineup only if players changed
    if (playersChanged) {
      user.startingXI = [];
      user.benchOrder = [];
    }

    await user.save();

    res.json({
      message: 'Team saved',
      budget: user.budget,
      lineupPreserved: !playersChanged && user.startingXI.length === 11 && user.benchOrder.length === 4
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save lineup (XI + bench order)
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

    const user = await User.findById(req.user._id);
    const teamIds = user.team.map(s => String(s.player));
    const all = [...startingXI, ...benchOrder].map(String);
    if (new Set(all).size !== TEAM_SIZE) {
      return res.status(400).json({ error: 'Lineup must include your 15 squad players exactly once' });
    }
    for (const pid of all) {
      if (!teamIds.includes(pid)) {
        return res.status(400).json({ error: 'Lineup contains players not in your squad' });
      }
    }

    user.startingXI = startingXI;
    user.benchOrder = benchOrder;
    await user.save();
    res.json({ message: 'Lineup saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save captains
router.post('/captains', authMiddleware, async (req, res) => {
  try {
    const { captainId, viceCaptainId } = req.body;
    if (!captainId || !viceCaptainId) return res.status(400).json({ error: 'Both captainId and viceCaptainId are required' });
    if (String(captainId) === String(viceCaptainId)) return res.status(400).json({ error: 'Captain and Vice must be different' });

    const user = await User.findById(req.user._id);
    const teamIds = user.team.map(s => String(s.player));
    if (!teamIds.includes(String(captainId)) || !teamIds.includes(String(viceCaptainId))) {
      return res.status(400).json({ error: 'Captain and Vice must be in your squad' });
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

// Single transfer (decrements freeTransfers and/or applies -4)
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
    if (idx === -1) return res.status(400).json({ error: 'The outgoing player is not in your squad' });

    const currentIds = user.team.map(s => String(s.player));
    const newIds = currentIds.filter(id => id !== String(outPlayerId));
    if (newIds.includes(String(inPlayerId))) return res.status(400).json({ error: 'Incoming player is already in your squad' });
    newIds.push(String(inPlayerId));

    // Validate position limits
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

// 1) Update saved lineup arrays so the change persists on the pitch:
//    If the outgoing player is in startingXI or benchOrder, replace with incoming at the same index.
if (Array.isArray(user.startingXI) && user.startingXI.length) {
  const xiIdx = user.startingXI.findIndex(p => String(p) === String(outPlayerId));
  if (xiIdx >= 0) {
    user.startingXI[xiIdx] = inP._id; // keep slot, replace id
  }
}
if (Array.isArray(user.benchOrder) && user.benchOrder.length) {
  const bIdx = user.benchOrder.findIndex(p => String(p) === String(outPlayerId));
  if (bIdx >= 0) {
    user.benchOrder[bIdx] = inP._id;
  }
}

// 2) Update squad list
user.team.splice(idx, 1);
user.team.push({ player: inP._id, captain: false, viceCaptain: false });

if (wasCaptain || wasVice) {
  user.team.forEach(s => { s.captain = false; s.viceCaptain = false; });
}

// 3) Budget update
user.budget = BUDGET_CAP - newCost;

// 4) Transfer costs (APPLY −4 IMMEDIATELY to the CURRENT ACTIVE GW if exists)
let cost = 0;

if ((user.freeTransfers ?? 1) > 0) {
  // Consume one free transfer
  user.freeTransfers = (user.freeTransfers ?? 1) - 1;
  res.locals._penaltyAppliedTo = 'none';
} else {
  // Extra transfer => costs -4
  cost = EXTRA_TRANSFER_COST;

  if (gw) {
    // Apply penalty to CURRENT active gameweek now
    user.weeklyPoints = user.weeklyPoints || [];
    const wIdx = user.weeklyPoints.findIndex(w => w.gameweek === gw.weekNumber);
    if (wIdx >= 0) {
      user.weeklyPoints[wIdx].points = (user.weeklyPoints[wIdx].points || 0) - cost;
      user.weeklyPoints[wIdx].transferCost = (user.weeklyPoints[wIdx].transferCost || 0) + cost;
    } else {
      user.weeklyPoints.push({ gameweek: gw.weekNumber, points: -cost, transferCost: cost });
    }
    // Update season total now
    user.totalPoints = user.weeklyPoints.reduce((a, w) => a + (w.points || 0), 0);
    res.locals._penaltyAppliedTo = 'current';
  } else {
    // No active GW; carry to next activation if needed
    user.pendingTransferPenalty = (user.pendingTransferPenalty || 0) + cost;
    res.locals._penaltyAppliedTo = 'next';
  }
}

user.transfersMadeThisGW = (user.transfersMadeThisGW || 0) + 1;
user.transferHistory = user.transferHistory || [];
user.transferHistory.push({
  in: inP._id,
  out: outP._id,
  gameweek: gw ? gw.weekNumber : null,
  cost
});

await user.save();

    // Return updated
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

// Build default XI (1 GK, 4 DEF, 4 MID, 2 FWD) + bench order (GK first then outfield)
async function buildDefaultLineup(user) {
  const ids = user.team.map(s => String(s.player));
  const docs = await Player.find({ _id: { $in: ids } }).select('position');
  const byPos = {
    GK: docs.filter(p => p.position === 'GK').map(p => String(p._id)),
    DEF: docs.filter(p => p.position === 'DEF').map(p => String(p._id)),
    MID: docs.filter(p => p.position === 'MID').map(p => String(p._id)),
    FWD: docs.filter(p => p.position === 'FWD').map(p => String(p._id))
  };

  const xi = [];
  if (byPos.GK[0]) xi.push(byPos.GK[0]);
  xi.push(...byPos.DEF.slice(0, 4));
  xi.push(...byPos.MID.slice(0, 4));
  xi.push(...byPos.FWD.slice(0, 2));
  // pad if missing
  const remaining = [...byPos.GK.slice(1), ...byPos.DEF.slice(4), ...byPos.MID.slice(4), ...byPos.FWD.slice(2)];
  while (xi.length < 11 && remaining.length) xi.push(remaining.shift());

  // bench: GK second then top 3 remaining outfield
  const bench = [];
  if (byPos.GK[1]) bench.push(byPos.GK[1]);
  const remOut = [...byPos.DEF.slice(4), ...byPos.MID.slice(4), ...byPos.FWD.slice(2)];
  while (bench.length < 4 && remOut.length) bench.push(remOut.shift());

  return { xi: xi.slice(0, 11), bench: bench.slice(0, 4) };
}

// GET per-player Active GW points + team live total (with autosubs and C/VC)
// Subtracts current GW transfer hit (weeklyPoints.transferCost) from teamTotal
router.get('/gw-points', authMiddleware, async (req, res) => {
  try {
    const gw = await getActiveGameweek();
    if (!gw) return res.json({ weekNumber: null, perPlayer: {}, teamTotal: 0, locked: false });

    // Aggregate per-player points/minutes for this GW
    const matches = await Match.find({ gameweek: gw._id }).lean();
    const perPoints = new Map(); // pid -> points
    const perMinutes = new Map(); // pid -> minutes

    for (const m of matches) {
      for (const perf of (m.playerPerformances || [])) {
        const id = String(perf.player);
        perPoints.set(id, (perPoints.get(id) || 0) + Number(perf.points || 0));
        perMinutes.set(id, (perMinutes.get(id) || 0) + Number(perf.minutesPlayed || 0));
      }
    }

    const user = await User.findById(req.user._id).populate('team.player startingXI benchOrder');
    if (!user || !user.team || user.team.length === 0) {
      return res.json({
        weekNumber: gw.weekNumber,
        perPlayer: Object.fromEntries(perPoints.entries()),
        teamTotal: 0,
        locked: isLocked(gw.deadline || gw.startDate),
        transferCost: 0
      });
    }

    // Build XI/bench (fallback 1-4-4-2)
    let xi = (user.startingXI || []).map(p => String(p._id || p));
    let bench = (user.benchOrder || []).map(p => String(p._id || p));
    if (xi.length !== 11 || bench.length !== 4) {
      const ids = user.team.map(t => String(t.player._id || t.player));
      const docs = await Player.find({ _id: { $in: ids } }).select('position');
      const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
      docs.forEach(d => byPos[d.position].push(String(d._id)));
      const tmp = [];
      const take = (arr, n) => tmp.push(...arr.slice(0, n));
      take(byPos.GK, 1); take(byPos.DEF, 4); take(byPos.MID, 4); take(byPos.FWD, 2);
      xi = tmp.slice(0, 11);
      const rest = ids.filter(id => !new Set(xi).has(id));
      const outfield = rest.filter(id => !byPos.GK.includes(id));
      const gks = rest.filter(id => byPos.GK.includes(id));
      bench = [gks[0], outfield[0], outfield[1], outfield[2]].filter(Boolean).slice(0, 4);
    }

    // Autosubs by minutes only (you may have another version that checks injured/suspended; keep that one instead)
    const minutesOf = (pid) => perMinutes.get(String(pid)) || 0;

    // GK autosub
    const xiDocs = await Player.find({ _id: { $in: xi } }).select('position');
    const posMap = new Map(xiDocs.map(p => [String(p._id), p.position]));
    const gkIdx = xi.findIndex(id => posMap.get(String(id)) === 'GK');
    const benchDocs = await Player.find({ _id: { $in: bench } }).select('position');
    const benchPos = new Map(benchDocs.map(p => [String(p._id), p.position]));
    if (gkIdx >= 0 && minutesOf(xi[gkIdx]) === 0 && bench[0] && benchPos.get(String(bench[0])) === 'GK' && minutesOf(bench[0]) > 0) {
      xi[gkIdx] = bench[0];
    }

    // Outfield subs
    const outfieldBench = bench.slice(1).filter(id => benchPos.get(String(id)) !== 'GK' && minutesOf(id) > 0);
    for (let i = 0; i < xi.length; i++) {
      const id = String(xi[i]);
      const pos = posMap.get(id);
      if (pos === 'GK') continue;
      if (minutesOf(id) === 0 && outfieldBench.length) {
        xi[i] = outfieldBench.shift();
      }
    }

    // Sum XI; C/VC
    const teamCap = user.team.find(t => t.captain)?.player?._id || user.team.find(t => t.captain)?.player;
    const teamVc = user.team.find(t => t.viceCaptain)?.player?._id || user.team.find(t => t.viceCaptain)?.player;
    const xiSet = new Set(xi.map(String));
    const ptsOf = (id) => perPoints.get(String(id)) || 0;

    let total = 0;
    xiSet.forEach(id => total += ptsOf(id));
    if (teamCap && xiSet.has(String(teamCap)) && minutesOf(String(teamCap)) > 0) total += ptsOf(String(teamCap));
    else if (teamVc && xiSet.has(String(teamVc)) && minutesOf(String(teamVc)) > 0) total += ptsOf(String(teamVc));

    // SUBTRACT current GW transfer hit
    const w = (user.weeklyPoints || []).find(w => w.gameweek === gw.weekNumber);
    const transferCost = Number(w?.transferCost || 0);
    total -= transferCost;

    const locked = isLocked(gw.deadline || gw.startDate);
    return res.json({
      weekNumber: gw.weekNumber,
      perPlayer: Object.fromEntries(perPoints.entries()),
      teamTotal: total,
      transferCost,
      locked
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
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

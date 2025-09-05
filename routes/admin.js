// routes/admin.js
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const Club = require('../models/Club');
const Player = require('../models/Player');
const Match = require('../models/Match');
const Gameweek = require('../models/Gameweek');
const User = require('../models/User');
const { syncClubs, syncPlayers, syncFixturesAndGameweeks, syncCompletedFixturesAndPoints, processCompletedFixture, recalcAllUserPoints, finalizeGameweek, finalizeGameweeksIfReady } = require('../services/sync');
const { computePoints } = require('../services/scoring');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// Manual sync triggers
router.post('/sync/clubs', async (_req, res) => { await syncClubs(); res.json({ message: 'Clubs synced' }); });
router.post('/sync/players', async (_req, res) => { await syncPlayers(); res.json({ message: 'Players synced' }); });
router.post('/sync/fixtures', async (_req, res) => { await syncFixturesAndGameweeks(); res.json({ message: 'Fixtures & gameweeks synced' }); });
router.post('/sync/results', async (_req, res) => { await syncCompletedFixturesAndPoints(); res.json({ message: 'Completed fixtures processed' }); });
router.post('/recalculate', async (_req, res) => { await recalcAllUserPoints(); res.json({ message: 'All points recalculated' }); });

// CRUD: Clubs
router.get('/clubs', async (_req, res) => { const clubs = await Club.find().sort({ name: 1 }); res.json(clubs); });
router.put('/clubs/:id', async (req, res) => { const club = await Club.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json(club); });

// CRUD: Players
router.get('/players', async (_req, res) => {
  const players = await Player.find().populate('club', 'name shortName');
  res.json(players);
});
router.post('/players', async (req, res) => { const player = new Player(req.body); await player.save(); res.status(201).json(player); });
router.put('/players/:id', async (req, res) => { const player = await Player.findByIdAndUpdate(req.params.id, req.body, { new: true }); res.json(player); });
router.delete('/players/:id', async (req, res) => { await Player.findByIdAndDelete(req.params.id); res.json({ message: 'Player deleted' }); });

// CRUD: Gameweeks
router.get('/gameweeks', async (_req, res) => { const gws = await Gameweek.find().sort({ weekNumber: 1 }); res.json(gws); });
router.post('/gameweeks', async (req, res) => {
  const { weekNumber, roundLabel, startDate, endDate, deadline } = req.body;
  const gw = new Gameweek({
    weekNumber,
    roundLabel: roundLabel || `Regular Season - ${weekNumber}`,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    deadline: deadline ? new Date(deadline) : (startDate ? new Date(startDate) : null),
    isActive: false
  });
  await gw.save();
  res.status(201).json(gw);
});
router.put('/gameweeks/:id', async (req, res) => {
  const payload = { ...req.body };
  ['startDate', 'endDate', 'deadline'].forEach(f => { if (payload[f]) payload[f] = new Date(payload[f]); });
  const gw = await Gameweek.findByIdAndUpdate(req.params.id, payload, { new: true });
  res.json(gw);
});
router.delete('/gameweeks/:id', async (req, res) => {
  const gw = await Gameweek.findById(req.params.id);
  if (!gw) return res.status(404).json({ error: 'Gameweek not found' });
  await Match.updateMany({ gameweek: gw._id }, { $unset: { gameweek: "" } });
  await Gameweek.findByIdAndDelete(gw._id);
  res.json({ message: 'Gameweek deleted' });
});
router.put('/gameweeks/:id/activate', async (req, res) => {
  await Gameweek.updateMany({}, { isActive: false });
  const gw = await Gameweek.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });

  // On GW activation: rollover free transfer (max 2) and reset counters
  await User.updateMany({}, [
    {
      $set: {
        freeTransfers: { $min: [ { $add: [ { $ifNull: ['$freeTransfers', 1] }, 1 ] }, 2 ] },
        transfersMadeThisGW: 0
      }
    }
  ]);
  res.json(gw);
});

// CRUD: Matches
router.get('/matches', async (_req, res) => {
  const matches = await Match.find().sort({ date: -1 }).populate('homeClub awayClub gameweek');
  res.json(matches);
});
router.post('/matches', async (req, res) => {
  const { homeClub, awayClub, date, status, round, weekNumber, gameweekId } = req.body;
  const m = new Match({
    homeClub,
    awayClub,
    date: new Date(date),
    status: status || 'NS',
    round: round || (weekNumber ? `Regular Season - ${weekNumber}` : undefined),
    weekNumber: weekNumber || undefined,
    isCompleted: false
  });
  if (gameweekId) m.gameweek = gameweekId;
  await m.save();
  if (gameweekId) await Gameweek.findByIdAndUpdate(gameweekId, { $addToSet: { matches: m._id } });
  res.status(201).json(m);
});
router.put('/matches/:id', async (req, res) => {
  const payload = { ...req.body };
  if (payload.date) payload.date = new Date(payload.date);
  const existing = await Match.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Match not found' });

  if (payload.gameweekId && String(existing.gameweek || '') !== String(payload.gameweekId)) {
    if (existing.gameweek) await Gameweek.findByIdAndUpdate(existing.gameweek, { $pull: { matches: existing._id } });
    await Gameweek.findByIdAndUpdate(payload.gameweekId, { $addToSet: { matches: existing._id } });
    existing.gameweek = payload.gameweekId;
  }
  ['homeClub', 'awayClub', 'status', 'round', 'weekNumber', 'homeScore', 'awayScore', 'date'].forEach(f => {
    if (payload[f] !== undefined) existing[f] = payload[f];
  });
  await existing.save();
  res.json(existing);
});
router.delete('/matches/:id', async (req, res) => {
  const m = await Match.findById(req.params.id);
  if (!m) return res.status(404).json({ error: 'Match not found' });
  if (m.gameweek) await Gameweek.findByIdAndUpdate(m.gameweek, { $pull: { matches: m._id } });
  await Match.findByIdAndDelete(m._id);
  res.json({ message: 'Match deleted' });
});

// Results & Performances (manual or API)
router.post('/matches/:id/results', async (req, res) => {
  const match = await Match.findById(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (req.query.source === 'api') {
    await processCompletedFixture(match.apiFixtureId);
    await finalizeGameweeksIfReady();
    const updated = await Match.findById(match._id).populate('homeClub awayClub gameweek');
    return res.json({ message: 'Results fetched from API', match: updated });
  }

  const { homeScore, awayScore, status, playerPerformances } = req.body;
  if (!Array.isArray(playerPerformances)) return res.status(400).json({ error: 'playerPerformances must be an array' });

  // revert previous aggregates
  if (Array.isArray(match.playerPerformances) && match.playerPerformances.length) {
    for (const prev of match.playerPerformances) {
      await Player.updateOne(
        { _id: prev.player },
        {
          $inc: {
            totalPoints: -(prev.points || 0),
            'stats.goals': -(prev.goals || 0),
            'stats.assists': -(prev.assists || 0),
            'stats.cleanSheets': prev.cleanSheet ? -1 : 0,
            'stats.yellowCards': prev.yellowCard ? -1 : 0,
            'stats.redCards': prev.redCard ? -1 : 0,
            'stats.saves': -(prev.saves || 0),
            'stats.minutesPlayed': -(prev.minutesPlayed || 0)
          }
        }
      );
    }
  }

  // build performances
  const built = [];
  for (const row of playerPerformances) {
    const playerId = row.player || row.playerId;
    const dbPlayer = await Player.findById(playerId);
    if (!dbPlayer) continue;
    const s = {
      minutesPlayed: Number(row.minutesPlayed) || 0,
      goals: Number(row.goals) || 0,
      assists: Number(row.assists) || 0,
      conceded: Number(row.conceded) || 0,
      cleanSheet: (Number(row.conceded) || 0) === 0 && (Number(row.minutesPlayed) || 0) >= 60,
      yellowCard: !!row.yellowCard,
      redCard: !!row.redCard,
      saves: Number(row.saves) || 0,
      penaltiesSaved: Number(row.penaltiesSaved) || 0,
      penaltiesMissed: Number(row.penaltiesMissed) || 0,
      ownGoals: Number(row.ownGoals) || 0
    };
    const points = computePoints(dbPlayer.position, s);
    built.push({ player: dbPlayer._id, apiPlayerId: dbPlayer.apiId || undefined, ...s, points });

    await Player.updateOne(
      { _id: dbPlayer._id },
      {
        $inc: {
          totalPoints: points,
          'stats.goals': s.goals,
          'stats.assists': s.assists,
          'stats.cleanSheets': s.cleanSheet ? 1 : 0,
          'stats.yellowCards': s.yellowCard ? 1 : 0,
          'stats.redCards': s.redCard ? 1 : 0,
          'stats.saves': s.saves,
          'stats.minutesPlayed': s.minutesPlayed
        }
      }
    );
  }

  match.homeScore = homeScore ?? match.homeScore;
  match.awayScore = awayScore ?? match.awayScore;
  if (status) match.status = status;
  match.isCompleted = true;
  match.playerPerformances = built;
  await match.save();

  if (match.gameweek) {
    const gw = await Gameweek.findById(match.gameweek);
    const gwMatches = await Match.find({ gameweek: gw._id });
    if (gwMatches.length && gwMatches.every(m => m.isCompleted)) {
      await finalizeGameweek(gw);
    }
  }

  const updated = await Match.findById(match._id).populate('homeClub awayClub gameweek');
  res.json({ message: 'Match results saved', match: updated });
});

// ========== NEW: ADMIN CRUD for Teams (user squads) ==========

// List all user squads (non-admins)
router.get('/teams', async (_req, res) => {
  const users = await User.find({ isAdmin: false })
    .select('username email budget freeTransfers transfersMadeThisGW team startingXI benchOrder createdAt totalPoints')
    .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName' } });
  res.json(users);
});

// Get one user's squad detail
router.get('/teams/:userId', async (req, res) => {
  const user = await User.findById(req.params.userId)
    .select('username email budget freeTransfers transfersMadeThisGW team startingXI benchOrder createdAt totalPoints')
    .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName' } })
    .populate('startingXI benchOrder');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Update one user's squad
router.put('/teams/:userId', async (req, res) => {
  const { teamPlayerIds, captainId, viceCaptainId, startingXI, benchOrder, freeTransfers, budget } = req.body;
  const user = await User.findById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Update team
  if (Array.isArray(teamPlayerIds)) {
    if (teamPlayerIds.length !== 15) return res.status(400).json({ error: 'teamPlayerIds must be 15 players' });
    const uniqueIds = [...new Set(teamPlayerIds.map(String))];
    if (uniqueIds.length !== 15) return res.status(400).json({ error: 'Duplicate players not allowed' });

    // validate counts & budget
    const posCount = await (async () => {
      const players = await Player.find({ _id: { $in: teamPlayerIds } }).select('position price');
      const cnt = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      let cost = 0;
      players.forEach(p => { cnt[p.position]++; cost += p.price || 0; });
      if (cost > 100) throw new Error('Budget exceeded');
      for (const k of Object.keys(LIMITS)) if (cnt[k] !== LIMITS[k]) throw new Error(`Team must have exactly ${LIMITS[k]} ${k}`);
      return true;
    })().catch(e => ({ error: e.message }));
    if (posCount && posCount.error) return res.status(400).json({ error: posCount.error });

    user.team = teamPlayerIds.map(id => ({ player: id, captain: false, viceCaptain: false }));
    // set captain/vice if provided
    if (captainId && teamPlayerIds.includes(captainId)) {
      user.team.forEach(s => s.captain = String(s.player) === String(captainId));
    }
    if (viceCaptainId && teamPlayerIds.includes(viceCaptainId)) {
      user.team.forEach(s => s.viceCaptain = String(s.player) === String(viceCaptainId));
    }
    // recompute budget
    const cost = await (async () => {
      const players = await Player.find({ _id: { $in: teamPlayerIds } }).select('price');
      return players.reduce((a, p) => a + (p.price || 0), 0);
    })();
    user.budget = 100 - cost;
  }

  if (Array.isArray(startingXI)) user.startingXI = startingXI;
  if (Array.isArray(benchOrder)) user.benchOrder = benchOrder;
  if (typeof freeTransfers === 'number') user.freeTransfers = freeTransfers;
  if (typeof budget === 'number') user.budget = budget;

  await user.save();
  const updated = await User.findById(req.params.userId)
    .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName' } })
    .populate('startingXI benchOrder');
  res.json(updated);
});

// Clear one user's team
router.delete('/teams/:userId', async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.team = [];
  user.startingXI = [];
  user.benchOrder = [];
  user.budget = 100;
  await user.save();
  res.json({ message: 'Team cleared' });
});

module.exports = router;

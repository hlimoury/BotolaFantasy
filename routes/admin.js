// routes/admin.js
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const Club = require('../models/Club');
const Player = require('../models/Player');
const Match = require('../models/Match');
const Gameweek = require('../models/Gameweek');
const User = require('../models/User');
const {
  syncClubs,
  syncPlayers,
  syncFixturesAndGameweeks,
  syncCompletedFixturesAndPoints,
  processCompletedFixture,
  recalcAllUserPoints,
  finalizeGameweek,
  finalizeGameweeksIfReady
} = require('../services/sync');
const { computePoints } = require('../services/scoring');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// Manual sync triggers
router.post('/sync/clubs', async (_req, res) => { try { await syncClubs(); res.json({ message: 'Clubs synced' }); } catch (e) { res.status(500).json({ error: e.message }); }});
router.post('/sync/players', async (_req, res) => { try { await syncPlayers(); res.json({ message: 'Players synced' }); } catch (e) { res.status(500).json({ error: e.message }); }});
router.post('/sync/fixtures', async (_req, res) => { try { await syncFixturesAndGameweeks(); res.json({ message: 'Fixtures & gameweeks synced' }); } catch (e) { res.status(500).json({ error: e.message }); }});
router.post('/sync/results', async (_req, res) => { try { await syncCompletedFixturesAndPoints(); res.json({ message: 'Completed fixtures processed' }); } catch (e) { res.status(500).json({ error: e.message }); }});
router.post('/recalculate', async (_req, res) => { try { await recalcAllUserPoints(); res.json({ message: 'All points recalculated' }); } catch (e) { res.status(500).json({ error: e.message }); }});

// CRUD: Clubs
router.get('/clubs', async (_req, res) => { try { const clubs = await Club.find().sort({ name: 1 }); res.json(clubs); } catch (e) { res.status(500).json({ error: e.message }); }});
router.post('/clubs', async (req, res) => { try { const { name, shortName, logo, stadium, city, apiId } = req.body; const club = new Club({ name, shortName, logo, stadium, city, apiId }); await club.save(); res.status(201).json(club); } catch (e) { res.status(500).json({ error: e.message }); }});
router.put('/clubs/:id', async (req, res) => { try { const club = await Club.findByIdAndUpdate(req.params.id, req.body, { new: true }); if (!club) return res.status(404).json({ error: 'Club not found' }); res.json(club); } catch (e) { res.status(500).json({ error: e.message }); }});
router.delete('/clubs/:id', async (req, res) => { try { await Club.findByIdAndDelete(req.params.id); res.json({ message: 'Club deleted' }); } catch (e) { res.status(500).json({ error: e.message }); }});

// CRUD: Players
router.get('/players', async (_req, res) => { try { const players = await Player.find().populate('club', 'name shortName'); res.json(players); } catch (e) { res.status(500).json({ error: e.message }); }});
router.get('/players/:id', async (req, res) => { try { const p = await Player.findById(req.params.id).populate('club', 'name shortName'); if (!p) return res.status(404).json({ error: 'Player not found' }); res.json(p); } catch (e) { res.status(500).json({ error: e.message }); }});
router.post('/players', async (req, res) => { try { const player = new Player(req.body); await player.save(); res.status(201).json(player); } catch (e) { res.status(500).json({ error: e.message }); }});
router.put('/players/:id', async (req, res) => { try { const player = await Player.findByIdAndUpdate(req.params.id, req.body, { new: true }); if (!player) return res.status(404).json({ error: 'Player not found' }); res.json(player); } catch (e) { res.status(500).json({ error: e.message }); }});
router.delete('/players/:id', async (req, res) => { try { await Player.findByIdAndDelete(req.params.id); res.json({ message: 'Player deleted' }); } catch (e) { res.status(500).json({ error: e.message }); }});

// CRUD: Gameweeks
router.get('/gameweeks', async (_req, res) => { try { const gws = await Gameweek.find().sort({ weekNumber: 1 }).populate('matches'); res.json(gws); } catch (e) { res.status(500).json({ error: e.message }); }});
router.get('/gameweeks/active', async (_req, res) => {
  try {
    let gw = await Gameweek.findOne({ isActive: true }).populate({ path: 'matches', populate: ['homeClub', 'awayClub'] });
    if (!gw) gw = await Gameweek.findOne({}).sort({ startDate: 1 }).populate({ path: 'matches', populate: ['homeClub', 'awayClub'] });
    if (gw && (!gw.deadline || !gw.deadline.getTime())) {
      const dates = (gw.matches || []).map(m => m.date).filter(Boolean).map(d => new Date(d).getTime());
      if (dates.length) {
        const first = new Date(Math.min(...dates));
        if (!gw.deadline || gw.deadline.getTime() !== first.getTime()) { gw.deadline = first; await gw.save(); }
      }
    }
    res.json(gw || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/gameweeks', async (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/gameweeks/:id', async (req, res) => {
  try {
    const payload = { ...req.body };
    ['startDate', 'endDate', 'deadline'].forEach(f => { if (payload[f]) payload[f] = new Date(payload[f]); });
    const gw = await Gameweek.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.json(gw);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/gameweeks/:id', async (req, res) => {
  try {
    const gw = await Gameweek.findById(req.params.id);
    if (!gw) return res.status(404).json({ error: 'Gameweek not found' });
    await Match.updateMany({ gameweek: gw._id }, { $unset: { gameweek: "" } });
    await Gameweek.findByIdAndDelete(gw._id);
    res.json({ message: 'Gameweek deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/gameweeks/:id/activate', async (req, res) => {
  try {
    await Gameweek.updateMany({}, { isActive: false });
    const gw = await Gameweek.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
    await User.updateMany({}, [
      {
        $set: {
          freeTransfers: { $min: [ { $add: [ { $ifNull: ['$freeTransfers', 1] }, 1 ] }, 2 ] },
          transfersMadeThisGW: 0
        }
      }
    ]);
    res.json(gw);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// CRUD: Matches
router.get('/matches', async (_req, res) => { 
  try { 
    const matches = await Match.find().sort({ date: -1 }).populate('homeClub awayClub gameweek'); 
    res.json(matches); 
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/matches/:id', async (req, res) => { 
  try { 
    const m = await Match.findById(req.params.id)
      .populate('homeClub awayClub gameweek')
      .populate({ path: 'playerPerformances.player', select: 'name club position' });
    if (!m) return res.status(404).json({ error: 'Match not found' }); 
    res.json(m); 
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/matches', async (req, res) => {
  try {
    const { homeClub, awayClub, date, status, round, weekNumber, gameweekId, apiFixtureId } = req.body;

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

    // Only set apiFixtureId if provided and not empty
    if (apiFixtureId !== undefined && apiFixtureId !== null && apiFixtureId !== '') {
      m.apiFixtureId = Number(apiFixtureId);
    }

    await m.save();

    if (gameweekId) {
      await Gameweek.findByIdAndUpdate(gameweekId, { $addToSet: { matches: m._id } });
    }

    res.status(201).json(m);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/matches/:id', async (req, res) => {
  try {
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

    // Handle apiFixtureId separately and allow clearing it
    if (payload.apiFixtureId !== undefined) {
      if (payload.apiFixtureId === '' || payload.apiFixtureId === null) {
        existing.apiFixtureId = undefined;
      } else {
        existing.apiFixtureId = Number(payload.apiFixtureId);
      }
    }

    await existing.save();
    res.json(existing);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/matches/:id', async (req, res) => {
  try {
    const m = await Match.findById(req.params.id);
    if (!m) return res.status(404).json({ error: 'Match not found' });
    if (m.gameweek) await Gameweek.findByIdAndUpdate(m.gameweek, { $pull: { matches: m._id } });
    await Match.findByIdAndDelete(m._id);
    res.json({ message: 'Match deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Maintenance: fix Match.apiFixtureId index (make it partial-unique, supported on your MongoDB)
router.post('/maintenance/fix-match-apiFixtureId-index', async (_req, res) => {
  try {
    // 1) Clean bad values (null) so they don't get indexed
    await Match.updateMany({ apiFixtureId: null }, { $unset: { apiFixtureId: "" } });

    const coll = Match.collection;

    // 2) Drop any existing apiFixtureId indexes (unique or not, partial or not)
    const indexes = await coll.indexes();
    const toDrop = indexes.filter(i => i.key && i.key.apiFixtureId === 1);
    for (const idx of toDrop) {
      await coll.dropIndex(idx.name);
    }

    // 3) Create the correct partial-unique index using a supported predicate
    await coll.createIndex(
      { apiFixtureId: 1 },
      {
        name: 'uniq_apiFixtureId_when_set',
        unique: true,
        partialFilterExpression: { apiFixtureId: { $gt: 0 } }
      }
    );

    res.json({ message: 'Match apiFixtureId index fixed (partial-unique for positive values).' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Results & Performances (manual or API)
router.post('/matches/:id/results', async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    if (req.query.source === 'api') {
      if (!match.apiFixtureId) return res.status(400).json({ error: 'Match has no apiFixtureId to fetch from API' });
      await processCompletedFixture(match.apiFixtureId);
      await finalizeGameweeksIfReady();
      const updated = await Match.findById(match._id).populate('homeClub awayClub gameweek');
      return res.json({ message: 'Results fetched from API', match: updated });
    }

    const { homeScore, awayScore, status, playerPerformances } = req.body;
    if (!Array.isArray(playerPerformances)) return res.status(400).json({ error: 'playerPerformances must be an array' });

    // revert previous aggregates (if any)
    if (Array.isArray(match.playerPerformances) && match.playerPerformances.length) {
      for (const prev of match.playerPerformances) {
        if (!prev.player) continue;
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
        cleanSheet: ((Number(row.conceded) || 0) === 0) && ((Number(row.minutesPlayed) || 0) >= 60),
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

    // finalize GW if all matches completed
    if (match.gameweek) {
      const gw = await Gameweek.findById(match.gameweek);
      const gwMatches = await Match.find({ gameweek: gw._id });
      if (gwMatches.length && gwMatches.every(m => m.isCompleted)) {
        await finalizeGameweek(gw);
      }
    }

    const updated = await Match.findById(match._id).populate('homeClub awayClub gameweek');
    res.json({ message: 'Match results saved', match: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== ADMIN CRUD for Teams ==========
router.get('/teams', async (_req, res) => {
  try {
    const users = await User.find({ isAdmin: false })
      .select('username email budget freeTransfers transfersMadeThisGW team startingXI benchOrder createdAt totalPoints')
      .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName' } });
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/teams/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('username email budget freeTransfers transfersMadeThisGW team startingXI benchOrder createdAt totalPoints')
      .populate({ path: 'team.player', populate: { path: 'club', select: 'name shortName' } })
      .populate('startingXI benchOrder');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/teams/:userId', async (req, res) => {
  try {
    const { teamPlayerIds, captainId, viceCaptainId, startingXI, benchOrder, freeTransfers, budget } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (Array.isArray(teamPlayerIds)) {
      if (teamPlayerIds.length !== 15) return res.status(400).json({ error: 'teamPlayerIds must be 15 players' });
      const uniqueIds = [...new Set(teamPlayerIds.map(String))];
      if (uniqueIds.length !== 15) return res.status(400).json({ error: 'Duplicate players not allowed' });

      const players = await Player.find({ _id: { $in: teamPlayerIds } }).select('position price');
      const cnt = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      let cost = 0;
      players.forEach(p => { cnt[p.position]++; cost += p.price || 0; });
      if (cost > 100) return res.status(400).json({ error: 'Budget exceeded' });
      for (const k of Object.keys({ GK:2, DEF:5, MID:5, FWD:3 })) {
        const limit = { GK:2, DEF:5, MID:5, FWD:3 }[k];
        if (cnt[k] !== limit) return res.status(400).json({ error: `Team must have exactly ${limit} ${k}` });
      }

      user.team = teamPlayerIds.map(id => ({ player: id, captain: false, viceCaptain: false }));
      if (captainId && teamPlayerIds.includes(captainId)) {
        user.team.forEach(s => s.captain = String(s.player) === String(captainId));
      }
      if (viceCaptainId && teamPlayerIds.includes(viceCaptainId)) {
        user.team.forEach(s => s.viceCaptain = String(s.player) === String(viceCaptainId));
      }

      const cost2 = players.reduce((a, p) => a + (p.price || 0), 0);
      user.budget = 100 - cost2;
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/teams/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.team = [];
    user.startingXI = [];
    user.benchOrder = [];
    user.budget = 100;
    await user.save();
    res.json({ message: 'Team cleared' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CRUD: Clubs
router.get('/clubs', async (_req, res) => {
  try {
    const clubs = await Club.find().sort({ name: 1 });
    res.json(clubs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/clubs/:id', async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });
    res.json(club);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/clubs', async (req, res) => {
  try {
    const { name, shortName, logo, stadium, city, apiId, primaryColor, secondaryColor } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const club = new Club({
      name,
      shortName,
      logo,
      stadium,
      city,
      apiId,
      primaryColor: primaryColor || '#000000',
      secondaryColor: secondaryColor || '#FFFFFF'
    });

    await club.save();
    res.status(201).json(club);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Duplicate club (apiId must be unique)' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.put('/clubs/:id', async (req, res) => {
  try {
    const payload = { ...req.body };
    const club = await Club.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!club) return res.status(404).json({ error: 'Club not found' });
    res.json(club);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Duplicate club (apiId must be unique)' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.delete('/clubs/:id', async (req, res) => {
  try {
    await Club.findByIdAndDelete(req.params.id);
    res.json({ message: 'Club deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;

// sync.js
const api = require('./apiFootball');
const Club = require('../models/Club');
const Player = require('../models/Player');
const Match = require('../models/Match');
const Gameweek = require('../models/Gameweek');
const User = require('../models/User');
const { computePoints, parsePosition } = require('./scoring');

async function upsertClub(apiTeam) {
  const shortName = apiTeam.name?.split(' ')?.slice(0, 2).join(' ') || apiTeam.name;
  return Club.findOneAndUpdate(
    { apiId: apiTeam.id },
    {
      apiId: apiTeam.id,
      name: apiTeam.name,
      shortName,
      logo: apiTeam.logo,
      stadium: apiTeam.venue?.name,
      city: apiTeam.venue?.city
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function syncClubs() {
  const teams = await api.getTeams();
  const ops = teams.map(upsertClub);
  const clubs = await Promise.all(ops);
  return clubs;
}

async function syncPlayers() {
  const clubs = await Club.find({});
  for (const club of clubs) {
    let page = 1;
    let done = false;
    while (!done) {
      const { players, paging } = await api.getTeamPlayers(club.apiId, page);
      for (const item of players) {
        const p = item.player;
        const s0 = item.statistics?.[0] || {};
        const pos = parsePosition(s0.games?.position || p.position);
        const basePrice = Math.max(4, Math.min(12, Math.round(((Number(s0.games?.rating) || 6) / 10) * 9)));
        await Player.findOneAndUpdate(
          { apiId: p.id },
          {
            apiId: p.id,
            name: `${p.firstname || ''} ${p.lastname || ''}`.trim() || p.name,
            position: pos,
            club: club._id,
            apiTeamId: club.apiId,
            image: p.photo,
            price: basePrice
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
      if (paging?.current >= paging?.total) done = true;
      else page += 1;
    }
  }
}

function parseWeekNumber(roundLabel) {
  const n = Number(String(roundLabel || '').split('-').pop().trim());
  return Number.isFinite(n) ? n : undefined;
}

async function syncFixturesAndGameweeks() {
  const fixtures = await api.getAllFixtures();
  const gwMap = new Map(); // weekNumber -> { roundLabel, dates[], matchIds[] }

  for (const f of fixtures) {
    const homeTeamId = f.teams?.home?.id;
    const awayTeamId = f.teams?.away?.id;
    const homeClub = await Club.findOne({ apiId: homeTeamId });
    const awayClub = await Club.findOne({ apiId: awayTeamId });
    if (!homeClub || !awayClub) continue;

    const weekNumber = parseWeekNumber(f.league?.round);
    const roundLabel = f.league?.round;

    const matchDoc = await Match.findOneAndUpdate(
      { apiFixtureId: f.fixture?.id },
      {
        apiFixtureId: f.fixture?.id,
        round: roundLabel,
        weekNumber,
        homeClub: homeClub._id,
        awayClub: awayClub._id,
        date: new Date(f.fixture?.date),
        homeScore: f.goals?.home ?? null,
        awayScore: f.goals?.away ?? null,
        status: f.fixture?.status?.short,
        isCompleted: f.fixture?.status?.short === 'FT'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!gwMap.has(weekNumber)) gwMap.set(weekNumber, { roundLabel, dates: [], matches: [] });
    gwMap.get(weekNumber).dates.push(new Date(f.fixture?.date));
    gwMap.get(weekNumber).matches.push(matchDoc._id);
  }

  for (const [weekNumber, data] of gwMap) {
    const startDate = new Date(Math.min(...data.dates.map((d) => d.getTime())));
    const endDate = new Date(Math.max(...data.dates.map((d) => d.getTime())));
    const deadline = startDate; // lock at first kickoff; adjust if you want a buffer

    const gw = await Gameweek.findOneAndUpdate(
      { weekNumber },
      {
        weekNumber,
        roundLabel: data.roundLabel,
        startDate,
        endDate,
        deadline,
        $addToSet: { matches: { $each: data.matches } }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // Link gameweek to matches
    await Match.updateMany({ _id: { $in: data.matches } }, { gameweek: gw._id });
  }
}

function extractStatsFromAPIPlayer(stat) {
  const games = stat.games || {};
  const goals = stat.goals || {};
  const cards = stat.cards || {};
  const penalty = stat.penalty || {};
  const minutes = games.minutes || 0;

  return {
    minutesPlayed: minutes || 0,
    goals: goals.total || 0,
    assists: goals.assists || 0,
    conceded: goals.conceded || 0,
    cleanSheet: (goals.conceded || 0) === 0 && minutes >= 60,
    yellowCard: (cards.yellow || 0) > 0,
    redCard: (cards.red || 0) > 0,
    saves: goals.saves || 0,
    penaltiesSaved: penalty.saved || 0,
    penaltiesMissed: penalty.missed || 0,
    ownGoals: goals.own || 0
  };
}

async function processCompletedFixture(fixtureId) {
  const match = await Match.findOne({ apiFixtureId: fixtureId });
  if (!match) return;

  const resp = await api.getFixturePlayers(fixtureId);
  const performances = [];

  for (const teamBlock of resp) {
    for (const pl of teamBlock.players) {
      const stat = pl.statistics?.[0];
      if (!stat) continue;

      const apiPlayerId = pl.player?.id;
      const dbPlayer = await Player.findOne({ apiId: apiPlayerId });
      if (!dbPlayer) continue;

      const s = extractStatsFromAPIPlayer(stat);
      const points = computePoints(dbPlayer.position, s);

      performances.push({
        player: dbPlayer._id,
        apiPlayerId,
        ...s,
        points
      });

      // Update Player aggregates (season total and cumulative stats)
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
  }

  match.playerPerformances = performances;
  match.isCompleted = true;
  await match.save();

  // IMPORTANT: We no longer update user weekly points per match.
  // Weekly points are computed once the entire gameweek finishes (finalizeGameweek).
}

function minFormationOk(posCounts) {
  return posCounts.DEF >= 3 && posCounts.MID >= 2 && posCounts.FWD >= 1 && posCounts.GK === 1;
}

function countPositions(selection, playersById) {
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const s of selection) {
    const p = playersById.get(String(s.player));
    if (!p) continue;
    counts[p.position] += 1;
  }
  return counts;
}

function buildDefaultLineup(user, playersById) {
  // Default 3-4-3
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const s of user.team) {
    const p = playersById.get(String(s.player));
    if (!p) continue;
    byPos[p.position].push(s);
  }
  const starters = [];
  const take = (arr, n) => {
    const t = arr.slice(0, n);
    starters.push(...t);
  };

  // starters: 1 GK, 3 DEF, 4 MID, 3 FWD (fill if missing)
  take(byPos.GK, 1);
  take(byPos.DEF, 3);
  take(byPos.MID, 4);
  take(byPos.FWD, 3);

  // If not enough in any pos, fill with remaining regardless of pos until 11
  const remaining = [...byPos.GK.slice(1), ...byPos.DEF.slice(3), ...byPos.MID.slice(4), ...byPos.FWD.slice(3)];
  let i = 0;
  while (starters.length < 11 && i < remaining.length) {
    starters.push(remaining[i++]);
  }

  const startersIds = new Set(starters.map(s => String(s.player)));
  const bench = user.team.filter(s => !startersIds.has(String(s.player)));

  // Bench order: outfield first (in any current order), then GK(s)
  const benchOutfield = bench.filter(s => {
    const p = playersById.get(String(s.player));
    return p && p.position !== 'GK';
  });
  const benchGK = bench.filter(s => {
    const p = playersById.get(String(s.player));
    return p && p.position === 'GK';
  });
  const benchOrdered = [...benchOutfield, ...benchGK].slice(0, 4);

  // Captain default: prioritize FWD -> MID -> DEF -> GK among starters
  const prio = ['FWD', 'MID', 'DEF', 'GK'];
  let captainId = null;
  for (const role of prio) {
    const found = starters.find(s => playersById.get(String(s.player))?.position === role);
    if (found) { captainId = String(found.player); break; }
  }
  // Vice default: next different starter
  let viceId = null;
  for (const s of starters) {
    const id = String(s.player);
    if (id !== captainId) { viceId = id; break; }
  }

  return {
    starters: starters.map(s => String(s.player)),
    benchOrder: benchOrdered.map(s => String(s.player)),
    captainId,
    viceCaptainId: viceId
  };
}

function applyAutoSubs(starters, benchOrder, perfMinutesMap, playersById) {
  // starters/benchOrder are arrays of playerIds (strings)
  const usedFromBench = new Set();
  const startersSet = new Set(starters);
  const resultXI = [...starters]; // will replace ids

  const posCounts = countPositions(resultXI.map(pid => ({ player: pid })), playersById);

  const minutesOf = (pid) => perfMinutesMap.get(pid)?.minutes || 0;

  for (let i = 0; i < resultXI.length; i++) {
    const pid = resultXI[i];
    if ((minutesOf(pid) || 0) > 0) continue; // played, stays

    const starterPos = playersById.get(pid)?.position;
    // Try bench in order
    let subId = null;

    for (const bpid of benchOrder) {
      if (usedFromBench.has(bpid)) continue;
      const minutes = minutesOf(bpid) || 0;
      if (minutes <= 0) continue;

      const benchPos = playersById.get(bpid)?.position;

      if (starterPos === 'GK') {
        if (benchPos !== 'GK') continue;
        // GK -> GK
        subId = bpid;
        break;
      } else {
        if (benchPos === 'GK') continue; // outfield sub must be outfielder
        // Check formation min constraints after swap
        const nextCounts = { ...posCounts };
        nextCounts[starterPos] -= 1;
        nextCounts[benchPos] += 1;
        if (minFormationOk(nextCounts)) {
          subId = bpid;
          posCounts[starterPos] -= 1;
          posCounts[benchPos] += 1;
          break;
        }
      }
    }

    if (subId) {
      usedFromBench.add(subId);
      startersSet.delete(pid);
      startersSet.add(subId);
      resultXI[i] = subId;
    }
    // else no sub possible; keep zero-point starter
  }

  return resultXI; // final XI playerIds
}

async function finalizeGameweek(gw) {
  // Aggregate per-player points and minutes for this GW
  const matches = await Match.find({ gameweek: gw._id }).lean();
  const perfPointsMap = new Map(); // pid -> { points, minutes }
  for (const m of matches) {
    for (const perf of (m.playerPerformances || [])) {
      const pid = String(perf.player);
      const prev = perfPointsMap.get(pid) || { points: 0, minutes: 0 };
      prev.points += (perf.points || 0);
      prev.minutes += (perf.minutesPlayed || 0);
      perfPointsMap.set(pid, prev);
    }
  }

  // All users who have any team
  const users = await User.find({ 'team.0': { $exists: true } });
  if (!users.length) {
    gw.isCompleted = true;
    await gw.save();
    return;
  }

  // Cache positions for all user players used
  const allPlayerIds = new Set();
  for (const u of users) for (const s of u.team) allPlayerIds.add(String(s.player));
  const players = await Player.find({ _id: { $in: Array.from(allPlayerIds) } }).select('position price');
  const playersById = new Map(players.map(p => [String(p._id), { position: p.position, price: p.price }]));

  for (const user of users) {
    // If lineup invalid/missing, create a default 3-4-3
    let starters = user.team.filter(t => t.starting).map(t => String(t.player));
    let benchOrder = user.team.filter(t => !t.starting && Number.isFinite(t.benchOrder))
                              .sort((a, b) => a.benchOrder - b.benchOrder)
                              .map(t => String(t.player));

    let captainId = user.team.find(t => t.captain)?.player?.toString() || null;
    let viceId = user.team.find(t => t.viceCaptain)?.player?.toString() || null;

    // Repair lineup if not exactly 11 starters or <1 bench, or missing C/VC
    if (starters.length !== 11 || benchOrder.length === 0 || !captainId || !viceId) {
      const defLine = buildDefaultLineup(user, playersById);
      starters = defLine.starters;
      benchOrder = defLine.benchOrder;
      captainId = captainId || defLine.captainId;
      viceId = viceId || defLine.viceCaptainId;

      // Persist the repaired lineup so future GWs have shape
      for (const t of user.team) {
        const pid = String(t.player);
        t.starting = starters.includes(pid);
        t.benchOrder = t.starting ? null : (benchOrder.indexOf(pid) + 1 || null);
        t.captain = pid === captainId;
        t.viceCaptain = pid === viceId;
      }
      user.lineupLastSetAt = new Date();
    }

    // Apply autosubs
    const finalXI = applyAutoSubs(starters, benchOrder, perfPointsMap, playersById);

    // Sum points for finalXI
    let total = 0;
    const pointsOf = (pid) => perfPointsMap.get(pid)?.points || 0;
    const minutesOf = (pid) => perfPointsMap.get(pid)?.minutes || 0;
    for (const pid of finalXI) total += pointsOf(pid);

    // Apply C/VC: if C played (any minutes), double C; else if VC played, double VC
    if (captainId && minutesOf(captainId) > 0) {
      total += pointsOf(captainId);
    } else if (viceId && minutesOf(viceId) > 0) {
      total += pointsOf(viceId);
    }

    // Apply transfer penalty for this GW
    const penalty = user.transferPenalties?.find(p => p.gameweek === gw.weekNumber)?.penalty || 0;
    total -= penalty;

    // Save weeklyPoints (overwrite/replace)
    const idx = user.weeklyPoints.findIndex(w => w.gameweek === gw.weekNumber);
    if (idx >= 0) user.weeklyPoints[idx].points = total;
    else user.weeklyPoints.push({ gameweek: gw.weekNumber, points: total });

    user.totalPoints = user.weeklyPoints.reduce((sum, w) => sum + (w.points || 0), 0);
    await user.save();
  }

  gw.isCompleted = true;
  await gw.save();
}

async function syncCompletedFixturesAndPoints() {
  // Find matches not completed but whose API status is FT now
  const pending = await Match.find({ isCompleted: false }).populate('gameweek');
  if (pending.length) {
    const allFixtures = await api.getAllFixtures(); // get fresh statuses
    const statusMap = new Map(allFixtures.map((f) => [f.fixture.id, f.fixture.status.short]));
    for (const m of pending) {
      const st = statusMap.get(m.apiFixtureId);
      if (st === 'FT') {
        await processCompletedFixture(m.apiFixtureId);
      }
    }
  }

  // Finalize any gameweek where all matches are completed but gw.isCompleted is false
  const gws = await Gameweek.find({ isCompleted: false }).populate('matches');
  for (const gw of gws) {
    const matchDocs = await Match.find({ gameweek: gw._id });
    const allDone = matchDocs.length > 0 && matchDocs.every(m => m.isCompleted);
    if (allDone) {
      await finalizeGameweek(gw);
    }
  }
}

async function autoSyncTick() {
  await syncClubs();
  await syncPlayers();
  await syncFixturesAndGameweeks();
  await syncCompletedFixturesAndPoints();
}

async function recalcAllUserPoints() {
  // Reset all points
  await User.updateMany({}, { totalPoints: 0, weeklyPoints: [] });
  await Player.updateMany({}, { 
    totalPoints: 0,
    'stats.goals': 0,
    'stats.assists': 0,
    'stats.cleanSheets': 0,
    'stats.yellowCards': 0,
    'stats.redCards': 0,
    'stats.saves': 0,
    'stats.minutesPlayed': 0
  });

  // Recompute all matches performances into players
  const matches = await Match.find({ isCompleted: true }).populate('gameweek');
  for (const match of matches) {
    for (const perf of (match.playerPerformances || [])) {
      await Player.updateOne(
        { _id: perf.player },
        {
          $inc: {
            totalPoints: perf.points,
            'stats.goals': perf.goals,
            'stats.assists': perf.assists,
            'stats.cleanSheets': perf.cleanSheet ? 1 : 0,
            'stats.yellowCards': perf.yellowCard ? 1 : 0,
            'stats.redCards': perf.redCard ? 1 : 0,
            'stats.saves': perf.saves,
            'stats.minutesPlayed': perf.minutesPlayed
          }
        }
      );
    }
  }

  // Recompute weekly points per completed GW (using finalize logic)
  const gws = await Gameweek.find({});
  for (const gw of gws) {
    const matchDocs = await Match.find({ gameweek: gw._id });
    const allDone = matchDocs.length > 0 && matchDocs.every(m => m.isCompleted);
    if (allDone) {
      // Mark as not completed for now to trigger finalize (so it overwrites weeklyPoints)
      gw.isCompleted = false;
      await gw.save();
      await finalizeGameweek(gw);
    }
  }
}

async function finalizeGameweeksIfReady() {
  const gws = await Gameweek.find({ isCompleted: false });
  for (const gw of gws) {
    const matchDocs = await Match.find({ gameweek: gw._id });
    const allDone = matchDocs.length > 0 && matchDocs.every(m => m.isCompleted);
    if (allDone) {
      await finalizeGameweek(gw);
    }
  }
}


module.exports = {
  syncClubs,
  syncPlayers,
  syncFixturesAndGameweeks,
  syncCompletedFixturesAndPoints,
  autoSyncTick,
  processCompletedFixture,
  recalcAllUserPoints,
  finalizeGameweek,
  finalizeGameweeksIfReady
};

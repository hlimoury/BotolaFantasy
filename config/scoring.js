// Fantasy scoring configuration
module.exports = {
    minutes: {
      threshold60: 1, // >60 minutes
      fullMatch: 2    // 90+ minutes
    },
    goals: {
      GK: 6,
      DEF: 6,
      MID: 5,
      FWD: 4
    },
    assists: 3,
    cleanSheet: {
      GK: 4,
      DEF: 4,
      MID: 1,
      FWD: 0
    },
    cards: {
      yellow: -1,
      red: -3
    },
    ownGoal: -2,
    penalty: {
      saved: 5,
      missed: -2,
      conceded: -1 // GK/DEF optional
    },
    saves: {
      per: 3,   // every 3 saves
      points: 1
    },
    motm: 3,
    conceded: {
      GK: -1, // each 2 goals conceded -1
      DEF: -1,
      perGoals: 2
    },
    captainMultiplier: 2
  };
  
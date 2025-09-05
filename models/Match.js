const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  apiFixtureId: { type: Number, index: true, unique: true },
  round: { type: String }, // e.g., "Regular Season - 10"
  weekNumber: { type: Number }, // parsed round number
  homeClub: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
  awayClub: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
  gameweek: { type: mongoose.Schema.Types.ObjectId, ref: 'Gameweek' },
  date: { type: Date, required: true },
  homeScore: { type: Number, default: null },
  awayScore: { type: Number, default: null },
  status: { type: String }, // e.g., "FT", "NS"
  isCompleted: { type: Boolean, default: false },
  playerPerformances: [
    {
      player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
      apiPlayerId: Number,
      goals: Number,
      assists: Number,
      cleanSheet: Boolean,
      yellowCard: Boolean,
      redCard: Boolean,
      saves: Number,
      minutesPlayed: Number,
      penaltiesSaved: Number,
      penaltiesMissed: Number,
      ownGoals: Number,
      conceded: Number,
      points: Number
    }
  ]
});

module.exports = mongoose.model('Match', matchSchema);

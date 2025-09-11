// Player.js
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  apiId: { type: Number, index: true, unique: true },
  name: { type: String, required: true },
  position: { type: String, enum: ['GK', 'DEF', 'MID', 'FWD'], required: true },
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true },
  apiTeamId: { type: Number, index: true },
  price: { type: Number, default: 6 },
  image: { type: String },
  stats: {
    goals: { type: Number, default: 0 },
    assists: { type: Number, default: 0 },
    cleanSheets: { type: Number, default: 0 },
    yellowCards: { type: Number, default: 0 },
    redCards: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    minutesPlayed: { type: Number, default: 0 }
  },
  totalPoints: { type: Number, default: 0 },
  weeklyPoints: [{ gameweek: Number, points: Number }],
  isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Player', playerSchema);

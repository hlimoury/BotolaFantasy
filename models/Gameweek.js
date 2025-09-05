const mongoose = require('mongoose');

const gameweekSchema = new mongoose.Schema({
  weekNumber: { type: Number, required: true, unique: true },
  roundLabel: { type: String },
  startDate: { type: Date },
  endDate: { type: Date },
  deadline: { type: Date }, // NEW: lock deadline (usually first kickoff in this GW)
  matches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Match' }],
  isActive: { type: Boolean, default: false },
  isCompleted: { type: Boolean, default: false }
});

module.exports = mongoose.model('Gameweek', gameweekSchema);
// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teamSelectionSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  captain: { type: Boolean, default: false },
  viceCaptain: { type: Boolean, default: false }
}, { _id: false });

const weeklyPointsSchema = new mongoose.Schema({
  gameweek: { type: Number, required: true },
  points: { type: Number, default: 0 },          // includes match points + any transfer costs (negative)
  transferCost: { type: Number, default: 0 }     // stored separately for UI
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, select: false },
  googleId: { type: String },
  avatar:   { type: String },

  favoriteClub: { type: mongoose.Schema.Types.ObjectId, ref: 'Club' },

  // Fantasy squad
  team: [teamSelectionSchema],                   // 15 players with captain/vice flags
  startingXI: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],  // 11 Player IDs
  benchOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],  // 4 Player IDs, prioritized [1..4]
  budget: { type: Number, default: 100 },        // remaining budget (100 - sum price)

  // Transfers
  freeTransfers: { type: Number, default: 1 },   // increments by +1 on GW activation up to 2 (see admin route)
  transfersMadeThisGW: { type: Number, default: 0 },
  transferHistory: [{
    in:  { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    out: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    gameweek: Number,
    date: { type: Date, default: Date.now },
    cost: { type: Number, default: 0 }           // 0 for free, 4 for extra, etc.
  }],

  // Points
  totalPoints: { type: Number, default: 0 },
  weeklyPoints: [weeklyPointsSchema],

  // Friends
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Roles
  isAdmin: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now }
});

// Hash password if changed
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (e) { next(e); }
});

userSchema.methods.comparePassword = async function(candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);

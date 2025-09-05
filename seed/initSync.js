require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Club = require('../models/Club');
const Player = require('../models/Player');
const Gameweek = require('../models/Gameweek');
const Match = require('../models/Match');
const { syncClubs, syncPlayers, syncFixturesAndGameweeks } = require('../services/sync');

(async () => {
  try {
    await connectDB();

    console.log('Clearing existing data (except users)...');
    await Club.deleteMany({});
    await Player.deleteMany({});
    await Gameweek.deleteMany({});
    await Match.deleteMany({});

    console.log('Syncing from API ...');
    await syncClubs();
    await syncPlayers();
    await syncFixturesAndGameweeks();

    // Admin bootstrap if missing (avoid double-hashing; let pre-save hook hash)
    const adminEmail = 'admin@botolafantasy.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = await User.create({
        username: 'admin',
        email: adminEmail,
        password: 'admin123', // plain; pre-save hook will hash
        isAdmin: true
      });
      console.log('Admin user created (email: admin@botolafantasy.com, password: admin123)');
    } else {
      // Ensure admin privileges and ensure password exists
      admin.isAdmin = true;
      if (!admin.password) {
        admin.password = 'admin123';
      }
      await admin.save();
      console.log('Admin user ensured (email: admin@botolafantasy.com)');
    }

    console.log('Initial sync completed');
    process.exit(0);
  } catch (e) {
    console.error('Init sync error:', e);
    process.exit(1);
  }
})();

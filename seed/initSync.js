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

    // Admin bootstrap if missing
    const admin = await User.findOne({ email: 'admin@botolafantasy.com' });
    if (!admin) {
      const bcrypt = require('bcryptjs');
      await User.create({
        username: 'admin',
        email: 'admin@botolafantasy.com',
        password: await bcrypt.hash('admin123', 10),
        isAdmin: true
      });
      console.log('Admin user created (email: admin@botolafantasy.com, password: admin123)');
    }

    console.log('Initial sync completed');
    process.exit(0);
  } catch (e) {
    console.error('Init sync error:', e);
    process.exit(1);
  }
})();

const express = require('express');
const Gameweek = require('../models/Gameweek');
const Match = require('../models/Match');

const router = express.Router();

// List gameweeks
router.get('/', async (req, res) => {
  const gws = await Gameweek.find({}).sort({ weekNumber: 1 });
  res.json(gws);
});

// Active gameweek (first isActive=true; else nearest by date)
router.get('/active', async (req, res) => {
  let gw = await Gameweek.findOne({ isActive: true }).populate({
    path: 'matches',
    populate: ['homeClub', 'awayClub']
  });

  if (!gw) {
    gw = await Gameweek.findOne({}).sort({ startDate: 1 }).populate({
      path: 'matches',
      populate: ['homeClub', 'awayClub']
    });
  }

  if (gw && !gw.deadline) {
    // fallback: earliest match kickoff
    const dates = (gw.matches || []).map(m => m.date).filter(Boolean).map(d => new Date(d).getTime());
    if (dates.length) {
      const first = new Date(Math.min(...dates));
      if (!gw.deadline || gw.deadline.getTime() !== first.getTime()) {
        gw.deadline = first;
        await gw.save();
      }
    }
  }

  res.json(gw || {});
});
module.exports = router;

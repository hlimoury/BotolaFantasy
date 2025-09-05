const express = require('express');
const User = require('../models/User');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const limit = Math.max(parseInt(req.query.limit || '20'), 1);
    const page = Math.max(parseInt(req.query.page || '1'), 1);

    const users = await User.find({ isAdmin: false }).select('username favoriteClub totalPoints weeklyPoints').populate('favoriteClub', 'name logo').sort({ totalPoints: -1 }).limit(limit).skip((page - 1) * limit);

    const total = await User.countDocuments({ isAdmin: false });

    res.json({ users, totalPages: Math.ceil(total / limit), currentPage: page });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/top', async (_req, res) => {
  try {
    const users = await User.find({ isAdmin: false }).select('username totalPoints').sort({ totalPoints: -1 }).limit(5);
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/gameweek/:week', async (req, res) => {
  try {
    const week = parseInt(req.params.week);
    const users = await User.aggregate([
      { $match: { isAdmin: false } },
      { $unwind: '$weeklyPoints' },
      { $match: { 'weeklyPoints.gameweek': week } },
      { $lookup: { from: 'clubs', localField: 'favoriteClub', foreignField: '_id', as: 'club' } },
      { $project: { username: 1, points: '$weeklyPoints.points', club: { $arrayElemAt: ['$club', 0] } } },
      { $sort: { points: -1 } }
    ]);
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

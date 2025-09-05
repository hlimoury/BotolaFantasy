const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const League = require('../models/League');
const User = require('../models/User');

const router = express.Router();
router.use(authMiddleware);

function genCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Create league
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  let code;
  for (let i = 0; i < 5; i++) {
    code = genCode();
    const exists = await League.findOne({ code });
    if (!exists) break;
    code = null;
  }
  if (!code) return res.status(500).json({ error: 'Could not generate invite code' });

  const league = await League.create({ name, code, owner: req.user._id, members: [req.user._id] });
  res.status(201).json(league);
});

// Join by code
router.post('/join', async (req, res) => {
  const { code } = req.body;
  const league = await League.findOne({ code });
  if (!league) return res.status(404).json({ error: 'League not found' });
  await League.updateOne({ _id: league._id }, { $addToSet: { members: req.user._id } });
  const updated = await League.findById(league._id);
  res.json(updated);
});

// Leave league
router.post('/:id/leave', async (req, res) => {
  const league = await League.findById(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (String(league.owner) === String(req.user._id)) {
    return res.status(400).json({ error: 'Owner cannot leave own league' });
  }
  await League.updateOne({ _id: league._id }, { $pull: { members: req.user._id } });
  res.json({ message: 'Left league' });
});

// My leagues
router.get('/mine', async (req, res) => {
  const leagues = await League.find({ members: req.user._id }).sort({ createdAt: -1 });
  res.json(leagues);
});

// League standings
router.get('/:id', async (req, res) => {
  const league = await League.findById(req.params.id).populate('members', 'username email avatar totalPoints weeklyPoints');
  if (!league) return res.status(404).json({ error: 'League not found' });
  const standings = [...league.members].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  res.json({ league: { _id: league._id, name: league.name, code: league.code, owner: league.owner }, standings });
});

module.exports = router;

const express = require('express');
const Player = require('../models/Player');

const router = express.Router();

// Public players listing with filters
router.get('/', async (req, res) => {
  try {
    const { position, club, minPrice, maxPrice, sort = 'price' } = req.query;
    const query = { isActive: true };
    if (position) query.position = position.toUpperCase();
    if (club) query.club = club;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    const sortObj = {};
    if (sort === 'price') sortObj.price = -1;
    else if (sort === 'points') sortObj.totalPoints = -1;
    else sortObj.name = 1;

    const players = await Player.find(query).populate('club', 'name shortName logo').sort(sortObj);
    res.json(players);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Player by id
router.get('/:id', async (req, res) => {
  try {
    const player = await Player.findById(req.params.id).populate('club', 'name shortName logo stadium');
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json(player);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

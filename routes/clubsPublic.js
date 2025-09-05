// routes/clubsPublic.js
const express = require('express');
const Club = require('../models/Club');

const router = express.Router();

// Public: list all clubs (optionally filter by q)
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {};
    if (q) filter.name = new RegExp(q, 'i');

    const clubs = await Club.find(filter)
      .select('name shortName logo stadium city primaryColor secondaryColor')
      .sort({ name: 1 });

    res.json(clubs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public: get a club by id
router.get('/:id', async (req, res) => {
  try {
    const club = await Club.findById(req.params.id)
      .select('name shortName logo stadium city primaryColor secondaryColor');

    if (!club) return res.status(404).json({ error: 'Club not found' });
    res.json(club);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

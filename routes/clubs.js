const express = require('express');
const Club = require('../models/Club');

const router = express.Router();

// Public list clubs
router.get('/', async (req, res) => {
  const clubs = await Club.find().sort({ name: 1 });
  res.json(clubs);
});

module.exports = router;

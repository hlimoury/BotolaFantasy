const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const passport = require('passport');

const router = express.Router();
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, favoriteClub } = req.body;
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ error: 'User already exists' });

    const user = await User.create({ username, email, password, favoriteClub });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    req.session.user = { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin };

    res.status(201).json({ message: 'User created', token, user: req.session.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    req.session.user = { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin };

    res.json({ message: 'Login successful', token, user: req.session.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update session
router.post('/session', authMiddleware, async (req, res) => {
  const user = req.user;
  req.session.user = { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin };
  res.json({ message: 'Session updated' });
});

// Me
router.get('/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id).select('-password').populate('favoriteClub').populate('team.player');
  res.json(user);
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// Google OAuth (mounted under both /api/auth/* and /auth/* via server.js)
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  async (req, res) => {
    const user = req.user;
    req.session.user = { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin };

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    const userPayload = JSON.stringify({ id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin });

    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head>
<body>
<script>
  localStorage.setItem('token', '${token}');
  localStorage.setItem('user', '${userPayload.replace(/'/g, "\\'")}');
  window.location.href = '/dashboard';
</script>
</body></html>`);
  }
);

module.exports = router;

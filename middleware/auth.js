const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

const authMiddleware = async (req, res, next) => {
  try {
    const auth = req.header('Authorization') || '';
    if (!auth.toLowerCase().startsWith('bearer ')) throw new Error('Missing token');
    let token = auth.replace(/^Bearer\s+/i, '').trim();
    token = token.replace(/^"|"$/g, ''); // strip accidental quotes
    if (!token) throw new Error('Missing token');

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) throw new Error('User not found');
    req.user = user;
    next();
  } catch (_e) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

module.exports = { authMiddleware, adminMiddleware };

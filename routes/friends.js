const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');

const router = express.Router();
router.use(authMiddleware);

// List friends + pending
router.get('/', async (req, res) => {
  const me = await User.findById(req.user._id).populate('friends', 'username email avatar');
  const incoming = await FriendRequest.find({ to: req.user._id, status: 'pending' }).populate('from', 'username email avatar');
  const outgoing = await FriendRequest.find({ from: req.user._id, status: 'pending' }).populate('to', 'username email avatar');
  res.json({ friends: me.friends, incoming, outgoing });
});

// Search users by username or email (exclude self, limit 10)
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [{ username: regex }, { email: regex }]
  })
    .select('username email avatar')
    .limit(10);

  res.json({ users });
});

// Send friend request
router.post('/request', async (req, res) => {
  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId required' });
  if (String(toUserId) === String(req.user._id)) return res.status(400).json({ error: 'Cannot friend yourself' });

  const me = await User.findById(req.user._id);
  if (me.friends.some(fid => String(fid) === String(toUserId))) return res.status(400).json({ error: 'Already friends' });

  // If opposite pending exists, accept both
  const opposite = await FriendRequest.findOne({ from: toUserId, to: req.user._id, status: 'pending' });
  if (opposite) {
    opposite.status = 'accepted';
    await opposite.save();
    await User.updateOne({ _id: req.user._id }, { $addToSet: { friends: toUserId } });
    await User.updateOne({ _id: toUserId }, { $addToSet: { friends: req.user._id } });
    return res.json({ message: 'Friend request auto-accepted' });
  }

  // If same-direction pending exists, do nothing
  const existing = await FriendRequest.findOne({ from: req.user._id, to: toUserId, status: 'pending' });
  if (existing) return res.status(200).json({ message: 'Request already sent' });

  await FriendRequest.create({ from: req.user._id, to: toUserId, status: 'pending' });
  res.status(201).json({ message: 'Friend request sent' });
});

// Accept
router.post('/accept/:requestId', async (req, res) => {
  const fr = await FriendRequest.findById(req.params.requestId);
  if (!fr || String(fr.to) !== String(req.user._id)) return res.status(404).json({ error: 'Request not found' });
  if (fr.status !== 'pending') return res.status(400).json({ error: 'Request not pending' });
  fr.status = 'accepted';
  await fr.save();
  await User.updateOne({ _id: fr.to }, { $addToSet: { friends: fr.from } });
  await User.updateOne({ _id: fr.from }, { $addToSet: { friends: fr.to } });
  res.json({ message: 'Friend added' });
});

// Decline
router.post('/decline/:requestId', async (req, res) => {
  const fr = await FriendRequest.findById(req.params.requestId);
  if (!fr || String(fr.to) !== String(req.user._id)) return res.status(404).json({ error: 'Request not found' });
  fr.status = 'declined';
  await fr.save();
  res.json({ message: 'Request declined' });
});

// Cancel outgoing request (new)
router.post('/cancel/:requestId', async (req, res) => {
  const fr = await FriendRequest.findById(req.params.requestId);
  if (!fr || String(fr.from) !== String(req.user._id)) return res.status(404).json({ error: 'Request not found' });
  if (fr.status !== 'pending') return res.status(400).json({ error: 'Cannot cancel non-pending request' });
  await FriendRequest.findByIdAndDelete(fr._id);
  res.json({ message: 'Request canceled' });
});

// Remove friend
router.post('/remove', async (req, res) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: 'friendId required' });
  await User.updateOne({ _id: req.user._id }, { $pull: { friends: friendId } });
  await User.updateOne({ _id: friendId }, { $pull: { friends: req.user._id } });
  res.json({ message: 'Friend removed' });
});

module.exports = router;

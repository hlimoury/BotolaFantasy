const mongoose = require('mongoose');

module.exports = async () => {
  try {
    const uri = (process.env.MONGODB_URI || '').trim();
    await mongoose.connect(uri);
    console.log('MongoDB Connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

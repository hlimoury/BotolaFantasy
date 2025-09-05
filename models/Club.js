const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema({
  apiId: { type: Number, index: true, unique: true },
  name: { type: String, required: true },
  shortName: { type: String },
  logo: { type: String },
  stadium: { type: String },
  city: { type: String },
  primaryColor: { type: String, default: '#000000' },
  secondaryColor: { type: String, default: '#FFFFFF' }
});

module.exports = mongoose.model('Club', clubSchema);

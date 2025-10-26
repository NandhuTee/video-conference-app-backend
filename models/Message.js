const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  sender: { type: String, required: true }, // username or userId
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', MessageSchema);

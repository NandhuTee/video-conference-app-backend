const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  description: { type: String },
  status: { type: String, enum: ['todo','inprogress','done'], default: 'todo' },
  assignee: { type: String, default: null },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Task', TaskSchema);

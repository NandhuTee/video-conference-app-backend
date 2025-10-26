const express = require('express');
const router = express.Router();
const Room = require('../models/Room');

router.get('/', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', async (req, res) => {
  try {
    const room = await Room.create({ name: req.body.name });
    res.json(room);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

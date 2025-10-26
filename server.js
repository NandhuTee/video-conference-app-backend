// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const roomsRoutes = require("./routes/rooms");
const Message = require("./models/Message");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomsRoutes);

// -------------------
// MongoDB Connection
// -------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// -------------------
// HTTP + Socket.IO
// -------------------
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
});

// -------------------
// In-memory stores
// -------------------
// rooms: tracks socketId & username per room
// whiteboardData: stores strokes per room so new joiners get current drawing
// taskBoards: stores simple taskboard state per room (todo/inprogress/done)
const rooms = {}; // { roomId: [ { socketId, username } ] }
const whiteboardData = {}; // { roomId: [ stroke, ... ] }
const taskBoards = {}; // { roomId: { todo: [...], inprogress: [...], done: [...] } }

// -------------------
// Socket Connection
// -------------------
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // NOTE:
  // We register the 'join-room' handler per socket. When a client joins a room
  // it will call socket.emit('join-room', { roomId, username })
  socket.on("join-room", async ({ roomId, username }) => {
    if (!roomId || !username) {
      // ignore malformed join attempts
      return;
    }

    // Add socket to room
    socket.join(roomId);
    console.log(`👤 ${username} (${socket.id}) joined room ${roomId}`);

    // Track user in memory
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push({ socketId: socket.id, username });

    // Notify everyone in room about current users
    io.to(roomId).emit("users:update", rooms[roomId]);
    // Notify others that a user joined
    socket.to(roomId).emit("user-joined", { socketId: socket.id, username });

    // Send initial data to the joining client:
    // - recent chat messages (from MongoDB)
    // - current whiteboard strokes (in-memory)
    // - current taskboard (in-memory)
    try {
      const messages = await Message.find({ roomId })
        .sort({ createdAt: 1 })
        .limit(200)
        .lean();

      socket.emit("messages:initial", messages);
    } catch (err) {
      console.error("Error loading initial messages:", err);
      socket.emit("messages:initial", []);
    }

    socket.emit("whiteboard:initial", whiteboardData[roomId] || []);
    socket.emit(
      "tasks:update",
      taskBoards[roomId] || { todo: [], inprogress: [], done: [] }
    );

    // ------------------------------------------------------------------
    // WHITEBOARD EVENTS (scoped to this room)
    // ------------------------------------------------------------------
    // Draw: stroke is an array of points (we append to in-memory store and broadcast)
    socket.on("whiteboard:draw", (stroke) => {
      if (!whiteboardData[roomId]) whiteboardData[roomId] = [];
      whiteboardData[roomId].push(stroke);
      socket.to(roomId).emit("whiteboard:draw", stroke);
    });

    // Undo: client sends the full strokes array after undo
    socket.on("whiteboard:undo", (strokes) => {
      whiteboardData[roomId] = strokes || [];
      socket.to(roomId).emit("whiteboard:undo", strokes);
    });

    // Redo: client sends the full strokes array after redo
    socket.on("whiteboard:redo", (strokes) => {
      whiteboardData[roomId] = strokes || [];
      socket.to(roomId).emit("whiteboard:redo", strokes);
    });

    // Clear: clears server-side store and notifies the room
    socket.on("whiteboard:clear", () => {
      whiteboardData[roomId] = [];
      io.to(roomId).emit("whiteboard:clear");
    });

    // ------------------------------------------------------------------
    // CHAT EVENTS (persisted to MongoDB)
    // ------------------------------------------------------------------
    socket.on("send-message", async ({ roomId: r, sender, text }) => {
      if (!r || !text) return;
      try {
        const msg = await Message.create({ roomId: r, sender: sender || "Guest", text });
        io.to(r).emit("message:new", msg);
      } catch (err) {
        console.error("send-message error:", err);
      }
    });

    // ------------------------------------------------------------------
    // TASKBOARD EVENTS (simple in-memory board sync)
    // - tasks:get -> reply with current board
    // - tasks:update -> set board & broadcast to room
    // ------------------------------------------------------------------
    socket.on("tasks:get", ({ roomId: r }) => {
      socket.emit("tasks:update", taskBoards[r] || { todo: [], inprogress: [], done: [] });
    });

    socket.on("tasks:update", ({ roomId: r, tasks }) => {
      if (!r || !tasks) return;
      taskBoards[r] = tasks;
      io.to(r).emit("tasks:update", tasks);
    });

    // ------------------------------------------------------------------
    // WEBRTC SIGNALING (peer-to-peer messages)
    // forward offer/answer/ice to specific target socket id
    // ------------------------------------------------------------------
    socket.on("offer", ({ target, sdp }) => {
      if (target) io.to(target).emit("offer", { sdp, caller: socket.id });
    });

    socket.on("answer", ({ target, sdp }) => {
      if (target) io.to(target).emit("answer", { sdp, caller: socket.id });
    });

    socket.on("ice-candidate", ({ target, candidate }) => {
      if (target) io.to(target).emit("ice-candidate", { candidate, from: socket.id });
    });

    // ------------------------------------------------------------------
    // DISCONNECT (per-room cleanup)
    // ------------------------------------------------------------------
    socket.on("disconnect", () => {
      console.log("🔴 Socket disconnected:", socket.id);
      // Remove this socket from the room's user list(s)
      if (rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter((u) => u.socketId !== socket.id);
        io.to(roomId).emit("users:update", rooms[roomId]);
        socket.to(roomId).emit("user-left", socket.id);

        // If room becomes empty, free memory
        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          delete whiteboardData[roomId];
          delete taskBoards[roomId];
        }
      }
    });
  }); // end of join-room handler
}); // end of connection

// -------------------
// Start Server
// -------------------
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(cors());

app.get("/", (req, res) => {
  res.send("Buraq server is running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ userId, userName }, callback) => {
    console.log("JOIN EVENT RECEIVED:", userId, userName);

    const existingSocketId = connectedUsers.get(userId);

    if (existingSocketId && existingSocketId !== socket.id) {
      if (callback) {
        callback({
          success: false,
          message: "This Buraq ID is already in use",
        });
      }
      return;
    }

    socket.join(userId);

    socket.data.userId = userId;
    socket.data.userName = userName;

    connectedUsers.set(userId, socket.id);

    console.log("ROOM JOINED:", userId);

    socket.broadcast.emit("user-online", {
      userId,
      userName,
    });

    if (callback) {
      callback({
        success: true,
        message: "Joined successfully",
      });
    }
  });

  socket.on("check-user", ({ userId }) => {
    const isOnline = connectedUsers.has(userId);

    socket.emit("user-status", {
      userId,
      online: isOnline,
    });
  });

  socket.on("call-user", ({ userToCall, signalData, from, fromName }) => {
    console.log("CALL:", fromName, "(", from, ") ->", userToCall);

    io.to(userToCall).emit("incoming-call", {
      signal: signalData,
      from: from,
      fromName: fromName,
    });
  });

  socket.on("answer-call", ({ to, signal }) => {
    io.to(to).emit("call-accepted", signal);
  });

  socket.on("end-call", ({ to }) => {
    io.to(to).emit("call-ended");
  });

  // =========================
  // CHAT MESSAGE
  // =========================

  socket.on("send-message", ({ to, from, fromName, message }) => {
    console.log("MESSAGE:", fromName, "(", from, ") ->", to, ":", message);

    if (!to || !from || !message) {
      return;
    }

    io.to(to).emit("receive-message", {
      from,
      fromName,
      message,
      time: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;
    const userName = socket.data.userName;

    if (userId && connectedUsers.get(userId) === socket.id) {
      connectedUsers.delete(userId);

      socket.broadcast.emit("user-offline", {
        userId,
        userName,
      });
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log("Buraq calling server running on port " + PORT);
});

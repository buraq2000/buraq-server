const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const admin = require("firebase-admin");

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

// =========================
// FIREBASE (push notifications)
// =========================

let db = null;
let messaging = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      ),
    });
    db = admin.firestore();
    messaging = admin.messaging();
    console.log("Firebase admin ready");
  } else {
    console.log("FIREBASE_SERVICE_ACCOUNT not set, push disabled");
  }
} catch (error) {
  console.log("Firebase admin start failed:", error.message);
}

async function sendCallPush(userToCall, from, fromName) {
  if (!db || !messaging) return;

  try {
    const doc = await db.collection("pushTokens").doc(userToCall).get();

    if (!doc.exists) {
      console.log("PUSH: no token for", userToCall);
      return;
    }

    const token = doc.data().token;

    await messaging.send({
      token,
      notification: {
        title: "Buraq",
        body: (fromName || "Someone") + " is calling you",
      },
      data: {
        type: "incoming-call",
        from: String(from || ""),
      },
      android: {
        priority: "high",
        ttl: 60000,
        notification: {
          channelId: "calls",
          sound: "default",
        },
      },
    });

 data: {
  type: "incoming_call",
  callerId: String(from),
  callerName: String(fromName || from),
},

    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      try {
        await db.collection("pushTokens").doc(userToCall).delete();
      } catch (e) {
        // ignore
      }
    }
  }
}

// =========================
// SOCKET
// =========================

const connectedUsers = new Map();

// calls waiting for a user who is offline (kept for 60 seconds)
const pendingCalls = new Map();
const PENDING_CALL_MS = 60 * 1000;

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

    // if someone called while this user was offline, deliver the call now
    const pending = pendingCalls.get(userId);

    if (pending) {
      if (Date.now() - pending.time < PENDING_CALL_MS) {
        setTimeout(() => {
          socket.emit("incoming-call", {
            signal: pending.signal,
            from: pending.from,
            fromName: pending.fromName,
          });
        }, 1000);
      } else {
        pendingCalls.delete(userId);
      }
    }
  });

  // phone saves its notification address (token)
  socket.on("save-push-token", async ({ token }) => {
    const userId = socket.data.userId;

    if (!db || !userId || !token) return;

    try {
      await db.collection("pushTokens").doc(userId).set({
        token,
        updatedAt: Date.now(),
      });
      console.log("PUSH token saved for", userId);
    } catch (error) {
      console.log("PUSH token save failed:", error.message);
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

    pendingCalls.set(userToCall, {
      signal: signalData,
      from,
      fromName,
      time: Date.now(),
    });

    io.to(userToCall).emit("incoming-call", {
      signal: signalData,
      from: from,
      fromName: fromName,
    });

    // notification (shows only if the app is closed or in the background)
    sendCallPush(userToCall, from, fromName);
  });

  socket.on("answer-call", ({ to, signal }) => {
    pendingCalls.delete(socket.data.userId);
    io.to(to).emit("call-accepted", signal);
  });

  socket.on("end-call", ({ to }) => {
    pendingCalls.delete(to);
    pendingCalls.delete(socket.data.userId);
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

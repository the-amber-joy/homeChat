var socketio = require("socket.io");
var http = require("http");
var fs = require("fs");
var path = require("path");

// Create HTTP server and Socket.IO instance
var server = http.createServer(function (req, res) {
  if (req.url === "/" || req.url === "/index.html") {
    fs.readFile(path.join(__dirname, "index.html"), function (err, data) {
      if (err) {
        res.writeHead(500);
        res.end("Error loading index.html");
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      }
    });
  } else if (req.url === "/style.css") {
    fs.readFile(path.join(__dirname, "style.css"), function (err, data) {
      if (err) {
        res.writeHead(500);
        res.end("Error loading style.css");
      } else {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(data);
      }
    });
  } else if (req.url === "/script.js") {
    fs.readFile(path.join(__dirname, "script.js"), function (err, data) {
      if (err) {
        res.writeHead(500);
        res.end("Error loading script.js");
      } else {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(data);
      }
    });
  } else if (req.url.startsWith("/sounds/") && req.url.endsWith(".mp3")) {
    // Serve sound files
    var soundPath = path.join(__dirname, req.url);
    fs.readFile(soundPath, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end("Sound file not found");
      } else {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(data);
      }
    });
  } else if (req.url === "/api/quote") {
    // Proxy request to ZenQuotes API to avoid CORS
    var https = require("https");
    https
      .get("https://zenquotes.io/api/random", function (apiRes) {
        var data = "";
        apiRes.on("data", function (chunk) {
          data += chunk;
        });
        apiRes.on("end", function () {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(data);
        });
      })
      .on("error", function (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Failed to fetch quote" }));
      });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});
var io = socketio(server, {
  pingTimeout: 60000, // Wait 60 seconds for pong response
  pingInterval: 25000, // Ping every 25 seconds
});

// Track connected users: { lowerNick: { nick, socketId, idle } }
var users = {};

// Track pending disconnect timers
var pendingDisconnects = {};
var DISCONNECT_GRACE_PERIOD = 5000; // 5 seconds

// Helper to build user list for clients
function getUserList() {
  var list = [];
  for (var lowerNick in users) {
    list.push({
      nick: users[lowerNick].nick,
      idle: users[lowerNick].idle || false,
    });
  }
  return list;
}

// Helper to find user by socket ID
function findUserBySocketId(socketId) {
  for (var lowerNick in users) {
    if (users[lowerNick].socketId === socketId) {
      return { lowerNick: lowerNick, user: users[lowerNick] };
    }
  }
  return null;
}

// App version - increment this when you want clients to reload
var appVersion = "1.0.1";

// Listen on port 3010 on all network interfaces
server.listen(3010, "0.0.0.0", function () {
  console.log("Server listening on port 3010");
});

io.on("connection", function (socket) {
  var clientIp = socket.handshake.address;
  console.log("A user connected from: " + clientIp);

  // Send app version to client
  socket.emit("version", appVersion);

  // Handle user registration
  socket.on("register", function (nickname) {
    var lowerNick = nickname.toLowerCase();

    // Check if this user is reconnecting (was idle or has pending disconnect)
    if (users[lowerNick] && users[lowerNick].idle) {
      // Cancel the pending disconnect timer
      if (pendingDisconnects[lowerNick]) {
        clearTimeout(pendingDisconnects[lowerNick]);
        delete pendingDisconnects[lowerNick];
      }
      // Update socket ID and mark as active
      users[lowerNick].socketId = socket.id;
      users[lowerNick].idle = false;
      io.emit("userList", getUserList());
      // Tell client this was a quiet reconnect
      socket.emit("registered", { quiet: true });
    } else if (pendingDisconnects[lowerNick]) {
      // Reconnecting during grace period (before marked idle)
      clearTimeout(pendingDisconnects[lowerNick]);
      delete pendingDisconnects[lowerNick];
      users[lowerNick] = { nick: nickname, socketId: socket.id, idle: false };
      io.emit("userList", getUserList());
      socket.emit("registered", { quiet: true });
    } else {
      // New connection - register normally
      users[lowerNick] = { nick: nickname, socketId: socket.id, idle: false };
      io.emit("userList", getUserList());
      // Tell client to announce join
      socket.emit("registered", { quiet: false });
    }
  });

  // Handle nickname changes
  socket.on("changeNick", function (newNick) {
    var found = findUserBySocketId(socket.id);
    if (found) {
      // Remove old entry and create new one
      var oldLowerNick = found.lowerNick;
      delete users[oldLowerNick];
      var newLowerNick = newNick.toLowerCase();
      users[newLowerNick] = { nick: newNick, socketId: socket.id, idle: false };
      io.emit("userList", getUserList());
    }
  });

  // Broadcast a user's message to everyone else in the room
  socket.on("send", function (data) {
    io.emit("message", data);
  });

  // Handle kick command
  socket.on("kick", function (targetNick) {
    var found = findUserBySocketId(socket.id);
    var kickerNick = found ? found.user.nick : "Unknown";
    var lowerTargetNick = targetNick.toLowerCase();

    if (users[lowerTargetNick]) {
      var targetUser = users[lowerTargetNick];
      var actualNick = targetUser.nick;
      // Mark as kicked to skip grace period on disconnect
      pendingDisconnects[lowerTargetNick] = "kicked";
      // Notify everyone about the kick
      io.emit("message", {
        type: "notice",
        message: actualNick + " was kicked by " + kickerNick,
      });
      // Tell the kicked user they were kicked (they will disconnect themselves)
      io.to(targetUser.socketId).emit("kicked", kickerNick);
    } else {
      // User not found, notify only the kicker
      socket.emit("message", {
        type: "help",
        message: "User '" + targetNick + "' not found.",
      });
    }
  });

  // Handle intentional exit (skip grace period)
  socket.on("exit", function () {
    var found = findUserBySocketId(socket.id);
    if (found) {
      // Mark this user as intentionally exiting
      pendingDisconnects[found.lowerNick] = "intentional";
    }
  });

  // Handle disconnection
  socket.on("disconnect", function () {
    var found = findUserBySocketId(socket.id);
    if (found) {
      var nick = found.user.nick;
      var lowerNick = found.lowerNick;

      // Check if this was an intentional exit or kick
      if (
        pendingDisconnects[lowerNick] === "intentional" ||
        pendingDisconnects[lowerNick] === "kicked"
      ) {
        // Clean up - remove user immediately, no disconnect message
        delete users[lowerNick];
        delete pendingDisconnects[lowerNick];
        io.emit("userList", getUserList());
      } else {
        // Mark user as idle and start grace period
        users[lowerNick].idle = true;
        users[lowerNick].socketId = null;
        io.emit("userList", getUserList());

        // After grace period, remove user and announce disconnect
        pendingDisconnects[lowerNick] = setTimeout(function () {
          delete pendingDisconnects[lowerNick];
          delete users[lowerNick];
          io.emit("userList", getUserList());
          io.emit("message", {
            type: "notice",
            message: nick + " has disconnected",
          });
        }, DISCONNECT_GRACE_PERIOD);
      }
    }
  });
});

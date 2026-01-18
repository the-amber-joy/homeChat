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

// Track connected users
var users = {};

// Track pending disconnections (for grace period on refresh)
var pendingDisconnects = {};
var DISCONNECT_GRACE_PERIOD = 5000; // 5 seconds

// App version - increment this when you want clients to reload
var appVersion = "1.0.0";

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

    // Check if this user is reconnecting within the grace period
    if (pendingDisconnects[lowerNick]) {
      // Cancel the pending disconnect notification
      clearTimeout(pendingDisconnects[lowerNick]);
      delete pendingDisconnects[lowerNick];
      // Just register without announcing join
      users[socket.id] = nickname;
      io.emit("userList", Object.values(users));
      // Tell client this was a quiet reconnect
      socket.emit("registered", { quiet: true });
    } else {
      // New connection - register normally
      users[socket.id] = nickname;
      io.emit("userList", Object.values(users));
      // Tell client to announce join
      socket.emit("registered", { quiet: false });
    }
  });

  // Handle nickname changes
  socket.on("changeNick", function (newNick) {
    users[socket.id] = newNick;
    io.emit("userList", Object.values(users));
  });

  // Broadcast a user's message to everyone else in the room
  socket.on("send", function (data) {
    io.emit("message", data);
  });

  // Handle kick command
  socket.on("kick", function (targetNick) {
    var kickerNick = users[socket.id];
    // Find the socket ID of the target user
    var targetSocketId = null;
    for (var id in users) {
      if (users[id].toLowerCase() === targetNick.toLowerCase()) {
        targetSocketId = id;
        break;
      }
    }

    if (targetSocketId) {
      var actualNick = users[targetSocketId];
      var lowerNick = actualNick.toLowerCase();
      // Mark as kicked to skip grace period on disconnect
      pendingDisconnects[lowerNick] = "kicked";
      // Notify everyone about the kick
      io.emit("message", {
        type: "notice",
        message: actualNick + " was kicked by " + kickerNick,
      });
      // Tell the kicked user they were kicked (they will disconnect themselves)
      io.to(targetSocketId).emit("kicked", kickerNick);
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
    if (users[socket.id]) {
      var lowerNick = users[socket.id].toLowerCase();
      // Mark this user as intentionally exiting
      pendingDisconnects[lowerNick] = "intentional";
    }
  });

  // Handle disconnection
  socket.on("disconnect", function () {
    if (users[socket.id]) {
      var nick = users[socket.id];
      var lowerNick = nick.toLowerCase();
      delete users[socket.id];
      io.emit("userList", Object.values(users));

      // Check if this was an intentional exit or kick
      if (
        pendingDisconnects[lowerNick] === "intentional" ||
        pendingDisconnects[lowerNick] === "kicked"
      ) {
        // Clean up - no grace period, no disconnect message (already sent notice)
        delete pendingDisconnects[lowerNick];
      } else {
        // Use grace period before announcing disconnect
        pendingDisconnects[lowerNick] = setTimeout(function () {
          delete pendingDisconnects[lowerNick];
          io.emit("message", {
            type: "notice",
            message: nick + " has disconnected",
          });
        }, DISCONNECT_GRACE_PERIOD);
      }
    }
  });
});

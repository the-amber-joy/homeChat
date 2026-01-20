var socketio = require("socket.io");
var http = require("http");
var fs = require("fs");
var path = require("path");

// After Dark admin password from environment variable
var AFTERDARK_ADMIN_PASSWORD = process.env.AFTERDARK_ADMIN_PASSWORD || null;

// After Dark access list file path
var AD_ACCESS_LIST_FILE = path.join(__dirname, "ad-access-list.json");

// Device registry file path - tracks nicknames across instances
var DEVICE_REGISTRY_FILE = path.join(__dirname, "device-registry.json");

// Load authorized devices from file
function loadAuthorizedDevices() {
  try {
    if (fs.existsSync(AD_ACCESS_LIST_FILE)) {
      var data = fs.readFileSync(AD_ACCESS_LIST_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error loading authorized devices:", err);
  }
  return [];
}

// Save authorized devices to file
function saveAuthorizedDevices(devices) {
  try {
    fs.writeFileSync(AD_ACCESS_LIST_FILE, JSON.stringify(devices, null, 2));
  } catch (err) {
    console.error("Error saving authorized devices:", err);
  }
}

// Load device registry from file
function loadDeviceRegistry() {
  try {
    if (fs.existsSync(DEVICE_REGISTRY_FILE)) {
      var data = fs.readFileSync(DEVICE_REGISTRY_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error loading device registry:", err);
  }
  return {};
}

// Save device registry to file
function saveDeviceRegistry(registry) {
  try {
    fs.writeFileSync(DEVICE_REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (err) {
    console.error("Error saving device registry:", err);
  }
}

// Authorized device IDs for After Dark access
var authorizedDevices = loadAuthorizedDevices();

// Device registry: { deviceId: { homeNick, afterDarkNick } }
var deviceRegistry = loadDeviceRegistry();

// ASCII art directory
var ASCII_ART_DIR = path.join(__dirname, "ascii_art");

// Load ASCII art from file
function loadAsciiArt(name) {
  try {
    var filePath = path.join(ASCII_ART_DIR, name + ".txt");
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
  } catch (err) {
    console.error("Error loading ASCII art:", err);
  }
  return null;
}

// Get list of available ASCII art
function getAvailableAsciiArt() {
  try {
    if (fs.existsSync(ASCII_ART_DIR)) {
      return fs
        .readdirSync(ASCII_ART_DIR)
        .filter(function (file) {
          return file.endsWith(".txt");
        })
        .map(function (file) {
          return file.replace(".txt", "");
        });
    }
  } catch (err) {
    console.error("Error listing ASCII art:", err);
  }
  return [];
}

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

// Create namespaces
var homeNamespace = io.of("/");
var afterDarkNamespace = io.of("/afterdark");

// Track connected users per namespace: { lowerNick: { nick, socketId, idle } }
var homeUsers = {};
var afterDarkUsers = {};

// Track pending disconnect timers per namespace
var homePendingDisconnects = {};
var afterDarkPendingDisconnects = {};

var DISCONNECT_GRACE_PERIOD = 5000; // 5 seconds

// Rate limiting configuration
var RATE_LIMIT_MESSAGES = 5; // Max messages
var RATE_LIMIT_WINDOW = 10000; // Per 10 seconds
var MUTE_DURATION_1 = 60000; // 1 minute for first offense
var MUTE_DURATION_2 = 300000; // 5 minutes for repeat offense
var messageTimestamps = {}; // { visitorId: [timestamp1, timestamp2, ...] }
var spamStrikes = {}; // { deviceId: count } - how many times they've hit rate limit (persists across reconnects)
var mutedUntil = {}; // { deviceId: timestamp } - when mute expires (persists across reconnects)

// Helper to build user list for clients
function getUserList(users) {
  var list = [];
  for (var lowerNick in users) {
    list.push({
      nick: users[lowerNick].nick,
      idle: users[lowerNick].idle || false,
      deviceId: users[lowerNick].deviceId || null,
    });
  }
  return list;
}

// Helper to find user by socket ID
function findUserBySocketId(users, socketId) {
  for (var lowerNick in users) {
    if (users[lowerNick].socketId === socketId) {
      return { lowerNick: lowerNick, user: users[lowerNick] };
    }
  }
  return null;
}

// Helper to create consistent DM room name from two device IDs
function getDMRoomName(deviceId1, deviceId2) {
  // Sort alphabetically to ensure same room regardless of who initiates
  var sorted = [deviceId1, deviceId2].sort();
  return "dm:" + sorted[0] + ":" + sorted[1];
}

// App version - increment this when you want clients to reload
var appVersion = "1.0.2";

// Listen on port 3010 on all network interfaces
server.listen(3010, "0.0.0.0", function () {
  console.log("Server listening on port 3010");
  if (AFTERDARK_ADMIN_PASSWORD) {
    console.log("After Dark is enabled (admin password set)");
  } else {
    console.log("After Dark is disabled (no admin password set)");
  }
});

// Setup connection handlers for a namespace
function setupNamespace(namespace, users, pendingDisconnects, instanceName) {
  namespace.on("connection", function (socket) {
    var clientIp = socket.handshake.address;
    console.log("[" + instanceName + "] User connected from: " + clientIp);

    // Send app version to client
    socket.emit("version", appVersion);

    // Handle user registration
    socket.on("register", function (data) {
      var nickname = typeof data === "string" ? data : data.nickname;
      var deviceId = typeof data === "object" ? data.deviceId : null;
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
        namespace.emit("userList", getUserList(users));
        // Tell client this was a quiet reconnect
        socket.emit("registered", { quiet: true });
      } else if (pendingDisconnects[lowerNick]) {
        // Reconnecting during grace period (before marked idle)
        clearTimeout(pendingDisconnects[lowerNick]);
        delete pendingDisconnects[lowerNick];
        users[lowerNick] = {
          nick: nickname,
          socketId: socket.id,
          idle: false,
          deviceId: deviceId,
        };
        namespace.emit("userList", getUserList(users));
        socket.emit("registered", { quiet: true });
      } else {
        // New connection - register normally
        users[lowerNick] = {
          nick: nickname,
          socketId: socket.id,
          idle: false,
          deviceId: deviceId,
        };
        namespace.emit("userList", getUserList(users));
        // Tell client to announce join
        socket.emit("registered", { quiet: false });
        // For After Dark, broadcast join message from server
        if (instanceName === "AfterDark") {
          namespace.emit("message", {
            type: "notice",
            message: nickname + " has joined After Dark",
          });
        }
      }

      // Update device registry with current nickname
      if (deviceId) {
        if (!deviceRegistry[deviceId]) {
          deviceRegistry[deviceId] = {};
        }
        if (instanceName === "Home") {
          deviceRegistry[deviceId].homeNick = nickname;
        } else if (instanceName === "AfterDark") {
          deviceRegistry[deviceId].afterDarkNick = nickname;
        }
        saveDeviceRegistry(deviceRegistry);
      }
    });

    // Handle nickname changes
    socket.on("changeNick", function (newNick) {
      var found = findUserBySocketId(users, socket.id);
      if (found) {
        // Remove old entry and create new one
        var oldLowerNick = found.lowerNick;
        var deviceId = users[oldLowerNick].deviceId;
        delete users[oldLowerNick];
        var newLowerNick = newNick.toLowerCase();
        users[newLowerNick] = {
          nick: newNick,
          socketId: socket.id,
          idle: false,
          deviceId: deviceId,
        };
        namespace.emit("userList", getUserList(users));

        // Update device registry with new nickname
        if (deviceId && deviceRegistry[deviceId]) {
          if (instanceName === "Home") {
            deviceRegistry[deviceId].homeNick = newNick;
          } else if (instanceName === "AfterDark") {
            deviceRegistry[deviceId].afterDarkNick = newNick;
          }
          saveDeviceRegistry(deviceRegistry);
        }
      }
    });

    // Broadcast a user's message to everyone else in the room
    socket.on("send", function (data) {
      var visitorId = socket.id;
      var now = Date.now();

      // Get deviceId for persistent mute tracking
      var found = findUserBySocketId(users, socket.id);
      var deviceId = found ? found.user.deviceId : null;

      // Check if user is muted (by deviceId for persistence)
      if (deviceId && mutedUntil[deviceId] && now < mutedUntil[deviceId]) {
        var remainingSecs = Math.ceil((mutedUntil[deviceId] - now) / 1000);
        socket.emit("message", {
          type: "help",
          message:
            "You are muted for " + remainingSecs + " more seconds due to spam.",
        });
        return;
      }

      // Clear mute if expired
      if (deviceId && mutedUntil[deviceId] && now >= mutedUntil[deviceId]) {
        delete mutedUntil[deviceId];
      }

      // Initialize or clean up old timestamps (per socket for rate limiting)
      if (!messageTimestamps[visitorId]) {
        messageTimestamps[visitorId] = [];
      }
      messageTimestamps[visitorId] = messageTimestamps[visitorId].filter(
        function (ts) {
          return now - ts < RATE_LIMIT_WINDOW;
        },
      );

      // Check if over limit
      if (messageTimestamps[visitorId].length >= RATE_LIMIT_MESSAGES) {
        // Use deviceId for strikes/mutes so they persist across reconnects
        var strikeKey = deviceId || visitorId;

        // Initialize spam strikes
        if (!spamStrikes[strikeKey]) {
          spamStrikes[strikeKey] = 0;
        }
        spamStrikes[strikeKey]++;

        // Progressive punishment
        if (spamStrikes[strikeKey] >= 10) {
          // 10+ strikes: 5 minute mute
          mutedUntil[strikeKey] = now + MUTE_DURATION_2;
          spamStrikes[strikeKey] = 5; // Reset to 5 so next offense is also 5 min
          socket.emit("message", {
            type: "help",
            message: "You have been muted for 5 minutes due to repeated spam.",
          });
        } else if (spamStrikes[strikeKey] >= 5) {
          // 5-9 strikes: 1 minute mute
          mutedUntil[strikeKey] = now + MUTE_DURATION_1;
          socket.emit("message", {
            type: "help",
            message:
              "You have been muted for 1 minute due to spam. Continued spam will result in a 5 minute mute.",
          });
        } else {
          // 1-4 strikes: just warn
          var strikesLeft = 5 - spamStrikes[strikeKey];
          socket.emit("message", {
            type: "help",
            message:
              "Slow down! You're sending messages too fast. " +
              strikesLeft +
              " more and you'll be muted for 1 minute.",
          });
        }
        return;
      }

      // Record this message and broadcast
      messageTimestamps[visitorId].push(now);

      // Handle tell messages (private messages from terminal clients)
      // Convert them to DM events for browser clients
      if (data.type === "tell" && data.to && data.from) {
        var lowerTo = data.to.toLowerCase();
        var recipientUser = users[lowerTo];

        if (recipientUser && recipientUser.socketId) {
          // Get sender's device ID
          var senderDeviceId = found ? found.user.deviceId : null;

          // Send as DM event (for browser clients with DM panel)
          namespace.to(recipientUser.socketId).emit("dm", {
            fromDeviceId: senderDeviceId,
            fromNick: data.from,
            message: data.message,
          });

          // Also send the old-style tell message (for terminal clients and backwards compatibility)
          namespace.to(recipientUser.socketId).emit("message", data);
        }
        // Don't broadcast tell messages to everyone
        return;
      }

      namespace.emit("message", data);
    });

    // Handle joining a DM room
    socket.on("joinDM", function (recipientDeviceId) {
      var found = findUserBySocketId(users, socket.id);
      if (found && found.user.deviceId) {
        // Create a consistent room name (sorted device IDs)
        var roomName = getDMRoomName(found.user.deviceId, recipientDeviceId);
        socket.join(roomName);
      }
    });

    // Handle leaving a DM room
    socket.on("leaveDM", function (recipientDeviceId) {
      var found = findUserBySocketId(users, socket.id);
      if (found && found.user.deviceId) {
        var roomName = getDMRoomName(found.user.deviceId, recipientDeviceId);
        socket.leave(roomName);
      }
    });

    // Handle sending a DM
    socket.on("sendDM", function (data) {
      var found = findUserBySocketId(users, socket.id);
      if (!found || !found.user.deviceId) return;

      var senderDeviceId = found.user.deviceId;
      var senderNick = found.user.nick;
      var recipientDeviceId = data.toDeviceId;
      var recipientNick = data.toNick;
      var message = data.message;

      if (!message) return;

      // Find recipient's socket(s) to send the DM
      var recipientSockets = [];

      // Check if recipientDeviceId is a nickname-based key (starts with "nick:")
      if (recipientDeviceId && recipientDeviceId.startsWith("nick:")) {
        // Look up by nickname instead
        var targetNick = recipientDeviceId.substring(5); // Remove "nick:" prefix
        for (var lowerNick in users) {
          if (lowerNick === targetNick && users[lowerNick].socketId) {
            recipientSockets.push(users[lowerNick].socketId);
          }
        }
      } else if (recipientDeviceId) {
        // Look up by device ID
        for (var lowerNick in users) {
          if (
            users[lowerNick].deviceId === recipientDeviceId &&
            users[lowerNick].socketId
          ) {
            recipientSockets.push(users[lowerNick].socketId);
          }
        }
      } else if (recipientNick) {
        // Fall back to nickname lookup
        var lowerTargetNick = recipientNick.toLowerCase();
        if (users[lowerTargetNick] && users[lowerTargetNick].socketId) {
          recipientSockets.push(users[lowerTargetNick].socketId);
        }
      }

      // Send to recipient
      recipientSockets.forEach(function (socketId) {
        // Send as DM event (for browser clients with DM panel)
        namespace.to(socketId).emit("dm", {
          fromDeviceId: senderDeviceId,
          fromNick: senderNick,
          message: message,
        });

        // Also send as tell message (for terminal clients)
        namespace.to(socketId).emit("message", {
          type: "tell",
          from: senderNick,
          to: recipientNick,
          message: message,
        });
      });
    });

    // Handle kick command
    socket.on("kick", function (targetNick) {
      var found = findUserBySocketId(users, socket.id);
      var kickerNick = found ? found.user.nick : "Unknown";
      var lowerTargetNick = targetNick.toLowerCase();

      if (users[lowerTargetNick]) {
        var targetUser = users[lowerTargetNick];
        var actualNick = targetUser.nick;
        // Mark as kicked to skip grace period on disconnect
        pendingDisconnects[lowerTargetNick] = "kicked";
        // Notify everyone about the kick
        namespace.emit("message", {
          type: "notice",
          message: actualNick + " was kicked by " + kickerNick,
        });
        // Tell the kicked user they were kicked (they will disconnect themselves)
        namespace.to(targetUser.socketId).emit("kicked", kickerNick);
      } else {
        // User not found, notify only the kicker
        socket.emit("message", {
          type: "help",
          message: "User '" + targetNick + "' not found.",
        });
      }
    });

    // Handle ASCII art command
    socket.on("ascii", function (artName) {
      var found = findUserBySocketId(users, socket.id);
      var senderNick = found ? found.user.nick : "Unknown";

      var art = loadAsciiArt(artName);
      if (art) {
        namespace.emit("message", {
          type: "ascii",
          art: art,
          artName: artName,
          nick: senderNick,
        });
      } else {
        socket.emit("message", {
          type: "help",
          message: "ASCII art '" + artName + "' not found.",
        });
      }
    });

    // Handle intentional exit (skip grace period)
    socket.on("exit", function () {
      var found = findUserBySocketId(users, socket.id);
      if (found) {
        // Mark this user as intentionally exiting
        pendingDisconnects[found.lowerNick] = "intentional";
      }
    });

    // Handle switching instances (skip grace period but still announce disconnect)
    socket.on("switching", function () {
      var found = findUserBySocketId(users, socket.id);
      if (found) {
        pendingDisconnects[found.lowerNick] = "switching";
      }
    });

    // Handle disconnection
    socket.on("disconnect", function () {
      // Clean up per-socket rate limit tracking (spamStrikes/mutedUntil persist by deviceId)
      delete messageTimestamps[socket.id];

      var found = findUserBySocketId(users, socket.id);
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
          namespace.emit("userList", getUserList(users));
        } else if (pendingDisconnects[lowerNick] === "switching") {
          // Switching instances - remove immediately and announce disconnect
          delete users[lowerNick];
          delete pendingDisconnects[lowerNick];
          namespace.emit("userList", getUserList(users));
          namespace.emit("message", {
            type: "notice",
            message: nick + " has disconnected",
          });
        } else {
          // Mark user as idle and start grace period
          users[lowerNick].idle = true;
          users[lowerNick].socketId = null;
          namespace.emit("userList", getUserList(users));

          // After grace period, remove user and announce disconnect
          pendingDisconnects[lowerNick] = setTimeout(function () {
            delete pendingDisconnects[lowerNick];
            delete users[lowerNick];
            namespace.emit("userList", getUserList(users));
            namespace.emit("message", {
              type: "notice",
              message: nick + " has disconnected",
            });
          }, DISCONNECT_GRACE_PERIOD);
        }
      }
    });
  });
}

// Setup Home Chat namespace
setupNamespace(homeNamespace, homeUsers, homePendingDisconnects, "Home");

// Setup After Dark namespace with authentication middleware
afterDarkNamespace.use(function (socket, next) {
  var deviceId = socket.handshake.auth.deviceId;
  var adminPassword = socket.handshake.auth.adminPassword;

  // Check if admin password is configured
  if (!AFTERDARK_ADMIN_PASSWORD) {
    return next(new Error("After Dark is not enabled"));
  }

  // Allow if valid admin password provided
  if (adminPassword && adminPassword === AFTERDARK_ADMIN_PASSWORD) {
    socket.isAdmin = true;
    return next();
  }

  // Allow if device is authorized
  if (deviceId && authorizedDevices.indexOf(deviceId) !== -1) {
    socket.isAdmin = false;
    return next();
  }

  return next(new Error("Not authorized for After Dark"));
});

setupNamespace(
  afterDarkNamespace,
  afterDarkUsers,
  afterDarkPendingDisconnects,
  "AfterDark",
);

// Add invite command handler for After Dark
afterDarkNamespace.on("connection", function (socket) {
  // Notify client of their admin status
  socket.emit("afterDarkAccess", true, socket.isAdmin);

  // Add device to authorized list if not already there
  // This ensures anyone who successfully connects (admin or invited) stays authorized
  var deviceId = socket.handshake.auth.deviceId;
  if (deviceId && authorizedDevices.indexOf(deviceId) === -1) {
    authorizedDevices.push(deviceId);
    saveAuthorizedDevices(authorizedDevices);
  }

  socket.on("invite", function (targetNick) {
    if (!socket.isAdmin) {
      socket.emit("message", {
        type: "help",
        message: "Only admins can invite users.",
      });
      return;
    }

    var lowerTargetNick = targetNick.toLowerCase();

    // Find the target user in Home Chat to get their device ID
    if (homeUsers[lowerTargetNick]) {
      var targetDeviceId = homeUsers[lowerTargetNick].deviceId;
      if (targetDeviceId && authorizedDevices.indexOf(targetDeviceId) === -1) {
        authorizedDevices.push(targetDeviceId);
        saveAuthorizedDevices(authorizedDevices);
        socket.emit("message", {
          type: "notice",
          message:
            "Invited " + homeUsers[lowerTargetNick].nick + " to After Dark.",
        });
        // Notify the invited user in Home Chat that they now have access
        if (homeUsers[lowerTargetNick].socketId) {
          homeNamespace
            .to(homeUsers[lowerTargetNick].socketId)
            .emit("afterDarkAccess", true);
        }
      } else if (authorizedDevices.indexOf(targetDeviceId) !== -1) {
        socket.emit("message", {
          type: "help",
          message: "User is already authorized for After Dark.",
        });
      } else {
        socket.emit("message", {
          type: "help",
          message: "Could not get device ID for user.",
        });
      }
    } else {
      socket.emit("message", {
        type: "help",
        message: "User '" + targetNick + "' not found in Home Chat.",
      });
    }
  });

  // Handle revoking After Dark access
  socket.on("revoke", function (targetNick) {
    if (!socket.isAdmin) {
      socket.emit("message", {
        type: "help",
        message: "Only admins can revoke access.",
      });
      return;
    }

    var lowerTargetNick = targetNick.toLowerCase();

    // Check if target user is also an admin (connected to After Dark with admin status)
    if (
      afterDarkUsers[lowerTargetNick] &&
      afterDarkUsers[lowerTargetNick].socketId
    ) {
      var targetSocket = afterDarkNamespace.sockets.get(
        afterDarkUsers[lowerTargetNick].socketId,
      );
      if (targetSocket && targetSocket.isAdmin) {
        socket.emit("message", {
          type: "help",
          message: "Cannot revoke access for another admin.",
        });
        return;
      }
    }

    // Find the target user - check online users first, then device registry
    var targetUser =
      homeUsers[lowerTargetNick] || afterDarkUsers[lowerTargetNick];
    var targetDeviceId = null;
    var displayNick = targetNick;

    if (targetUser && targetUser.deviceId) {
      targetDeviceId = targetUser.deviceId;
      displayNick = targetUser.nick;
    } else {
      // Look up in device registry by nickname (check both homeNick and afterDarkNick)
      for (var deviceId in deviceRegistry) {
        var entry = deviceRegistry[deviceId];
        if (
          (entry.homeNick &&
            entry.homeNick.toLowerCase() === lowerTargetNick) ||
          (entry.afterDarkNick &&
            entry.afterDarkNick.toLowerCase() === lowerTargetNick)
        ) {
          // Verify this device is actually authorized
          if (authorizedDevices.indexOf(deviceId) !== -1) {
            targetDeviceId = deviceId;
            displayNick = entry.afterDarkNick || entry.homeNick || targetNick;
            break;
          }
        }
      }
    }

    if (targetDeviceId) {
      var deviceIndex = authorizedDevices.indexOf(targetDeviceId);
      if (deviceIndex !== -1) {
        authorizedDevices.splice(deviceIndex, 1);
        saveAuthorizedDevices(authorizedDevices);
        socket.emit("message", {
          type: "notice",
          message: "Revoked After Dark access for " + displayNick + ".",
        });
        // Notify the user in Home Chat that they lost access
        if (homeUsers[lowerTargetNick] && homeUsers[lowerTargetNick].socketId) {
          homeNamespace
            .to(homeUsers[lowerTargetNick].socketId)
            .emit("afterDarkAccess", false);
        }
        // Move them back to Home Chat if they're in After Dark
        if (
          afterDarkUsers[lowerTargetNick] &&
          afterDarkUsers[lowerTargetNick].socketId
        ) {
          afterDarkNamespace
            .to(afterDarkUsers[lowerTargetNick].socketId)
            .emit("revoked");
        }
      } else {
        socket.emit("message", {
          type: "help",
          message: "User is not authorized for After Dark.",
        });
      }
    } else {
      socket.emit("message", {
        type: "help",
        message: "User '" + targetNick + "' not found or has no device ID.",
      });
    }
  });

  // Handler to get Home Chat users who are NOT authorized for After Dark (for /invite autocomplete)
  socket.on("getHomeUsers", function () {
    if (socket.isAdmin) {
      // Filter out users who are already authorized
      var invitableUsers = [];
      for (var lowerNick in homeUsers) {
        var user = homeUsers[lowerNick];
        if (user.deviceId && authorizedDevices.indexOf(user.deviceId) === -1) {
          invitableUsers.push({
            nick: user.nick,
            idle: user.idle || false,
          });
        }
      }
      socket.emit("homeUserList", invitableUsers);
    }
  });

  // Handler to get ALL authorized After Dark users (for /revoke autocomplete)
  socket.on("getAfterDarkUsers", function () {
    if (socket.isAdmin) {
      // Build list of all authorized users using device registry
      var authorizedUsers = [];
      var addedDevices = {};

      // Check After Dark users (currently connected) - use their live nick
      for (var lowerNick in afterDarkUsers) {
        var user = afterDarkUsers[lowerNick];
        if (user.deviceId && authorizedDevices.indexOf(user.deviceId) !== -1) {
          authorizedUsers.push({
            nick: user.nick,
            idle: user.idle || false,
            online: true,
          });
          addedDevices[user.deviceId] = true;
        }
      }

      // Check Home users who are authorized but not currently in After Dark
      for (var lowerNick in homeUsers) {
        var user = homeUsers[lowerNick];
        if (
          user.deviceId &&
          authorizedDevices.indexOf(user.deviceId) !== -1 &&
          !addedDevices[user.deviceId]
        ) {
          // Use their After Dark nick from registry if available, otherwise Home nick
          var displayNick = user.nick;
          if (
            deviceRegistry[user.deviceId] &&
            deviceRegistry[user.deviceId].afterDarkNick
          ) {
            displayNick = deviceRegistry[user.deviceId].afterDarkNick;
          }
          authorizedUsers.push({
            nick: displayNick,
            idle: user.idle || false,
            online: true,
            inHome: true,
          });
          addedDevices[user.deviceId] = true;
        }
      }

      // Check device registry for offline authorized users
      for (var i = 0; i < authorizedDevices.length; i++) {
        var deviceId = authorizedDevices[i];
        if (!addedDevices[deviceId] && deviceRegistry[deviceId]) {
          var regEntry = deviceRegistry[deviceId];
          // Prefer After Dark nick, fall back to Home nick
          var displayNick =
            regEntry.afterDarkNick || regEntry.homeNick || "Unknown";
          authorizedUsers.push({
            nick: displayNick,
            idle: false,
            online: false,
          });
          addedDevices[deviceId] = true;
        }
      }

      socket.emit("afterDarkUserList", authorizedUsers);
    }
  });
});

// Add endpoint to check After Dark access
homeNamespace.on("connection", function (socket) {
  socket.on("checkAfterDarkAccess", function (data) {
    var deviceId = data.deviceId;
    var adminPassword = data.adminPassword;

    var hasAccess = false;
    var isAdmin = false;

    if (AFTERDARK_ADMIN_PASSWORD) {
      if (adminPassword && adminPassword === AFTERDARK_ADMIN_PASSWORD) {
        hasAccess = true;
        isAdmin = true;
      } else if (deviceId && authorizedDevices.indexOf(deviceId) !== -1) {
        hasAccess = true;
      }
    }

    socket.emit("afterDarkAccess", hasAccess, isAdmin);
  });
});

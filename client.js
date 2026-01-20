var readline = require("readline"),
  socketio = require("socket.io-client"),
  color = require("ansi-color").set,
  fs = require("fs"),
  path = require("path");

var nick;
var currentUserList = [];
var socket = null;
var rl = readline.createInterface(process.stdin, process.stdout);

// Instance state
var currentInstance = "home";
var hasAfterDarkAccess = false;
var isAfterDarkAdmin = false;
var afterDarkAdminPassword = null;
var homeNick = null;
var afterDarkNick = null;
var wasRevoked = false;

// Device ID for After Dark authorization
var deviceIdFile = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".homechat_device_id",
);
var deviceId;
try {
  deviceId = fs.readFileSync(deviceIdFile, "utf8").trim();
} catch (e) {
  deviceId =
    "terminal_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  fs.writeFileSync(deviceIdFile, deviceId);
}

// User selection state (triggered by @)
var userSelectMode = false;
var userSelectUsers = [];
var userSelectSelected = 0;
var savedLine = "";
var savedCursor = 0;

// Get the prompt based on current instance
function getPrompt() {
  if (currentInstance === "afterdark") {
    return color("💋 > ", "red");
  }
  return "🏠 > ";
}

// Connect to a specific instance
function connectToInstance(instance, isSwitching) {
  if (socket) {
    if (isSwitching) {
      socket.emit("switching"); // Tell server to skip grace period
    }
    socket.disconnect();
  }

  currentInstance = instance;

  // Only silent when switching TO After Dark - returning to Home should announce
  var silent = isSwitching && instance === "afterdark";

  var namespace = instance === "afterdark" ? "/afterdark" : "/";
  var authOptions = {};

  if (instance === "afterdark") {
    authOptions.deviceId = deviceId;
    if (afterDarkAdminPassword) {
      authOptions.adminPassword = afterDarkAdminPassword;
    }
  }

  socket = socketio("http://localhost:3010" + namespace, { auth: authOptions });

  // Set up event handlers
  setupSocketHandlers(silent);

  // Update prompt
  rl.setPrompt(getPrompt());
  rl.prompt(true);
}

function setupSocketHandlers(silent) {
  socket.on("connect", function () {
    socket.emit("register", {
      nickname: nick,
      deviceId: deviceId,
      silent: silent,
    });

    // Show revoked message if returning from After Dark after being revoked
    if (wasRevoked && currentInstance === "home") {
      wasRevoked = false;
      console_out(color("", "red"));
      console_out(color("Your After Dark access has been revoked.", "red"));
      console_out(color("", "red"));
    }
  });

  socket.on("connect_error", function (err) {
    if (currentInstance === "afterdark") {
      console_out(
        color("Could not connect to After Dark: " + err.message, "red"),
      );
      hasAfterDarkAccess = false;
      isAfterDarkAdmin = false;
      afterDarkAdminPassword = null;
      connectToInstance("home", true);
    }
  });

  socket.on("registered", function (data) {
    // For After Dark, server broadcasts the join message
    if (!data.quiet && !silent && currentInstance !== "afterdark") {
      socket.emit("send", {
        type: "notice",
        message: nick + " has joined the chat",
      });
    }
  });

  socket.on("afterDarkAccess", function (access, admin) {
    var wasAlreadyAuthorized = hasAfterDarkAccess;
    hasAfterDarkAccess = access;
    isAfterDarkAdmin = admin || false;

    if (currentInstance === "afterdark" && access) {
      console_out(color("Welcome to Home After Dark...", "red"));
      if (admin) {
        console_out(
          color(
            "You are an admin. Use /invite <user> to invite others.",
            "red",
          ),
        );
      }
    } else if (currentInstance === "home" && access && !wasAlreadyAuthorized) {
      // Just got invited while in Home Chat
      console_out(color("", "red"));
      console_out(color("💋 You have been invited to Home After Dark!", "red"));
      console_out(color("   Type /dark to join...", "red"));
      console_out(color("", "red"));
    }
  });

  // Handle After Dark access being revoked - move back to Home Chat
  socket.on("revoked", function () {
    hasAfterDarkAccess = false;
    isAfterDarkAdmin = false;
    wasRevoked = true;
    nick = homeNick || nick;
    connectToInstance("home", true);
  });

  socket.on("message", function (data) {
    var leader;
    if (data.type == "chat") {
      leader =
        getUserColor(data.nick) + "<" + data.nick + ">" + resetColor() + " ";
      console_out(leader + highlightMentions(formatText(data.message)));
    } else if (data.type == "notice") {
      console_out(color(data.message, "cyan"));
    } else if (data.type == "help") {
      console_out(color(data.message, "yellow"));
    } else if (
      data.type == "tell" &&
      data.to.toLowerCase() == nick.toLowerCase()
    ) {
      leader = color("[" + data.from + "->" + data.to + "]", "red");
      console_out(leader + " " + highlightMentions(formatText(data.message)));
    } else if (data.type == "emote") {
      var spaceIndex = data.message.indexOf(" ");
      if (spaceIndex > 0) {
        var emoteNick = data.message.substring(0, spaceIndex);
        var emoteAction = data.message.substring(spaceIndex + 1);
        var output =
          boldText() +
          getUserColor(emoteNick) +
          emoteNick +
          resetColor() +
          " " +
          highlightMentions(formatText(emoteAction));
        console_out(output);
      } else {
        console_out(color(data.message, "cyan"));
      }
    } else if (data.type == "quote") {
      console_out("");
      console_out(color('  "' + data.text + '"', "green"));
      console_out(color("    — " + data.author, "green"));
      console_out("");
    } else if (data.type == "ascii") {
      console_out("");
      console_out(
        getUserColor(data.nick) + data.nick + resetColor() + " shares:",
      );
      console_out(color(data.art, "cyan"));
    }
  });

  socket.on("userList", function (users) {
    currentUserList = users;
  });

  // Check After Dark access when on home
  if (currentInstance === "home") {
    socket.on("connect", function () {
      socket.emit("checkAfterDarkAccess", {
        deviceId: deviceId,
        adminPassword: afterDarkAdminPassword,
      });
    });
  }
}

// Set the username
rl.question("Please enter a nickname: ", function (name) {
  nick = name;
  homeNick = name;

  connectToInstance("home", false);

  console_out(color("Welcome to Home Chat!", "yellow"));
  console_out(color("Type /help to see available commands.", "yellow"));
  console_out("");
  // Show user list after a short delay to ensure server has sent the list
  setTimeout(function () {
    if (currentUserList.length > 0) {
      console_out(
        color("Online users (" + currentUserList.length + "):", "yellow"),
      );
      currentUserList.forEach(function (user) {
        var username = typeof user === "string" ? user : user.nick;
        var isIdle = typeof user === "object" && user.idle;
        var displayUser = "  " + username;
        if (username === nick) {
          displayUser += " (you)";
        }
        if (isIdle) {
          displayUser += " [idle]";
        }
        console_out(getUserColor(username) + displayUser + resetColor());
      });
      console_out("");
    }
  }, 200);
  rl.prompt(true);
});

// Enable keypress events
if (process.stdin.setRawMode) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
}

// Handle keypress for user selection mode
process.stdin.on("keypress", function (str, key) {
  if (!key) return;

  // Handle user selection navigation
  if (userSelectMode) {
    if (key.name === "right" || key.name === "down") {
      userSelectSelected = Math.min(
        userSelectSelected + 1,
        userSelectUsers.length - 1,
      );
      displayUserSelection();
      return;
    } else if (key.name === "left" || key.name === "up") {
      userSelectSelected = Math.max(userSelectSelected - 1, 0);
      displayUserSelection();
      return;
    } else if (key.name === "return" || key.name === "tab") {
      completeUserSelection();
      return;
    } else if (key.name === "escape") {
      cancelUserSelection();
      return;
    }
    // Block other keys in user select mode
    return;
  }

  // Detect @ and trigger user selection
  setTimeout(function () {
    var line = rl.line || "";
    var cursor = rl.cursor || 0;

    // Check if last typed character was @
    if (cursor > 0 && line[cursor - 1] === "@") {
      var atPos = cursor - 1;
      if (atPos === 0 || line[atPos - 1] === " ") {
        // Filter users (exclude self) and extract nicknames
        var filtered = currentUserList
          .map(function (user) {
            return typeof user === "string" ? user : user.nick;
          })
          .filter(function (username) {
            return username !== nick;
          });

        if (filtered.length > 0) {
          startUserSelection(filtered, atPos);
        }
      }
    }
  }, 0);
});

function startUserSelection(users, atPos) {
  userSelectMode = true;
  userSelectUsers = users;
  userSelectSelected = 0;

  // Save current line state (without the @)
  savedLine = rl.line.substring(0, atPos);
  savedCursor = atPos;

  // Clear current line and save this position
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write("\x1b[s"); // Save cursor position

  displayUserSelection();
}

function displayUserSelection() {
  // Restore to saved position and clear everything below
  process.stdout.write("\x1b[u"); // Restore cursor position
  process.stdout.write("\x1b[J"); // Erase from cursor to end of screen

  // Write header and users on the same line
  process.stdout.write(
    color("Select user (←→ navigate, Enter/Tab select, Esc cancel): ", "cyan"),
  );

  userSelectUsers.forEach(function (user, index) {
    var userColor = getUserColor(user);
    if (index === userSelectSelected) {
      process.stdout.write("[" + userColor + user + resetColor() + "] ");
    } else {
      process.stdout.write(userColor + user + resetColor() + " ");
    }
  });
}

function completeUserSelection() {
  var selectedUser = userSelectUsers[userSelectSelected];

  // Clear the user selection display
  process.stdout.write("\x1b[u"); // Restore cursor position
  process.stdout.write("\x1b[J"); // Erase from cursor to end of screen

  // Build the new line with the selected username
  var newLine = savedLine + "@" + selectedUser + " ";

  // Reset state
  userSelectMode = false;
  userSelectUsers = [];
  userSelectSelected = 0;

  // Set readline state and display
  rl.line = newLine;
  rl.cursor = newLine.length;
  rl._refreshLine();
}

function cancelUserSelection() {
  // Clear the user selection display
  process.stdout.write("\x1b[u"); // Restore cursor position
  process.stdout.write("\x1b[J"); // Erase from cursor to end of screen

  // Restore original line (without the @)
  userSelectMode = false;
  userSelectUsers = [];
  userSelectSelected = 0;

  rl.line = savedLine;
  rl.cursor = savedCursor;
  rl._refreshLine();
}

function console_out(msg) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(msg + "\n");
  rl.prompt(true);
}

function getUserColor(username) {
  // Generate a consistent color for each username (case-insensitive)
  var hash = 0;
  var lowerUsername = username.toLowerCase();
  for (var i = 0; i < lowerUsername.length; i++) {
    hash = lowerUsername.charCodeAt(i) + ((hash << 5) - hash);
  }

  var hue = 40 + (Math.abs(hash) % 320);
  var saturation = 65 + (Math.abs(hash) % 20);
  var lightness = 60 + (Math.abs(hash >> 8) % 15);

  // Convert HSL to RGB for ANSI 256 color
  var h = hue / 360;
  var s = saturation / 100;
  var l = lightness / 100;

  var r, g, b;
  if (s == 0) {
    r = g = b = l;
  } else {
    var hue2rgb = function (p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  r = Math.round(r * 255);
  g = Math.round(g * 255);
  b = Math.round(b * 255);

  // Return ANSI 256 color code
  return "\x1b[38;2;" + r + ";" + g + ";" + b + "m";
}

function resetColor() {
  return "\x1b[0m";
}

function boldText() {
  return "\x1b[1m";
}

function italicText() {
  return "\x1b[3m";
}

function underlineText() {
  return "\x1b[4m";
}

function strikethroughText() {
  return "\x1b[9m";
}

function formatText(text) {
  // Parse text formatting markers and convert to ANSI codes
  var markers = [
    { pattern: "**", code: boldText(), name: "bold" },
    { pattern: "*", code: italicText(), name: "italic" },
    { pattern: "_", code: underlineText(), name: "underline" },
    { pattern: "~", code: strikethroughText(), name: "strike" },
  ];

  var result = "";
  var i = 0;
  var activeStyles = {}; // Track which styles are currently active
  var styleStack = []; // Track order of style opening

  while (i < text.length) {
    var foundMarker = false;

    // Check for markers (longest first to handle ** before *)
    for (var m = 0; m < markers.length; m++) {
      var marker = markers[m];
      if (text.substr(i, marker.pattern.length) === marker.pattern) {
        if (activeStyles[marker.name]) {
          // Close this style - just reset all and reapply remaining
          result += resetColor();
          delete activeStyles[marker.name];
          // Remove from stack
          var idx = styleStack.indexOf(marker.name);
          if (idx > -1) styleStack.splice(idx, 1);
          // Reapply remaining styles
          for (var s = 0; s < styleStack.length; s++) {
            for (var n = 0; n < markers.length; n++) {
              if (markers[n].name === styleStack[s]) {
                result += markers[n].code;
                break;
              }
            }
          }
        } else {
          // Open this style
          activeStyles[marker.name] = true;
          styleStack.push(marker.name);
          result += marker.code;
        }
        i += marker.pattern.length;
        foundMarker = true;
        break;
      }
    }

    if (!foundMarker) {
      result += text[i];
      i++;
    }
  }

  // Close any unclosed styles
  if (styleStack.length > 0) {
    result += resetColor();
  }

  return result;
}

function highlightMentions(text) {
  // Find @username patterns and highlight if user is online
  // Match alphanumeric, underscore, and hyphen characters
  var regex = /@([\w-]+)/g;
  return text.replace(regex, function (match, username) {
    // Check if username is in current user list (case-insensitive)
    var onlineUser = currentUserList.find(function (u) {
      var uName = typeof u === "string" ? u : u.nick;
      return uName.toLowerCase() === username.toLowerCase();
    });

    if (onlineUser) {
      var displayName =
        typeof onlineUser === "string" ? onlineUser : onlineUser.nick;
      return (
        boldText() + getUserColor(displayName) + displayName + resetColor()
      );
    }

    return match; // Not online, return as-is
  });
}

function show_help() {
  console_out(color("Available commands:", "yellow"));
  console_out(
    color("  @username <message> - Send a private message", "yellow"),
  );
  console_out(color("  /nick <name> - Change your nickname", "yellow"));
  console_out(color("  /me <action> - Send an emote", "yellow"));
  console_out(color("  /who - Show online users", "yellow"));
  console_out(color("  /kick <user> - Kick a user from chat", "yellow"));
  console_out(color("  /qotd - Get a random quote", "yellow"));
  console_out(color("  /kiss - Send a kiss (ASCII art)", "yellow"));
  console_out(color("  /help - Show this help message", "yellow"));
  console_out(color("  /exit - Log out of chat", "yellow"));
  if (hasAfterDarkAccess) {
    if (currentInstance === "home") {
      console_out(color("  /dark - Switch to After Dark", "red"));
    } else {
      console_out(color("  /home - Switch to Home Chat", "yellow"));
    }
  }
  if (isAfterDarkAdmin && currentInstance === "afterdark") {
    console_out(color("  /invite <user> - Invite user to After Dark", "red"));
    console_out(
      color("  /revoke <user> - Revoke user's After Dark access", "red"),
    );
  }
}

function fetchQuoteOfTheDay() {
  // Notify others that we're fetching a quote
  socket.emit("send", {
    type: "notice",
    message: nick + " requested a quote...",
  });

  var http = require("http");
  var options = {
    hostname: "localhost",
    port: 3010,
    path: "/api/quote",
    method: "GET",
  };

  var req = http.request(options, function (res) {
    var data = "";
    res.on("data", function (chunk) {
      data += chunk;
    });
    res.on("end", function () {
      try {
        var parsed = JSON.parse(data);
        var quote = parsed[0];
        var quoteText = quote.q;
        var author = quote.a;
        // Broadcast the quote to everyone
        socket.emit("send", { type: "quote", text: quoteText, author: author });
      } catch (e) {
        console_out(color("Could not fetch quote: " + e.message, "red"));
      }
    });
  });

  req.on("error", function (err) {
    console_out(color("Could not fetch quote: " + err.message, "red"));
  });

  req.end();
}

rl.on("line", function (line) {
  // Skip if we're in user selection mode
  if (userSelectMode) {
    return;
  }

  // Move cursor up and clear the line to remove the input echo
  process.stdout.write("\x1b[1A"); // Move cursor up one line
  process.stdout.clearLine();
  process.stdout.cursorTo(0);

  if (line[0] == "/" && line.length > 1) {
    var cmd = line.match(/[a-z]+\b/)[0];
    var arg = line.substr(cmd.length + 2, line.length);
    chat_command(cmd, arg);
  } else if (line[0] == "@" && line.length > 1) {
    // Handle @username private message
    var spaceIndex = line.indexOf(" ");
    if (spaceIndex > 1) {
      var to = line.substring(1, spaceIndex);
      var message = line.substring(spaceIndex + 1);
      // Find actual usernames (case-insensitive match)
      var foundTo = currentUserList.find(function (u) {
        var uName = typeof u === "string" ? u : u.nick;
        return uName.toLowerCase() === to.toLowerCase();
      });
      var actualTo = foundTo
        ? typeof foundTo === "string"
          ? foundTo
          : foundTo.nick
        : to;
      var foundFrom = currentUserList.find(function (u) {
        var uName = typeof u === "string" ? u : u.nick;
        return uName.toLowerCase() === nick.toLowerCase();
      });
      var actualFrom = foundFrom
        ? typeof foundFrom === "string"
          ? foundFrom
          : foundFrom.nick
        : nick;
      socket.emit("send", {
        type: "tell",
        message: message,
        to: actualTo,
        from: actualFrom,
      });
      console_out(
        color("[" + actualFrom + " -> " + actualTo + "] ", "red") +
          highlightMentions(formatText(message)),
      );
    } else {
      console_out("Usage: @username message");
    }
    rl.prompt(true);
  } else {
    // send chat message
    socket.emit("send", { type: "chat", message: line, nick: nick });
    rl.prompt(true);
  }
});

function chat_command(cmd, arg) {
  switch (cmd) {
    case "nick":
      var notice = nick + " changed their name to " + arg;
      nick = arg;
      socket.emit("changeNick", nick);
      socket.emit("send", { type: "notice", message: notice });
      break;
    case "me":
      var emote = nick + " " + arg;
      socket.emit("send", { type: "emote", message: emote });
      break;
    case "help":
      show_help();
      break;
    case "who":
      if (currentUserList.length === 0) {
        console_out("No users online.");
      } else {
        console_out(
          color("Online users (" + currentUserList.length + "):", "yellow"),
        );
        currentUserList.forEach(function (user) {
          var username = typeof user === "string" ? user : user.nick;
          var isIdle = typeof user === "object" && user.idle;
          var displayUser = "  " + username;
          if (username === nick) {
            displayUser += " (you)";
          }
          if (isIdle) {
            displayUser += " [idle]";
          }
          console_out(getUserColor(username) + displayUser + resetColor());
        });
      }
      break;
    case "exit":
      var notice = nick + " has left the chat";
      socket.emit("send", { type: "notice", message: notice });
      socket.emit("exit"); // Tell server this is intentional
      console_out(color("Goodbye!", "yellow"));
      socket.disconnect();
      process.exit(0);
      break;
    case "kick":
      if (!arg) {
        console_out("Usage: /kick <username>");
      } else {
        socket.emit("kick", arg);
      }
      break;
    case "qotd":
      fetchQuoteOfTheDay();
      break;
    case "dark":
      if (arg) {
        // Admin password provided
        afterDarkAdminPassword = arg;
        hasAfterDarkAccess = true;
        isAfterDarkAdmin = true;
        // Save home nick and switch
        homeNick = nick;
        if (afterDarkNick) {
          nick = afterDarkNick;
        } else {
          // Prompt for After Dark nickname
          rl.question(
            color("Enter your After Dark nickname: ", "red"),
            function (newNick) {
              if (newNick && newNick.trim()) {
                nick = newNick.trim();
                afterDarkNick = nick;
              }
              connectToInstance("afterdark", true);
            },
          );
          return;
        }
        connectToInstance("afterdark", true);
      } else if (!hasAfterDarkAccess) {
        console_out("That is not a valid command.");
      } else if (currentInstance === "afterdark") {
        console_out("You are already in After Dark.");
      } else {
        homeNick = nick;
        if (afterDarkNick) {
          nick = afterDarkNick;
        } else {
          rl.question(
            color("Enter your After Dark nickname: ", "red"),
            function (newNick) {
              if (newNick && newNick.trim()) {
                nick = newNick.trim();
                afterDarkNick = nick;
              }
              connectToInstance("afterdark", true);
            },
          );
          return;
        }
        connectToInstance("afterdark", true);
      }
      break;
    case "home":
      if (currentInstance === "home") {
        console_out("You are already in Home Chat.");
      } else {
        afterDarkNick = nick;
        nick = homeNick || nick;
        connectToInstance("home", true);
        console_out(color("Welcome back to Home Chat!", "yellow"));
      }
      break;
    case "invite":
      if (!isAfterDarkAdmin) {
        console_out("That is not a valid command.");
      } else if (!arg) {
        console_out("Usage: /invite <username>");
      } else {
        socket.emit("invite", arg);
      }
      break;
    case "revoke":
      if (!isAfterDarkAdmin) {
        console_out("That is not a valid command.");
      } else if (!arg) {
        console_out("Usage: /revoke <username>");
      } else {
        socket.emit("revoke", arg);
      }
      break;
    case "ascii":
      if (!arg) {
        console_out("Usage: /ascii <name> - e.g. /ascii kiss");
      } else {
        socket.emit("ascii", arg);
      }
      break;
    default:
      console_out("That is not a valid command.");
  }
}

var readline = require("readline"),
  socketio = require("socket.io-client"),
  color = require("ansi-color").set;
var nick;
var currentUserList = [];
var socket = socketio("http://localhost:3010");
var rl = readline.createInterface(process.stdin, process.stdout);

// Set the username
rl.question("Please enter a nickname: ", function (name) {
  nick = name;
  socket.emit("register", nick);
  var msg = nick + " has joined the chat";
  socket.emit("send", { type: "notice", message: msg });
  console_out(color("Welcome to the chat!", "yellow"));
  console_out(color("Type /help to see available commands.", "yellow"));
  console_out("");
  // Show user list after a short delay to ensure server has sent the list
  setTimeout(function () {
    if (currentUserList.length > 0) {
      console_out(
        color("Online users (" + currentUserList.length + "):", "yellow"),
      );
      currentUserList.forEach(function (user) {
        var displayUser = "  " + user;
        if (user === nick) {
          displayUser += " (you)";
        }
        console_out(getUserColor(user) + displayUser + resetColor());
      });
      console_out("");
    }
  }, 200);
  rl.prompt(true);
});

function console_out(msg) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  console.log(msg);
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

function show_help() {
  console_out(color("Available commands:", "yellow"));
  console_out(color("  /nick <name> - Change your nickname", "yellow"));
  console_out(
    color("  @username <message> - Send a private message", "yellow"),
  );
  console_out(color("  /me <action> - Send an emote", "yellow"));
  console_out(color("  /who - Show online users", "yellow"));
  console_out(color("  /help - Show this help message", "yellow"));
  console_out(color("  /exit - Log out of chat", "yellow"));
}

rl.on("line", function (line) {
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
      var actualTo =
        currentUserList.find(function (u) {
          return u.toLowerCase() === to.toLowerCase();
        }) || to;
      var actualFrom =
        currentUserList.find(function (u) {
          return u.toLowerCase() === nick.toLowerCase();
        }) || nick;
      socket.emit("send", {
        type: "tell",
        message: message,
        to: actualTo,
        from: actualFrom,
      });
      console_out(
        color("[" + actualFrom + " -> " + actualTo + "] " + message, "red"),
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
          var displayUser = "  " + user;
          if (user === nick) {
            displayUser += " (you)";
          }
          console_out(getUserColor(user) + displayUser + resetColor());
        });
      }
      break;
    case "exit":
      var notice = nick + " has left the chat";
      socket.emit("send", { type: "notice", message: notice });
      console_out(color("Goodbye!", "yellow"));
      socket.disconnect();
      process.exit(0);
      break;
    default:
      console_out("That is not a valid command.");
  }
}

socket.on("message", function (data) {
  var leader;
  if (data.type == "chat" && data.nick != nick) {
    leader =
      getUserColor(data.nick) + "<" + data.nick + ">" + resetColor() + " ";
    console_out(leader + data.message);
  } else if (data.type == "notice") {
    console_out(color(data.message, "cyan"));
  } else if (
    data.type == "tell" &&
    data.to.toLowerCase() == nick.toLowerCase()
  ) {
    leader = color("[" + data.from + "->" + data.to + "]", "red");
    console_out(leader + data.message);
  } else if (data.type == "emote") {
    console_out(color(data.message, "cyan"));
  }
});

socket.on("userList", function (users) {
  currentUserList = users;
});

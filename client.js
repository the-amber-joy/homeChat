var readline = require("readline"),
  socketio = require("socket.io-client"),
  color = require("ansi-color").set;
var nick;
var socket = socketio("http://localhost:3636");
var rl = readline.createInterface(process.stdin, process.stdout);

// Set the username
rl.question("Please enter a nickname: ", function (name) {
  nick = name;
  var msg = nick + " has joined the chat";
  socket.emit("send", { type: "notice", message: msg });
  console_out(color("Welcome to the chat!", "yellow"));
  show_help();
  rl.prompt(true);
});

function console_out(msg) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  console.log(msg);
  rl.prompt(true);
}

function show_help() {
  console_out(color("Available commands:", "yellow"));
  console_out(color("  /nick <name> - Change your nickname", "yellow"));
  console_out(
    color("  /msg <user> <message> - Send a private message", "yellow"),
  );
  console_out(color("  /me <action> - Send an emote", "yellow"));
  console_out(color("  /help - Show this help message", "yellow"));
  console_out(color("  /exit - Log out of chat", "yellow"));
}

rl.on("line", function (line) {
  if (line[0] == "/" && line.length > 1) {
    var cmd = line.match(/[a-z]+\b/)[0];
    var arg = line.substr(cmd.length + 2, line.length);
    chat_command(cmd, arg);
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
      socket.emit("send", { type: "notice", message: notice });
      break;
    case "msg":
      var to = arg.match(/[a-z]+\b/)[0];
      var message = arg.substr(to.length, arg.length);
      socket.emit("send", {
        type: "tell",
        message: message,
        to: to,
        from: nick,
      });
      break;
    case "me":
      var emote = nick + " " + arg;
      socket.emit("send", { type: "emote", message: emote });
      break;
    case "help":
      show_help();
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
    leader = color("<" + data.nick + "> ", "green");
    console_out(leader + data.message);
  } else if (data.type == "notice") {
    console_out(color(data.message, "cyan"));
  } else if (data.type == "tell" && data.to == nick) {
    leader = color("[" + data.from + "->" + data.to + "]", "red");
    console_out(leader + data.message);
  } else if (data.type == "emote") {
    console_out(color(data.message, "cyan"));
  }
});

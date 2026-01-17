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
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});
var io = socketio(server);

// Track connected users
var users = {};

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
    users[socket.id] = nickname;
    io.emit("userList", Object.values(users));
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

  // Handle disconnection
  socket.on("disconnect", function () {
    if (users[socket.id]) {
      var nick = users[socket.id];
      delete users[socket.id];
      io.emit("userList", Object.values(users));
      io.emit("message", {
        type: "notice",
        message: nick + " has disconnected",
      });
    }
  });
});

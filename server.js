var socketio = require("socket.io");
var http = require("http");

// Create HTTP server and Socket.IO instance
var server = http.createServer();
var io = socketio(server);

// Listen on port 3636
server.listen(3636);

io.on("connection", function (socket) {
  var clientIp = socket.handshake.address;
  console.log("A user connected from: " + clientIp);
  // Broadcast a user's message to everyone else in the room
  socket.on("send", function (data) {
    io.emit("message", data);
  });
});

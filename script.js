var socket;
var nick;
var userListVisible = false;
var currentUserList = [];
var clientVersion = localStorage.getItem("appVersion") || null;

// Check if user has a saved nickname
var savedNick = localStorage.getItem("chatNickname");
if (savedNick) {
  document.getElementById("nickname-input").value = savedNick;
  // Auto-join with saved nickname
  setTimeout(function () {
    joinChat();
  }, 100);
}

document.getElementById("join-button").addEventListener("click", joinChat);
document
  .getElementById("nickname-input")
  .addEventListener("keypress", function (e) {
    if (e.key === "Enter") joinChat();
  });

function joinChat() {
  var nickInput = document.getElementById("nickname-input").value.trim();
  if (!nickInput) {
    alert("Please enter a nickname");
    return;
  }

  nick = nickInput;
  // Save nickname to localStorage
  localStorage.setItem("chatNickname", nick);
  document.getElementById("current-nick").textContent = nick;

  // Connect to socket
  socket = io();

  // Register user with server
  socket.emit("register", nick);

  // Send join message
  socket.emit("send", {
    type: "notice",
    message: nick + " has joined the chat",
  });

  // Show chat screen
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

  // Restore chat history if available, otherwise show welcome
  var historyRestored = restoreChatHistory();
  if (!historyRestored) {
    addMessage("Welcome to Home Chat!", "help");
  }

  // Focus on message input after a brief delay to ensure rendering
  setTimeout(function () {
    document.getElementById("message-input").focus();
  }, 100);

  // Listen for messages
  socket.on("message", function (data) {
    handleMessage(data);
  });

  // Listen for user list updates
  socket.on("userList", function (users) {
    updateUserList(users);
  });

  // Listen for version updates
  socket.on("version", function (serverVersion) {
    if (clientVersion && clientVersion !== serverVersion) {
      // Version mismatch - save chat history and reload
      saveChatHistory();
      addMessage("New version available! Reloading in 3 seconds...", "notice");
      setTimeout(function () {
        localStorage.setItem("appVersion", serverVersion);
        location.reload();
      }, 3000);
    } else {
      // Store the version
      localStorage.setItem("appVersion", serverVersion);
      clientVersion = serverVersion;
    }
  });

  // Handle users button click
  document
    .getElementById("users-button")
    .addEventListener("click", function () {
      userListVisible = !userListVisible;
      document.getElementById("users-modal").style.display = userListVisible
        ? "block"
        : "none";
    });

  // Close user list when clicking outside
  document.addEventListener("click", function (e) {
    var usersButton = document.getElementById("users-button");
    var usersModal = document.getElementById("users-modal");
    if (
      userListVisible &&
      e.target !== usersButton &&
      !usersButton.contains(e.target) &&
      !usersModal.contains(e.target)
    ) {
      userListVisible = false;
      usersModal.style.display = "none";
    }
  });

  // Handle sending messages
  document.getElementById("send-button").addEventListener("click", sendMessage);
  document
    .getElementById("message-input")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") sendMessage();
    });
}

function sendMessage() {
  var input = document.getElementById("message-input");
  var line = input.value.trim();

  if (!line) return;

  if (line[0] === "@" && line.length > 1) {
    // Handle private message @username message
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
      addMessage("[" + actualFrom + " -> " + actualTo + "] " + message, "tell");
    } else {
      addMessage("Usage: @username message", "help");
    }
  } else if (line[0] === "/" && line.length > 1) {
    var cmd = line.match(/[a-z]+\b/)[0];
    var arg = line.substr(cmd.length + 2, line.length);
    chatCommand(cmd, arg);
  } else {
    socket.emit("send", { type: "chat", message: line, nick: nick });
    addMessage("<" + nick + "> " + line, "chat", nick);
  }

  input.value = "";
}

function chatCommand(cmd, arg) {
  switch (cmd) {
    case "nick":
      var notice = nick + " changed their name to " + arg;
      nick = arg;
      localStorage.setItem("chatNickname", nick);
      document.getElementById("current-nick").textContent = nick;
      socket.emit("changeNick", nick);
      socket.emit("send", { type: "notice", message: notice });
      break;
    case "me":
      var emote = nick + " " + arg;
      socket.emit("send", { type: "emote", message: emote });
      break;
    case "help":
      showHelp();
      break;
    case "who":
      if (currentUserList.length === 0) {
        addMessage("No users online.", "help");
      } else {
        addMessage("Online users (" + currentUserList.length + "):", "help");
        currentUserList.forEach(function (user) {
          var isCurrentUser = user === nick;
          var displayName = isCurrentUser ? "* " + user : user;
          addUserListItem("  " + displayName, isCurrentUser);
        });
      }
      break;
    case "exit":
      var notice = nick + " has left the chat";
      socket.emit("send", { type: "notice", message: notice });
      addMessage("Goodbye!", "help");
      localStorage.removeItem("chatNickname");
      socket.disconnect();
      setTimeout(function () {
        location.reload();
      }, 1000);
      break;
    default:
      addMessage("That is not a valid command.", "help");
  }
}

function showHelp() {
  addMessage("Available commands:", "help");
  addMessage("  /nick <name> - Change your nickname", "help");
  addMessage("  @username <message> - Send a private message", "help");
  addMessage("  /me <action> - Send an emote", "help");
  addMessage("  /who - Show online users", "help");
  addMessage("  /help - Show this help message", "help");
  addMessage("  /exit - Log out of chat", "help");
}

function getUserColor(username) {
  // Generate a consistent color for each username (case-insensitive)
  var hash = 0;
  var lowerUsername = username.toLowerCase();
  for (var i = 0; i < lowerUsername.length; i++) {
    hash = lowerUsername.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate HSL color, avoiding red hues (0-40) but allowing pink
  // Map to range 40-360 to include pink/magenta but exclude red
  var hue = 40 + (Math.abs(hash) % 320);
  var saturation = 65 + (Math.abs(hash) % 20); // 65-85%
  var lightness = 60 + (Math.abs(hash >> 8) % 15); // 60-75%

  return "hsl(" + hue + ", " + saturation + "%, " + lightness + "%)";
}

function handleMessage(data) {
  if (data.type === "chat" && data.nick !== nick) {
    addMessage("<" + data.nick + "> " + data.message, "chat", data.nick);
  } else if (data.type === "notice") {
    addMessage(data.message, "notice");
  } else if (
    data.type === "tell" &&
    data.to.toLowerCase() === nick.toLowerCase()
  ) {
    addMessage(
      "[" + data.from + " -> " + data.to + "] " + data.message,
      "tell",
    );
  } else if (data.type === "emote") {
    addMessage(data.message, "emote");
  }
}

function addMessage(text, type, nickName) {
  var messagesDiv = document.getElementById("messages");
  var msgDiv = document.createElement("div");
  msgDiv.className = "message " + type;

  if (type === "chat" && nickName) {
    var nickSpan = document.createElement("span");
    nickSpan.className = "nick";
    nickSpan.style.color = getUserColor(nickName);
    nickSpan.textContent = "<" + nickName + "> ";
    msgDiv.appendChild(nickSpan);

    var textNode = document.createTextNode(text.substr(nickName.length + 3));
    msgDiv.appendChild(textNode);
  } else {
    msgDiv.textContent = text;
  }

  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Save chat history after every message
  saveChatHistory();
}

function addUserListItem(text, isCurrentUser) {
  var messagesDiv = document.getElementById("messages");
  var msgDiv = document.createElement("div");
  msgDiv.className = "message userlist";

  // Extract username from text (remove leading spaces and asterisk)
  var username = text.trim().replace(/^\*\s*/, "");

  // Apply color
  msgDiv.style.color = getUserColor(username);

  if (isCurrentUser) {
    msgDiv.classList.add("current-user");
  }
  msgDiv.textContent = text;
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateUserList(users) {
  currentUserList = users;
  var usersList = document.getElementById("users-list");
  var userCount = document.getElementById("user-count");

  userCount.textContent = users.length;
  usersList.innerHTML = "";

  users.forEach(function (user) {
    var userDiv = document.createElement("div");
    userDiv.className = "user-item";
    userDiv.style.color = getUserColor(user);
    if (user === nick) {
      userDiv.textContent = "* " + user;
    } else {
      userDiv.textContent = user;
    }
    usersList.appendChild(userDiv);
  });
}

function saveChatHistory() {
  var messagesDiv = document.getElementById("messages");
  var chatHistory = [];
  var messages = messagesDiv.querySelectorAll(".message");

  messages.forEach(function (msg) {
    chatHistory.push({
      className: msg.className,
      html: msg.innerHTML,
      textContent: msg.textContent,
    });
  });

  // Keep only the last 5000 messages to prevent storage overflow
  if (chatHistory.length > 5000) {
    chatHistory = chatHistory.slice(-5000);
  }

  localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
  localStorage.setItem("chatHistoryTime", Date.now());
}

function restoreChatHistory() {
  var chatHistory = localStorage.getItem("chatHistory");
  var chatHistoryTime = localStorage.getItem("chatHistoryTime");

  // Only restore if less than 24 hours old
  if (
    chatHistory &&
    chatHistoryTime &&
    Date.now() - chatHistoryTime < 24 * 60 * 60 * 1000
  ) {
    var messagesDiv = document.getElementById("messages");
    var messages = JSON.parse(chatHistory);

    messages.forEach(function (msg) {
      var msgDiv = document.createElement("div");
      msgDiv.className = msg.className;
      msgDiv.innerHTML = msg.html;
      messagesDiv.appendChild(msgDiv);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    return true; // History was restored
  } else if (chatHistory) {
    // Clear expired history from localStorage
    localStorage.removeItem("chatHistory");
    localStorage.removeItem("chatHistoryTime");
  }

  return false; // No history to restore
}

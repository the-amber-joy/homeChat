var socket;
var nick;
var userListVisible = false;
var currentUserList = [];
var clientVersion = localStorage.getItem("appVersion") || null;
var userColorCache = {}; // Cache colors by username to persist across nick changes

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
  var messageInput = document.getElementById("message-input");
  messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      if (autocompleteVisible && autocompleteSelected >= 0) {
        selectAutocompleteUser();
        e.preventDefault();
      } else {
        sendMessage();
      }
    }
  });

  // Autocomplete functionality
  var autocompleteVisible = false;
  var autocompleteUsers = [];
  var autocompleteSelected = -1;
  var autocompleteStartPos = -1;

  messageInput.addEventListener("input", function (e) {
    var value = messageInput.value;
    var cursorPos = messageInput.selectionStart;

    // Find @ symbol before cursor
    var atPos = value.lastIndexOf("@", cursorPos - 1);

    if (atPos >= 0 && (atPos === 0 || value[atPos - 1] === " ")) {
      // Extract text after @
      var searchText = value.substring(atPos + 1, cursorPos).toLowerCase();

      // Filter users
      var filtered = currentUserList.filter(function (user) {
        return user.toLowerCase().startsWith(searchText) && user !== nick;
      });

      if (filtered.length > 0) {
        showAutocomplete(filtered, atPos);
      } else {
        hideAutocomplete();
      }
    } else {
      hideAutocomplete();
    }
  });

  messageInput.addEventListener("keydown", function (e) {
    if (!autocompleteVisible) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      autocompleteSelected = Math.min(
        autocompleteSelected + 1,
        autocompleteUsers.length - 1,
      );
      updateAutocompleteSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      autocompleteSelected = Math.max(autocompleteSelected - 1, 0);
      updateAutocompleteSelection();
    } else if (e.key === "Escape") {
      hideAutocomplete();
    } else if (e.key === "Tab" && autocompleteUsers.length > 0) {
      e.preventDefault();
      if (autocompleteSelected < 0) autocompleteSelected = 0;
      selectAutocompleteUser();
    }
  });

  // Hide autocomplete when clicking outside
  document.addEventListener("click", function (e) {
    if (
      e.target !== messageInput &&
      !document.getElementById("autocomplete-dropdown").contains(e.target)
    ) {
      hideAutocomplete();
    }
  });

  function showAutocomplete(users, atPos) {
    autocompleteVisible = true;
    autocompleteUsers = users;
    autocompleteSelected = 0;
    autocompleteStartPos = atPos;

    var dropdown = document.getElementById("autocomplete-dropdown");
    dropdown.innerHTML = "";
    dropdown.style.display = "block";

    users.forEach(function (user, index) {
      var item = document.createElement("div");
      item.className = "autocomplete-item";
      if (index === 0) item.classList.add("selected");
      item.textContent = user;
      item.style.color = getUserColor(user);
      item.addEventListener("mouseenter", function () {
        autocompleteSelected = index;
        updateAutocompleteSelection();
      });
      item.addEventListener("click", function () {
        selectAutocompleteUser();
      });
      dropdown.appendChild(item);
    });
  }

  function updateAutocompleteSelection() {
    var items = document.querySelectorAll(".autocomplete-item");
    items.forEach(function (item, index) {
      if (index === autocompleteSelected) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  function selectAutocompleteUser() {
    if (
      autocompleteSelected >= 0 &&
      autocompleteSelected < autocompleteUsers.length
    ) {
      var selectedUser = autocompleteUsers[autocompleteSelected];
      var value = messageInput.value;
      var cursorPos = messageInput.selectionStart;

      // Replace from @ to cursor with selected username
      var newValue =
        value.substring(0, autocompleteStartPos) +
        "@" +
        selectedUser +
        " " +
        value.substring(cursorPos);
      messageInput.value = newValue;
      messageInput.selectionStart = messageInput.selectionEnd =
        autocompleteStartPos + selectedUser.length + 2;

      hideAutocomplete();
      messageInput.focus();
    }
  }

  function hideAutocomplete() {
    autocompleteVisible = false;
    autocompleteUsers = [];
    autocompleteSelected = -1;
    autocompleteStartPos = -1;
    document.getElementById("autocomplete-dropdown").style.display = "none";
  }
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
        var oldNick = nick.toLowerCase();
      var newNick = arg.toLowerCase();
      
      // Transfer color from old nickname to new nickname
      if (userColorCache[oldNick]) {
        userColorCache[newNick] = userColorCache[oldNick];
        delete userColorCache[oldNick];
      }
      
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
  addMessage("  @username <message> - Send a private message", "help");
  addMessage("  /nick <name> - Change your nickname", "help");
  addMessage("  /me <action> - Send an emote", "help");
  addMessage("  /who - Show online users", "help");
  addMessage("  /help - Show this help message", "help");
  addMessage("  /exit - Log out of chat", "help");
  addMessage("Text formatting:", "help");
  addMessage("  **bold**, *italic*, _underline_, ~strikethrough~", "help");
  addMessage("  Combine and nest styles in any order", "help");
}

function formatText(text) {
  // Escape HTML first to prevent XSS
  var div = document.createElement("div");
  div.textContent = text;
  var escaped = div.innerHTML;

  // Style markers and their corresponding CSS classes
  var markers = [
    { pattern: "**", className: "text-bold", name: "bold" },
    { pattern: "*", className: "text-italic", name: "italic" },
    { pattern: "_", className: "text-underline", name: "underline" },
    { pattern: "~", className: "text-strikethrough", name: "strike" },
  ];

  // Parse text with nested style support
  var result = "";
  var i = 0;
  var activeStyles = {}; // Track which styles are currently active

  while (i < escaped.length) {
    var foundMarker = false;

    // Check for markers (longest first to handle ** before *)
    for (var m = 0; m < markers.length; m++) {
      var marker = markers[m];
      if (escaped.substr(i, marker.pattern.length) === marker.pattern) {
        // Toggle this style
        if (activeStyles[marker.name]) {
          // Close this style
          result += "</span>";
          delete activeStyles[marker.name];
        } else {
          // Open this style - collect all active classes
          activeStyles[marker.name] = true;
          var classes = [];
          for (var s = 0; s < markers.length; s++) {
            if (activeStyles[markers[s].name]) {
              classes.push(markers[s].className);
            }
          }
          result += '<span class="' + classes.join(" ") + '">';
        }
        i += marker.pattern.length;
        foundMarker = true;
        break;
      }
    }

    if (!foundMarker) {
      result += escaped[i];
      i++;
    }
  }

  // Close any unclosed styles
  for (var style in activeStyles) {
    result += "</span>";
  }

  return result;
}

function getUserColor(username) {
  // Check if we have a cached color for this user
  var lowerUsername = username.toLowerCase();
  if (userColorCache[lowerUsername]) {
    return userColorCache[lowerUsername];
  }

  // Generate a consistent color for each username (case-insensitive)
  var hash = 0;
  for (var i = 0; i < lowerUsername.length; i++) {
    hash = lowerUsername.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate HSL color, avoiding red hues (0-40) but allowing pink
  // Map to range 40-360 to include pink/magenta but exclude red
  var hue = 40 + (Math.abs(hash) % 320);
  var saturation = 65 + (Math.abs(hash) % 20); // 65-85%
  var lightness = 60 + (Math.abs(hash >> 8) % 15); // 60-75%

  var color = "hsl(" + hue + ", " + saturation + "%, " + lightness + "%)";
  
  // Cache this color
  userColorCache[lowerUsername] = color;
  
  return color;
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

    var messageText = text.substr(nickName.length + 3);
    var formattedSpan = document.createElement("span");
    formattedSpan.innerHTML = formatText(messageText);
    msgDiv.appendChild(formattedSpan);
  } else if (type === "chat" || type === "emote" || type === "tell") {
    // Apply formatting to chat, emote, and tell messages
    msgDiv.innerHTML = formatText(text);
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
}

function restoreChatHistory() {
  var chatHistory = localStorage.getItem("chatHistory");

  if (chatHistory) {
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
  }

  return false; // No history to restore
}

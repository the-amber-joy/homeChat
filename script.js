var socket;
var nick;
var userListVisible = false;
var settingsVisible = false;
var currentUserList = [];
var clientVersion = localStorage.getItem("appVersion") || null;
var userColorCache = {}; // Cache colors by username to persist across nick changes

// Notification settings - each type can be enabled independently
var notificationSettings = JSON.parse(
  localStorage.getItem("notificationSettings"),
) || {
  private: false,
  tagged: false,
  all: false,
  system: false,
};
var notificationTheme = localStorage.getItem("notificationTheme") || "fard";

// Available notification themes
// Each theme has 3 sounds: private, mention, chat
// Sound files should be at: ./sounds/{theme}/{type}-{theme}.mp3
var notificationThemes = {
  fard: "Fard",
  // Add more themes here:
  // example: "Example"
};

// Get sound file path for a theme and sound type
function getThemeSoundPath(themeName, soundType) {
  return "./sounds/" + themeName + "/" + soundType + "-" + themeName + ".mp3";
}

// System sounds (not theme-dependent)
var systemSounds = {
  hello: "./sounds/system/hello.mp3",
  // Add more system sounds here:
  // goodbye: "./sounds/system/goodbye.mp3"
};

// Preloaded audio cache for instant playback
var preloadedAudio = {};

// Helper function to preload a single audio file
function preloadAudio(key, url) {
  var audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  audio.volume = 0;
  audio
    .play()
    .then(function () {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
    })
    .catch(function () {
      audio.volume = 1;
    });
  preloadedAudio[key] = audio;
}

// Preload all sounds on page load
function preloadAllSounds() {
  // Preload all theme sounds
  Object.keys(notificationThemes).forEach(function (themeName) {
    ["private", "mention", "chat"].forEach(function (soundType) {
      var key = themeName + ":" + soundType;
      preloadAudio(key, getThemeSoundPath(themeName, soundType));
    });
  });

  // Preload system sounds
  Object.keys(systemSounds).forEach(function (soundName) {
    var key = "system:" + soundName;
    preloadAudio(key, systemSounds[soundName]);
  });
}

preloadAllSounds();

// Helper to play a preloaded sound by key
function playPreloadedSound(key, fallbackUrl) {
  if (preloadedAudio[key]) {
    var audio = preloadedAudio[key].cloneNode();
    audio.volume = 1;
    audio.play().catch(function (e) {
      console.log("Audio play failed:", e);
    });
    return;
  }

  // Fallback: create new Audio (will have delay)
  if (fallbackUrl) {
    var audio = new Audio(fallbackUrl);
    audio.play().catch(function (e) {
      console.log("Audio play failed:", e);
    });
  }
}

// Play notification sound based on message type
function playNotificationSound(soundType) {
  if (!notificationThemes[notificationTheme]) {
    console.log("Unknown notification theme:", notificationTheme);
    return;
  }

  var key = notificationTheme + ":" + soundType;
  playPreloadedSound(key, getThemeSoundPath(notificationTheme, soundType));
}

// Play a system sound
function playSystemSound(soundName) {
  if (!notificationSettings.system) return;

  var key = "system:" + soundName;
  playPreloadedSound(key, systemSounds[soundName]);
}

// Update bell icon based on notification settings
function updateBellIcon() {
  var button = document.getElementById("audio-button");
  if (button) {
    var anyEnabled =
      notificationSettings.private ||
      notificationSettings.tagged ||
      notificationSettings.all ||
      notificationSettings.system;
    var iconName = anyEnabled ? "bell" : "bell-off";
    button.innerHTML = '<i data-feather="' + iconName + '"></i>';
    if (typeof feather !== "undefined") {
      feather.replace();
    }
  }
}

// Check if notification should play and return the sound type
function getNotificationSoundType(messageType, messageText) {
  // Private messages
  if (messageType === "tell") {
    if (
      notificationSettings.private ||
      notificationSettings.tagged ||
      notificationSettings.all
    ) {
      return "private";
    }
  }

  // Check for mentions
  var mentionRegex = new RegExp("@" + nick + "\\b", "i");
  var isMentioned = mentionRegex.test(messageText);

  if (isMentioned) {
    if (notificationSettings.tagged || notificationSettings.all) {
      return "mention";
    }
  }

  // Regular chat/emote messages
  if (messageType === "chat" || messageType === "emote") {
    if (notificationSettings.all) {
      return "chat";
    }
  }

  return null;
}

// Legacy function for compatibility - now uses getNotificationSoundType
function shouldPlayNotification(messageType, messageText) {
  return getNotificationSoundType(messageType, messageText) !== null;
}

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

  // Validate nickname contains only alphanumeric, underscore, and hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(nickInput)) {
    alert(
      "Nickname can only contain letters, numbers, underscores, and hyphens",
    );
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

  // Re-register on reconnect (handles idle tab disconnections)
  socket.on("connect", function () {
    if (nick) {
      socket.emit("register", nick);
    }
  });

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
      // Close settings if open
      if (userListVisible && settingsVisible) {
        settingsVisible = false;
        document.getElementById("settings-modal").style.display = "none";
      }
    });

  // Handle audio button click
  document
    .getElementById("audio-button")
    .addEventListener("click", function () {
      settingsVisible = !settingsVisible;
      document.getElementById("settings-modal").style.display = settingsVisible
        ? "block"
        : "none";
      // Close user list if open
      if (settingsVisible && userListVisible) {
        userListVisible = false;
        document.getElementById("users-modal").style.display = "none";
      }
    });

  // Initialize notification setting checkboxes
  var privateCheckbox = document.getElementById("notify-private");
  var taggedCheckbox = document.getElementById("notify-tagged");
  var allCheckbox = document.getElementById("notify-all");
  var systemCheckbox = document.getElementById("notify-system");

  if (privateCheckbox) privateCheckbox.checked = notificationSettings.private;
  if (taggedCheckbox) taggedCheckbox.checked = notificationSettings.tagged;
  if (allCheckbox) allCheckbox.checked = notificationSettings.all;
  if (systemCheckbox) systemCheckbox.checked = notificationSettings.system;

  // Update bell icon based on saved settings
  updateBellIcon();

  // Handle notification setting changes
  function saveNotificationSettings() {
    localStorage.setItem(
      "notificationSettings",
      JSON.stringify(notificationSettings),
    );
    updateBellIcon();
  }

  if (privateCheckbox) {
    privateCheckbox.addEventListener("change", function () {
      notificationSettings.private = this.checked;
      saveNotificationSettings();
    });
  }
  if (taggedCheckbox) {
    taggedCheckbox.addEventListener("change", function () {
      notificationSettings.tagged = this.checked;
      saveNotificationSettings();
    });
  }
  if (allCheckbox) {
    allCheckbox.addEventListener("change", function () {
      notificationSettings.all = this.checked;
      saveNotificationSettings();
    });
  }
  if (systemCheckbox) {
    systemCheckbox.addEventListener("change", function () {
      notificationSettings.system = this.checked;
      saveNotificationSettings();
    });
  }

  // Initialize notification theme dropdown
  var themeSelect = document.getElementById("notification-theme");
  if (themeSelect) {
    themeSelect.value = notificationTheme;
    themeSelect.addEventListener("change", function () {
      notificationTheme = this.value;
      localStorage.setItem("notificationTheme", notificationTheme);
    });
  }

  // Close user list or settings when clicking outside
  document.addEventListener("click", function (e) {
    var usersButton = document.getElementById("users-button");
    var usersModal = document.getElementById("users-modal");
    var audioButton = document.getElementById("audio-button");
    var settingsModal = document.getElementById("settings-modal");

    if (
      userListVisible &&
      e.target !== usersButton &&
      !usersButton.contains(e.target) &&
      !usersModal.contains(e.target)
    ) {
      userListVisible = false;
      usersModal.style.display = "none";
    }

    if (
      settingsVisible &&
      e.target !== audioButton &&
      !audioButton.contains(e.target) &&
      !settingsModal.contains(e.target)
    ) {
      settingsVisible = false;
      settingsModal.style.display = "none";
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

  // Process @mentions BEFORE style processing (on plain text)
  escaped = highlightMentions(escaped);

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

    // Skip style processing inside HTML tags (for @mentions)
    if (escaped[i] === "<") {
      var closingBracket = escaped.indexOf(">", i);
      if (closingBracket !== -1) {
        result += escaped.substring(i, closingBracket + 1);
        i = closingBracket + 1;
        continue;
      }
    }

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

function highlightMentions(text) {
  // Find @username patterns and highlight if user is online
  // Match alphanumeric, underscore, and hyphen characters
  var regex = /@([\w-]+)/g;
  return text.replace(regex, function (match, username) {
    // Check if username is in current user list (case-insensitive)
    var onlineUser = currentUserList.find(function (u) {
      return u.toLowerCase() === username.toLowerCase();
    });

    if (onlineUser) {
      var color = getUserColor(onlineUser);
      return (
        '<span class="text-bold" style="color: ' +
        color +
        '">' +
        onlineUser +
        "</span>"
      );
    }

    return match; // Not online, return as-is
  });
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

/**
 * Handles incoming socket messages and displays them in the chat.
 * Also triggers notification sounds based on message type and user settings.
 *
 * @param {Object} data - The message data from the server
 * @param {string} data.type - Message type: "chat", "notice", "tell", or "emote"
 * @param {string} data.message - The message content
 * @param {string} [data.nick] - Sender's nickname (for chat messages)
 * @param {string} [data.from] - Sender's nickname (for tell/private messages)
 * @param {string} [data.to] - Recipient's nickname (for tell/private messages)
 */
function handleMessage(data) {
  if (data.type === "chat" && data.nick !== nick) {
    addMessage("<" + data.nick + "> " + data.message, "chat", data.nick);
    // Check if we should play notification
    var soundType = getNotificationSoundType("chat", data.message);
    if (soundType) {
      playNotificationSound(soundType);
    }
  } else if (data.type === "notice") {
    addMessage(data.message, "notice");
    // Play system sound for user joins (but not for ourselves)
    if (data.message.indexOf(" has joined the chat") !== -1) {
      // Extract the username from the message
      var joinedUser = data.message.replace(" has joined the chat", "");
      if (joinedUser.toLowerCase() !== nick.toLowerCase()) {
        playSystemSound("hello");
      }
    }
  } else if (
    data.type === "tell" &&
    data.to.toLowerCase() === nick.toLowerCase()
  ) {
    addMessage(
      "[" + data.from + " -> " + data.to + "] " + data.message,
      "tell",
    );
    // Check for private message notification
    var soundType = getNotificationSoundType("tell", data.message);
    if (soundType) {
      playNotificationSound(soundType);
    }
  } else if (data.type === "emote") {
    addMessage(data.message, "emote");
    // Check if we should play notification for emote
    var soundType = getNotificationSoundType("emote", data.message);
    if (soundType) {
      playNotificationSound(soundType);
    }
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
  } else if (type === "emote") {
    // Parse emote to highlight username in bold and their color
    // Emote format: "username action text"
    var spaceIndex = text.indexOf(" ");
    if (spaceIndex > 0) {
      var emoteNick = text.substring(0, spaceIndex);
      var emoteAction = text.substring(spaceIndex + 1);

      var nickSpan = document.createElement("span");
      nickSpan.className = "text-bold";
      nickSpan.style.color = getUserColor(emoteNick);
      nickSpan.textContent = emoteNick;
      msgDiv.appendChild(nickSpan);

      var actionSpan = document.createElement("span");
      actionSpan.innerHTML = " " + formatText(emoteAction);
      msgDiv.appendChild(actionSpan);
    } else {
      msgDiv.innerHTML = formatText(text);
    }
  } else if (type === "chat" || type === "tell") {
    // Apply formatting to chat and tell messages
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

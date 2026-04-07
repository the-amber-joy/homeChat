# Home Chat

Home Chat is a small chatroom app for local household use. Run it on a Raspberry Pi or any always-on machine in your house, then open it from browsers on your local network.

![Home Chat](image.png)

## Features

- browser-based chat for anyone on your home network
- direct messages in a side panel
- public `@username` mentions
- notification sounds for DMs, mentions, chat, and system events
- `/ascii <name>` for built-in ASCII art
- `/qotd` for a shared quote of the day
- invite-only After Dark mode with admin-controlled access
- bundled terminal client

Current ASCII art includes `kiss`, `hug`, and `pikachu`.

Current sound themes include `fard`. That's it. It only makes fart sounds.

## Setup

You need Node.js and npm on the machine hosting the app.

```bash
npm install
```

## Start The Server

```bash
npm start
```

The app listens on port `3010`.

If you want After Dark enabled, also set an admin password. Don't tell the kids!

Mac/Linux:

```bash
AFTERDARK_ADMIN_PASSWORD=your-secret-password npm start
```

Windows cmd:

```cmd
set AFTERDARK_ADMIN_PASSWORD=your-secret-password && npm start
```

Windows PowerShell:

```powershell
$env:AFTERDARK_ADMIN_PASSWORD="your-secret-password"; npm start
```

If no admin password is set, After Dark is disabled.

## Open It Around The House

From other devices on the same network, open the server by hostname or IP.

Examples:

- `http://raspberrypi.local:3010`
- `http://home.local:3010`
- `http://192.168.1.50:3010`

This app is meant for local-network use, not for being exposed directly to the public internet.

## Main Commands

- `@username` mention someone publicly
- `/nick <name>` change nickname
- `/me <action>` send an emote
- `/who` show online users
- `/qotd` post a quote of the day
- `/ascii <name>` share ASCII art
- `/kick <user>` kick a user
- `/help` show help
- `/exit` leave chat
- `/dark` enter After Dark if you already have access
- `/dark <password>` log in as an After Dark admin
- `/home` return to Home Chat
- `/invite <user>` invite someone to After Dark
- `/revoke <user>` remove someone's After Dark access

## Terminal Client

There is also a terminal client in `client.js`.

Same machine as the server:

```bash
node client.js
```

Remote machine on your home network:

Mac/Linux:

```bash
HOMECHAT_SERVER=home.local:3010 node client.js
```

Windows cmd:

```cmd
set HOMECHAT_SERVER=home.local:3010 && node client.js
```

You can also use a full URL such as `http://home.local:3010`.

## Notes

- the browser client is the main polished experience
- the terminal client supports chat, private messages, quotes, ASCII art, and After Dark, but its DM flow is command-line based
- quote of the day depends on the ZenQuotes API

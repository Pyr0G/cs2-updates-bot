# Counter-Strike 2 — Updates

A self-hosted Discord bot that posts Valve's official Counter-Strike 2 announcements with a clean embed and a notification for one configured role.

**Status: 0.1.0 — initial preview.** Live Steam retrieval and offline behavior tests pass. Discord delivery, visual appearance and member notifications still need end-to-end verification before a stable 1.0 release.

## Features

- Official CS2 community announcements: patch notes, regular news and events.
- Linked title, short excerpt, Steam preview image and publication date.
- One configured role mention, with all other mentions disabled.
- Two-minute polling, quiet first startup and persistent duplicate tracking.
- Catch-up pagination, rate-limit handling and manual review after uncertain deliveries.
- Node.js 24+, no third-party dependencies; Windows and cross-platform launch options.

Full announcement text and multiple media items are planned for a later version. This project is unofficial and is not affiliated with Valve or Discord.

## Create and install your Discord bot

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Give the app and bot a name and copy its Application ID.
2. Under Installation, enable Guild Install. Use OAuth2 URL Generator with the `bot` scope and **View Channels, Send Messages, Embed Links** permissions to install it into your server. Administrator permission and privileged intents are unnecessary. No interactions endpoint is required.
3. In your destination text or announcement channel, grant the bot those three permissions. If the notification role is not mentionable, also grant **Mention @everyone, @here, and All Roles** to the bot in this channel only. The code permits only your configured role in outgoing messages. Making the role mentionable is an alternative, but permits other members to mention it too.
4. Enable Developer Mode in Discord under User Settings > Advanced to copy the server, channel and notification role IDs.
5. In the application's Bot page, create/reset its token and keep it private. A reset invalidates the previous token. The Application ID and public key are not bot tokens.

## Configure and run

Install [Node.js](https://nodejs.org/) 24 or newer. No package installation is necessary.

On Windows, open PowerShell in the project folder:

```powershell
.\Setup.ps1
.\Run.ps1 check
.\Run.ps1 send-preview
.\Run.ps1 run
```

Setup asks for the four IDs and the token, with hidden token input, and writes `.env`. It refuses to overwrite an existing `.env`. An optional ignored `settings.local.json` can supply the four ID defaults. The Windows launcher can also find an existing bundled Codex Node runtime.

On other platforms, copy `.env.example` to `.env`, fill in its values locally, then run:

```sh
node --env-file=.env src/main.js check
node --env-file=.env src/main.js send-preview
node --env-file=.env src/main.js run
```

- `check` verifies bot identity, server, channel, role and effective permissions without posting.
- `send-preview` sends an actual embed to the configured channel with **notifications disabled**. It does not change posting history.
- `run` establishes a quiet baseline on first start, then posts new announcements with the configured role mention. Stop with Ctrl+C.

The token is stored in plain text in `.env`; keep this file private and never commit or share it. Local configuration, state and previews are ignored by Git. The repository being public does not install your bot into other servers or keep it running.

Member notification preferences may suppress push notifications even when a role mention is valid. Confirm actual notifications with a member during commissioning.

## Preview and tests

These commands need no Discord credentials and send nothing:

```sh
node src/main.js preview
node --test
```

The preview saves `preview.json` with the latest real Steam announcement and notifications disabled. On Windows, the equivalent commands are `.\Run.ps1 preview` and `.\Run.ps1 test`.

Tests cover source validation, text formatting, restricted mentions, pagination, effective permissions, quiet baselines, duplicate handling and interrupted delivery.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Private bot credential |
| `DISCORD_APPLICATION_ID` | Expected bot application ID |
| `DISCORD_GUILD_ID` | Expected server ID |
| `DISCORD_CHANNEL_ID` | Destination text or announcement channel ID |
| `DISCORD_ROLE_ID` | Only role allowed to receive announcement mentions |
| `POLL_SECONDS` | Check interval; default 120, minimum 60 |
| `STATE_FILE` | Posting history path; default `./data/state.json` |

Launch from the project folder because relative paths resolve from the working directory. Keep `.env` and persistent state when deploying elsewhere.

## Operation and recovery

- The process must keep running and its host must remain awake. Closing the terminal stops it. This version uses Discord's HTTP API without a Gateway connection, so the bot may appear offline while posting successfully.
- Preserve `data/state.json` across restarts. Deleting it creates a new quiet baseline and can lose undelivered updates. Run one instance; a lock guards shared state.
- Normal source failures retry on the next check. Discord rate limits honor `retry_after`. Catch-up includes timestamp boundaries. Upstream omissions or removed announcements cannot be recovered by the bot.
- An ambiguous Discord send leaves a pending delivery and stops posting to avoid duplicate pings. Check the channel for the exact announcement; the Steam news ID appears in its footer. Stop all instances before recovery. If the message exists, run `node --env-file=.env src/main.js resolve-sent STEAM_ID`. If definitely absent, use `resolve-retry` instead, then restart. Leave uncertain cases paused for investigation. Discord nonce protection lasts only a few minutes and cannot guarantee permanent exactly-once delivery.
- After a forced kill, remove a stale `data/state.json.lock` only after confirming no bot process is running. Preserve the history file.
- Announcement edits are not reposted. The bot follows published announcements, not every Steam client activity type or silent depot/build change.

## Sources

- [Steam GetNewsForApp](https://partner.steamgames.com/doc/webapi/ISteamNews)
- [Discord messages and allowed mentions](https://docs.discord.com/developers/resources/message)
- [Discord permissions](https://docs.discord.com/developers/topics/permissions)

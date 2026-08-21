# Steam Wishlist Discord Bot

A small Discord bot that checks Steam wishlist prices and sends a direct message when a game goes on sale.

## Status

The first version includes Steam wishlist checks, Discord commands, and local Windows development controls.

## Setup

Requirements:

- Node.js 22.13 or newer
- A Discord application and bot token
- A public Steam profile with Game details set to Public

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

Never commit `.env` or the database file.

## Windows Local Bot Controls

Run these commands from Windows Explorer, Command Prompt, or PowerShell in the project directory:

```text
start-bot.bat
stop-bot.bat
restart-bot.bat
```

`start-bot.bat` runs `npm run dev` in the project directory and waits up to 60 seconds for actual Discord readiness. An atomic database lock prevents a second bot instance from using the same SQLite file. `stop-bot.bat` first requests cooperative shutdown and waits up to 40 seconds for active checks, notification deliveries, Discord, and SQLite to close. If that deadline is exceeded, it logs a warning and uses `taskkill /T /F` as a last-resort fallback. `restart-bot.bat` performs both operations in order.

The database lock is stored beside SQLite as `<database>.lock` and removed during normal shutdown. On a local filesystem within one host and PID namespace, startup can reclaim a structurally valid lock only when the operating system definitively reports its recorded PID as absent. A live PID, reused PID, malformed metadata, permission error, uncertain process state, or interrupted reclaim claim remains blocked and requires operator verification. Network/shared filesystems and cross-container PID namespaces are not supported for dead-PID inference.

The wrapper PID, Node PID, cooperative request, health snapshot, and redirected output are stored under `.runtime/` (`bot.pid`, `bot.node.pid`, `shutdown.request`, `bot.health.json`, `bot.stdout.log`, and `bot.stderr.log`). The atomic health snapshot contains only lifecycle state, the local process ID, readiness, and UTC timestamps. It is refreshed every 10 seconds and considered fresh by the Windows launcher for 30 seconds. It never contains tokens, Discord/Steam user IDs, game data, or environment values. The directory is ignored by Git.

## Notification Delivery Semantics

Notification delivery is at-least-once. A dedicated scheduler checks the durable notification queue every 60 seconds by default, independently of Steam polling. A claimed notification is retried when it remains in the `sending` state past the recovery timeout, so a process crash does not lose it permanently. Each live Discord delivery has a 20-second total deadline and is cancelled promptly during graceful shutdown. If Discord accepted a message but the response was lost, the bot cannot determine that outcome and a retry can produce a duplicate DM. Transient failures use bounded exponential backoff and stop after five recorded failures; permanent Discord errors such as disabled DMs become terminal immediately. Pending notifications are expired instead of sent when their sale episode is no longer active.

## Commands

- `/setup` configure a Steam wishlist
- `/status` show the last check and configured account
- `/check` trigger a manual check
- `/delete-data confirm:true` permanently delete the caller's stored data

Manual checks have a per-user cooldown. Scheduled users and Steam requests are processed through bounded concurrency queues, and Steam rate-limit responses honor `Retry-After` with bounded retries.

`POLL_INTERVAL_HOURS` configures Steam polling. `NOTIFICATION_RETRY_INTERVAL_SECONDS` configures the independent notification queue scan from 1 to 3600 seconds.

Steam reports wishlist access separately from the JSON body. The bot accepts an empty wishlist only when Steam explicitly marks the request successful. A private or otherwise inaccessible wishlist is reported to the user and does not clear existing sale state. `/setup` verifies access before replacing an existing configuration.

## Stored Data And Deletion

The bot stores the Discord user ID, configured public SteamID64, historical Steam IDs associated with earlier account generations, language, enabled state, and configuration timestamps. It also stores check timestamps/status, observed wishlist app IDs, game names, price/sale episode state, plus notification delivery status, attempt timestamps/counts, retry time, and the last delivery error.

The bot does not request or store Steam passwords, cookies, private-profile credentials, Discord messages, or Discord tokens in SQLite. The Discord bot token remains in `.env`.

Stored user data is retained until the user runs `/delete-data confirm:true` or the operator deletes it. There is no automatic time-based retention policy. The delete command removes the user's configuration and cascades to check state, wishlist state, sale episodes, and notification history. SQLite `secure_delete` is enabled, and deletion is coordinated with active checks and notification delivery so those operations cannot recreate data after deletion completes. Copies already present in external filesystem backups are outside the bot's control and must be removed according to the operator's backup policy.

## License

Licensed under the MIT License. See `LICENSE`.

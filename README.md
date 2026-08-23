# Dealio

Dealio is a Discord bot that checks Steam wishlist prices and sends a direct message when a game goes on sale.

## Status

The first version includes Steam wishlist checks, Discord commands, and local Windows development controls.

## Setup

Requirements:

- Node.js 22.16 or newer
- A Discord application and bot token
- A public Steam profile with Game details set to Public

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

Never commit `.env` or the database file.

`DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are required. `STEAM_WEB_API_KEY` is optional at startup and is needed only to resolve vanity names and `/id/` profile links. Obtain a key from Steam's official [Web API key page](https://steamcommunity.com/dev/apikey), put it only in `.env`, and never commit or log it. Existing SteamID64 and `/profiles/{SteamID64}` setup inputs work without this key.

Slash commands are registered globally and become available in every server where the application was installed with the `applications.commands` scope. Discord's global command propagation can take time, so commands may not appear in every server immediately after startup. Schema changes such as the `/setup` option rename from `steamid64` to `steam-profile` can also take time to appear after deployment. `DISCORD_GUILD_ID` is optional and is used only to remove legacy guild-specific commands from that server during migration; it can be removed after cleanup succeeds.

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

- `/setup` configure a Steam wishlist, notification language, and Steam Store country
- `/region` change the country configured on the caller's Steam Store account
- `/status` show a localized dashboard, Store region, latest currency, notification state, and global minimum discount
- `/check` trigger a manual check
- `/wishlist` show a paginated live wishlist and set game-specific minimum discounts
- `/test-notification` send an example sale embed by DM
- `/delete-data confirm:true` permanently delete the caller's stored data

Manual checks have a per-user cooldown. Scheduled users and Steam requests are processed through bounded concurrency queues, and Steam rate-limit responses honor `Retry-After` with bounded retries.

`/setup steam-profile:` accepts a 17-digit SteamID64, a `steamcommunity.com/profiles/{SteamID64}` link, a `steamcommunity.com/id/{vanity}` link, or a bare vanity name containing 2-32 letters, digits, underscores, or hyphens. Both HTTP and HTTPS Steam links are parsed, but user-provided URLs are never fetched; HTTP input is treated as a Steam identifier and all outbound requests use fixed HTTPS Steam endpoints. Credentials, custom ports, non-Steam hosts, traversal paths, malformed profile paths, and unsafe vanity characters are rejected. Query strings and fragments on otherwise valid Steam profile links are discarded.

`/setup store-country:` is a required autocomplete selection for new setups. Select the country currently configured for the Steam Store account, not the user's physical or Discord location. Dealio does not infer this value because Discord does not expose an authoritative Steam Store country and public Steam profile locations may be unrelated. Existing configurations created before this option are migrated to `TR`, preserving their previous behavior. `/region country:` changes the saved Store country later.

After `/setup`, Dealio immediately saves a notification-free baseline and sends an English DM summary of every game Steam currently confirms as discounted in the selected Store country. Games whose prices are missing or whose app details fail are omitted without preventing confirmed discounts from being sent. This one-time summary ignores global and game-specific thresholds and never enters the durable notification queue. Repeating setup creates a fresh pricing generation, retires old retryable alerts, and preserves game thresholds for the same Steam account. Large summaries are split into Discord-safe batches. If the wishlist request fails completely or Discord DMs are temporarily unavailable, setup remains saved and the ephemeral response explains why no summary was delivered.

Steam app-detail requests use the saved country as `cc` and the notification language as Steam's response-text language. The currency and prices come directly from Steam's regional `price_overview`; Dealio does not ask users to choose a currency and does not convert currencies. `/status` shows the selected Store region and currencies from the latest known current-region prices. Sale and test-notification footers also identify the Store region.

The `/status` dashboard includes a notification toggle. Disabling notifications pauses automatic Steam checks and notification retries without deleting wishlist state, pending notifications, batches, or delivery history. Manual `/check` remains available while disabled and can update the persisted wishlist/check state, but it never sends sale DMs. Re-enabling resumes automatic checks and allows still-active queued notifications to be delivered by a later retry cycle. A Discord delivery already in progress may finish before the coordinated disable operation completes.

The global minimum discount defaults to `0`, which accepts any real discount. Use the `/status` button to set a whole percentage from `0` to `100`. Each game shown by `/wishlist` has its own threshold button; a game-specific value overrides the global value, and submitting that modal empty removes the override. A known not-on-sale game starts an eligible sale episode when it goes on sale. If that episode starts below its effective threshold, it can create one notification candidate later when the discount reaches the threshold. The initial wishlist observation remains a notification-free baseline.

Changing the Store country creates a new pricing generation. Pending notifications from the previous region are expired, old regional prices are never compared with new ones, and the first successful check in the new region establishes a notification-free baseline. Global and game-specific minimum-discount settings are preserved when only the Store country changes.

`POLL_INTERVAL_HOURS` configures Steam polling. `NOTIFICATION_RETRY_INTERVAL_SECONDS` configures the independent notification queue scan from 1 to 3600 seconds.

Steam reports wishlist access separately from the JSON body. The bot accepts an empty wishlist only when Steam explicitly marks the request successful. A private or otherwise inaccessible wishlist is reported to the user and does not clear existing sale state. `/setup` first resolves the input to a canonical SteamID64, then verifies wishlist access before replacing an existing configuration. A failed vanity lookup, missing optional key, invalid input, or confirmed inaccessible wishlist leaves the existing configuration unchanged. A transient Steam validation failure may still save the configuration, but it never produces a sale summary from unavailable price data.

A successful Steam snapshot is persisted atomically with its check summary. An item whose latest app-detail observation has an unknown price or an item-level Steam error keeps its previous sale episode but cannot be delivered until a later known observation confirms the same episode. Candidate and failed retries resume with the latest confirmed price snapshot; an already-sending batch keeps the documented at-least-once behavior. A confirmed not-on-sale observation or wishlist removal ends the episode and expires its pending alert. This prevents partial database writes and stale prices from becoming sale messages.

## Stored Data And Deletion

The bot stores the Discord user ID, canonical public SteamID64, historical Steam IDs associated with earlier account generations, selected Steam Store country code, language, enabled state, global and game-specific minimum discount settings, and configuration timestamps. It does not store the submitted vanity name, raw profile link, URL query/fragment, or Steam Web API key. It also stores check timestamps/status, observed wishlist app IDs, game names, regional price/currency and sale-episode state, latest observation reliability, plus notification delivery status, attempt timestamps/counts, retry time, and the last delivery error.

The bot does not request or store Steam passwords, cookies, login information, private-profile credentials, Discord messages, or Discord tokens in SQLite. Discord and Steam API credentials remain in `.env`.

Stored user data is retained until the user runs `/delete-data confirm:true` or the operator deletes it. There is no automatic time-based retention policy. The delete command removes the user's configuration and cascades to check state, wishlist state, sale episodes, and notification history. SQLite `secure_delete` is enabled, and deletion is coordinated with active checks and notification delivery so those operations cannot recreate data after deletion completes. Copies already present in external filesystem backups are outside the bot's control and must be removed according to the operator's backup policy.

## Legal Pages And GitHub Pages

The English legal pages are in `docs/terms.html` and `docs/privacy.html`. Keep the operator's legal and contact information, effective dates, jurisdiction, venue, hosting arrangement, providers, and actual data practices up to date when the Service changes. The Privacy Policy currently describes the bot as running on an operator-controlled personal computer. Update the hosting, recipient, transfer, security, backup, and retention sections when the bot moves to a VDS or another provider.

To publish them with GitHub Pages:

1. Push the repository to GitHub.
2. In the repository settings, open **Pages**.
3. Select **Deploy from a branch**, choose the default branch, and select `/docs` as the folder.
4. After deployment, verify that `/terms.html` and `/privacy.html` open in a private browser window.
5. Add those two public HTTPS URLs to the Discord Developer Portal application's **Terms of Service URL** and **Privacy Policy URL** fields.

The legal pages are static and do not need the bot process to be running. They must remain publicly reachable even if the source repository is private; use a public legal-pages repository or a Pages provider that supports this setup if GitHub does not expose a public site for the selected plan.

## License

Licensed under the MIT License. See `LICENSE`.

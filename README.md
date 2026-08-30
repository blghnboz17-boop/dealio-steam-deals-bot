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

## Admin Panel

The Turkish admin panel runs as a separate process from the bot. It remains available while the bot is stopped and provides health, incident, usage, notification, batch, and Discord server-count summaries at `/admin/login`. It reads `.runtime/bot.health.json` and SQLite in read-only mode. An unavailable source is shown as unavailable, never as a false healthy state or a zero. Discord/Steam identifiers, logs, raw errors, paths, and secrets are not displayed.

Generate a verifier for every administrator. Passwords must be 14-256 UTF-8 bytes. Run the command below, type the password at the hidden prompt, and press Enter:

```text
npm run admin:password
```

The command also accepts exactly one line on standard input for automation and rejects command-line passwords.

Put only the generated scrypt verifier in `ADMIN_USERS_JSON`. Usernames use lowercase letters, digits, dots, underscores, or hyphens and begin with a letter. Multiple administrators can sign in independently:

```dotenv
ADMIN_PUBLIC_ORIGIN=https://admin.example.com
ADMIN_USERS_JSON={"operator":"paste-first-generated-verifier","backup.operator":"paste-second-generated-verifier"}
ADMIN_PORT=3001
ADMIN_HEALTH_PATH=./.runtime/bot.health.json
```

`ADMIN_PUBLIC_ORIGIN` is required and must exactly match the canonical, pathless HTTPS origin visible in the browser. `ADMIN_PORT` defaults to `3001`; `ADMIN_HEALTH_PATH` defaults to `./.runtime/bot.health.json`; the existing `DATABASE_PATH` selects the SQLite database.

The Node listener is always `127.0.0.1` and must not be exposed or port-forwarded directly to the internet. Put an HTTPS reverse proxy in front of it, preserve the original `Host`, and terminate TLS and HSTS at that proxy. A minimal Caddy configuration for a dedicated hostname is:

```caddyfile
admin.example.com {
  header Strict-Transport-Security "max-age=31536000"

  reverse_proxy 127.0.0.1:3001 {
    header_up Host {http.request.host}
    header_up X-Dealio-Client-IP {remote_host}
  }
}
```

This HSTS policy applies to the dedicated admin hostname for one year. Add
`includeSubDomains` or `preload` only if every affected subdomain satisfies those policies.

The proxy must use `header_up`, not `+header_up`, so any client-supplied
`X-Dealio-Client-IP` value is overwritten. Login challenges and throttling trust only this
single header when the TCP peer is loopback; `X-Forwarded-For`, `Forwarded`, and
`X-Real-IP` are never identity inputs. Direct login access to the Node listener is
intentionally unsupported, and the listener must remain loopback-only; other local
processes are part of the trusted host boundary. A missing or malformed identity fails
login without a socket-address fallback. This requires no environment or persisted-data
migration. Sessions and login challenges are both held in memory, so restarting the admin
process invalidates both and requires administrators to sign in again.

Keep the bot and panel as separate long-running services. For development run `npm run admin:dev`. For production build first, then start the compiled panel independently:

```bash
npm run build
npm run admin:start
```

Start, stop, and restart controls call the existing `scripts/bot-control.ps1` through `powershell.exe`. They work on the supported Windows setup; on a non-Windows host the monitoring panel remains available but lifecycle actions fail safely.

Authentication uses opaque Secure, HttpOnly, SameSite=Strict cookies, independent CSRF tokens, bounded login throttling, 30-minute idle sessions, eight-hour absolute sessions, and exact Host/Origin checks. Audit records are written to standard output with allowlisted fields only. Capture that output with the service manager without logging or exporting environment variables.

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

- `/dealio` open the main Dealio control panel
- `/setup` open the guided, branded Steam wishlist setup wizard once per stored user
- `/region` change the country configured on the caller's Steam Store account
- `/status` open the account, tracking, notification, and latest-check panel
- `/check` trigger a manual check
- `/wishlist` show three compact games per page and set game-specific minimum discounts
- `/test-notification` send an example sale panel by DM
- `/delete-data` open the protected data-deletion confirmation flow

Manual checks have a per-user cooldown. Scheduled users and Steam requests are processed through bounded concurrency queues, and Steam rate-limit responses honor `Retry-After` with bounded retries.

`/setup` opens an ephemeral five-minute wizard only when the invoking Discord user has no stored configuration. One focused Discord modal contains both the Steam profile field and a native Store-country dropdown. The dropdown preselects the country inferred from the user's Discord locale and contains 24 common regions plus **Other countries**. Choosing that option opens the complete localized country catalog in alphabetical ranges, so users never need to know or type a country code. The confirmation panel also exposes the same full country picker, while `/region` remains an autocomplete shortcut. The profile field accepts a 17-digit SteamID64, a `steamcommunity.com/profiles/{SteamID64}` link, a `steamcommunity.com/id/{vanity}` link, or a bare vanity name containing 2-32 letters, digits, underscores, or hyphens. After a successful setup, running `/setup` again is rejected before Steam is contacted. The user can manage the existing setup from `/dealio`, `/status`, `/region`, and `/wishlist`; starting over requires the protected `/delete-data` confirmation flow first. Both HTTP and HTTPS Steam links are parsed, but user-provided URLs are never fetched; HTTP input is treated as a Steam identifier and all outbound requests use fixed HTTPS Steam endpoints. Credentials, custom ports, non-Steam hosts, traversal paths, malformed profile paths, and unsafe vanity characters are rejected. Query strings and fragments on otherwise valid Steam profile links are discarded.

The wizard suggests a country from the Discord locale, but the user confirms the country configured for the Steam Store account from the list. Discord does not expose an authoritative Steam Store country and public Steam profile locations may be unrelated. `/region country:` changes the saved Store country later through complete-catalog autocomplete.

The wizard validates the Steam identity and public wishlist before showing a confirmation card. Nothing is saved until the user explicitly enables proactive sale DMs. Dealio then saves a notification-free baseline and sends one localized branded DM that keeps the banner summary visible while presenting exactly one discounted game per page. Owner-bound previous/next buttons replace the contents of that same message, ordered by discount, instead of stacking multiple game cards or sending multiple DMs. Games whose prices are missing or whose app details fail are omitted without preventing confirmed discounts from being sent. This one-time summary ignores global and game-specific thresholds and never enters the durable notification queue. A permanent Discord DM block pauses automatic notifications and appears on `/status`; a transient Discord failure does not become a false sale.

Steam app-detail requests use the saved country as `cc` and the notification language as Steam's response-text language. The currency and prices come directly from Steam's regional `price_overview`; Dealio does not ask users to choose a currency and does not convert currencies. `/status` shows the selected Store region and currencies from the latest known current-region prices. Sale and test-notification footers also identify the Store region.

The native Discord Components V2 interface uses a shared visual system for `/dealio`, `/status`, `/wishlist`, `/check`, `/region`, setup, deletion, and sale messages. The main dashboard links to the common panels. Wishlist pages contain up to three compact games with filters and game-specific threshold controls. New sale DMs group up to five games; persisted legacy groups of up to ten remain deliverable. UI sessions are owner-bound and expire with disabled controls; stale buttons after a restart receive a localized expiry response.

The `/status` dashboard includes a notification toggle. Disabling notifications pauses automatic Steam checks and notification retries without deleting wishlist state, pending notifications, batches, or delivery history. Manual `/check` remains available while disabled and can update the persisted wishlist/check state, but it never sends sale DMs. Re-enabling resumes automatic checks and allows still-active queued notifications to be delivered by a later retry cycle. A Discord delivery already in progress may finish before the coordinated disable operation completes.

The global minimum discount defaults to `0`, which accepts any real discount. Use the `/status` button to set a whole percentage from `0` to `100`. Each game shown by `/wishlist` has its own threshold button; a game-specific value overrides the global value, and submitting that modal empty removes the override. A known not-on-sale game starts an eligible sale episode when it goes on sale. If that episode starts below its effective threshold, it can create one notification candidate later when the discount reaches the threshold. The initial wishlist observation remains a notification-free baseline.

Changing the Store country creates a new pricing generation. Pending notifications from the previous region are expired, old regional prices are never compared with new ones, and the first successful check in the new region establishes a notification-free baseline. Global and game-specific minimum-discount settings are preserved when only the Store country changes.

`POLL_INTERVAL_HOURS` configures Steam polling. `NOTIFICATION_RETRY_INTERVAL_SECONDS` configures the independent notification queue scan from 1 to 3600 seconds. `DEALIO_BANNER_URL` optionally points to the public HTTPS copy of `docs/assets/dealio-onboarding-banner.png`; the setup and initial-DM panels also include the bot avatar so the presentation remains branded if the remote banner cannot be displayed.

Steam reports wishlist access separately from the JSON body. The bot accepts an empty wishlist only when Steam explicitly marks the request successful. A private or otherwise inaccessible wishlist is reported to the user and does not create sale state. `/setup` first resolves the input to a canonical SteamID64, then verifies wishlist access before creating the configuration. A failed vanity lookup, missing optional key, invalid input, inaccessible wishlist, or transient Steam validation failure leaves the user unconfigured.

A successful Steam snapshot is persisted atomically with its check summary. An item whose latest app-detail observation has an unknown price or an item-level Steam error keeps its previous sale episode but cannot be delivered until a later known observation confirms the same episode. Candidate and failed retries resume with the latest confirmed price snapshot; an already-sending batch keeps the documented at-least-once behavior. A confirmed not-on-sale observation or wishlist removal ends the episode and expires its pending alert. This prevents partial database writes and stale prices from becoming sale messages.

## Stored Data And Deletion

The bot stores the Discord user ID, canonical public SteamID64, historical Steam IDs associated with earlier account generations, selected Steam Store country code, language, enabled state, DM opt-in time, latest permanent DM-block state, global and game-specific minimum discount settings, and configuration timestamps. It does not store the submitted vanity name, raw profile link, URL query/fragment, or Steam Web API key. It also stores check timestamps/status, observed wishlist app IDs, game names, regional price/currency and sale-episode state, latest observation reliability, plus notification delivery status, attempt timestamps/counts, retry time, and the last delivery error.

The bot does not request or store Steam passwords, cookies, login information, private-profile credentials, Discord messages, or Discord tokens in SQLite. Discord and Steam API credentials remain in `.env`.

Stored user data is retained until the user completes `/delete-data` and its required confirmation checkbox or the operator deletes it. Closing or cancelling the confirmation changes nothing. The delete command removes the user's configuration and cascades to check state, wishlist state, sale episodes, and notification history. SQLite `secure_delete` is enabled, and deletion is coordinated with active checks and notification delivery so those operations cannot recreate data after deletion completes. Copies already present in external filesystem backups are outside the bot's control and must be removed according to the operator's backup policy.

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

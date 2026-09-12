# Development

[Product overview](../README.md) · [Türkçe tanıtım](../README.tr.md) · [Architecture](architecture.md)

## Isolated setup

Use Node.js **22.16 or later**. CI checks Node.js 22 and 24. The source repository is private; access to it is separate from installing the hosted bot.

Create a **separate Discord application** for development. Enable both **Guild Install** and **User Install** in its installation settings; the command definitions support both. A production token must never be used for local testing.

From a repository checkout on Linux or WSL:

```bash
npm ci
npm ci --prefix .opencode
[ -e .env.test ] || install -m 600 .env.test.example .env.test
```

Create the test file once; do not overwrite an existing configured file. Enter the test application's `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` directly in `.env.test`. Do not paste tokens into a chat, a commit, or a screenshot.

The template uses a separate SQLite database at `./data/test-wishlist.db`. Leave `DEALIO_PRODUCTION=false` and keep the real production application ID in `PRODUCTION_DISCORD_CLIENT_ID`. Local startup rejects that production ID.

```bash
DOTENV_CONFIG_PATH=.env.test npm run dev
```

Install the test application in a test server, then run `/setup` and `/dealio`. No privileged Discord gateway intents are required. An optional `STEAM_WEB_API_KEY` enables vanity-name resolution; numeric SteamID64 and numeric profile links do not require it.

## Verify changes

```bash
npm run typecheck
npm run typecheck:handoff
npm test
npm run build
```

The `.opencode` dependencies are needed for the handoff tests included in the full suite. A successful build alone is not a substitute for those checks.

For a built local test process:

```bash
DOTENV_CONFIG_PATH=.env.test npm start
```

Use one process per test application. Discord component sessions are in memory, so open fresh panels after a restart.

## UI review

`npm run preview:ui` generates an approximate local page from the component builders and demo data. Its renderers may lag newer panels; it is not a complete Discord renderer. Use Discord desktop and mobile for final acceptance, including nested buttons, modals, themes, expiry, error states, and a real DM test.

## Production modes

The existing Azure VM is the sole production host. The current limited-beta rollout uses `DEALIO_PRODUCTION=true` and an explicitly pinned `DEALIO_SINGLE_HOST_MACHINE_ID`. Startup checks `/etc/machine-id`; a local application-ID lock also rejects a second process using a different database under the same OS user.

This is **not** a distributed lock. Cloned machine identities or separate OS users are outside that guarantee.

The planned cloud mode uses `AZURE_LEASE_CONTAINER_URL` and a pre-provisioned application lock blob. Uncertain lease renewal disconnects the bot. Azure credentials, credit coverage, remote backup, monitoring, and public legal links must be verified before the general release gates can pass.

See [Azure operations](../deploy/azure/README.tr.md) and [deployment evidence](../deploy/IMPLEMENTATION-STATUS.tr.md). Restore matching code **and database** when rolling back across a schema migration. Do not include `.env` in backup archives.

## Secrets and repository hygiene

- `.env` and `.env.test` are ignored; commit only example files.
- Keep databases, runtime files, tokens, and private user data out of the repository.
- An MIT license file does not make a private repository publicly browsable.
- Docs-only changes need link/content/render checks; runtime changes require the project checks above.

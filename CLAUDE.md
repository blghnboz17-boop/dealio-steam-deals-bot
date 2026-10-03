# Project Instructions

## Goal

Dealio is a personal Steam price assistant inside Discord. It follows a user's
public Steam wishlist and sends direct messages when a game matches the user's
own price rules, with the context needed to trust the alert.

## Rules

- Use TypeScript with strict mode.
- Keep Steam, Discord, persistence, and scheduling code in separate modules (`src/steam`, `src/discord`, `src/persistence`, `src/application`, `src/domain`, `src/operations`, `src/price-history`).
- Never commit secrets. Read tokens and IDs from environment variables.
- Use Node's built-in `node:sqlite` module; avoid native database dependencies.
- Add tests for price-change, rule-matching, and duplicate-notification logic.
- External requests must have timeouts and must not turn an unavailable API into a false sale.
- Persist sale candidates and delivery attempts before calling Discord. Delivery is at-least-once, never promised as exactly-once.
- Run `npm run typecheck` and `npm test` after implementation changes. `npm run typecheck:scenarios` and `npm run build` must also pass before a release.

## Current Scope

Dealio is in **limited beta** on a single Azure VM. Implemented:

- Per-user setup (`/setup`), Steam Store country and language, English and Turkish panels (Discord Components V2).
- Polling waits thirty minutes after a completed scan by default (`POLL_INTERVAL_HOURS=0.5`); notification retries run independently every 60 seconds. This is polling, not a Steam event feed.
- Per-game rules: inherit the global discount threshold, a game-specific percentage, or a currency-bound target price; muting is independent.
- Notify only when a game changes from not-on-sale to on-sale, or crosses a rule threshold. Saving a rule or finishing setup records a baseline and never sends an initial alert for an existing discount.
- Notification timing: on detection, IANA-timezone quiet hours, or a daily digest. Pending offers are revalidated before delivery.
- Sale alerts show Steam's historical low for the user's Store region from the IsThereAnyDeal API (optional `ITAD_API_KEY`; same currency only, never converted; failures omit the line and never delay or block delivery).
- Persistent deduplication per sale episode; delivery history, DM access test, and `/delete-data`.
- Price observations kept 90 days, notification history shown for 30 days; shared five-minute price cache.
- Operations: encrypted off-site backup and restore rehearsal (GitHub Actions), independent Healthchecks alerts, a static public site (privacy, terms, help) on GitHub Pages, release gate (`npm run release:check`), and anonymous latency metrics (`npm run metrics:report`).

Out of scope: payments, a separate web dashboard, other stores, estimated currency conversion, Steam credentials or private wishlists, real-time Steam events.

## Operating Constraints

- Production is one Azure VM (`dealiobot`). Never run a second copy with the production Discord token; use a separate test application (`.env.test`, see `docs/development.md`).
- The VM has 1 GiB RAM: build, typecheck, and the full test suite run locally or in CI, not on the VM. Deploy a verified `dist` (see `deploy/README.tr.md`).
- No paid cloud resources. Azure Blob leasing and the Bicep template exist in code but are not provisioned; the single-host machine-ID pin and process lock protect production.
- The general public release gate is closed. Phase 4 (real-user acceptance) is in progress; see `docs/phase4-beta.tr.md` for scenarios, measurement rules, and results. Do not widen access or claim desktop/mobile, English, or one-week acceptance without real evidence and the owner's approval. The owner shares invitations; never message users on your own.
- Evidence and acceptance records live in `docs/` and `deploy/`; do not mark a gate as passed without a recorded real run.

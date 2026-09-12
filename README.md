<p align="center">
  <img src="docs/assets/dealio-onboarding-banner.png" alt="Dealio — a blue price tag and heart on a dark background" width="960">
</p>

<h1 align="center">🎮 Your wishlist. Your rules.</h1>

<p align="center">
  A personal Steam price assistant, right inside Discord.<br>
  Choose your price. Choose your notification schedule. Keep the context.
</p>

<p align="center">
  <strong>🧪 Limited beta</strong> &nbsp;·&nbsp; 💙 Free to use &nbsp;·&nbsp; 🎮 Steam only &nbsp;·&nbsp; English &amp; Türkçe
</p>

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1540325119690412172&amp;integration_type=0&amp;scope=bot%20applications.commands&amp;permissions=0"><img src="https://img.shields.io/badge/Add_to_Discord-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Add Dealio to Discord"></a>
  <a href="#commands"><img src="https://img.shields.io/badge/Explore_commands-1B2838?style=for-the-badge&amp;logo=steam&amp;logoColor=white" alt="Explore commands"></a>
</p>

<p align="center">
  <a href="#commands"><img src="https://img.shields.io/badge/Steam-wishlist_tracking-171D25?style=flat-square&amp;logo=steam&amp;logoColor=white" alt="Steam wishlist tracking"></a>
  <a href="README.tr.md"><img src="https://img.shields.io/badge/T%C3%BCrk%C3%A7e-English-2980B9?style=flat-square" alt="Türkçe and English"></a>
  <a href="#start-in-discord"><img src="https://img.shields.io/badge/Setup-no_Steam_password-238636?style=flat-square" alt="No Steam password required"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-8B5CF6?style=flat-square" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1540325119690412172&amp;integration_type=0&amp;scope=bot%20applications.commands&amp;permissions=0"><strong>Try Dealio in Discord →</strong></a>
  &nbsp;&nbsp; <a href="README.tr.md">🇹🇷 Türkçe</a>
  &nbsp;&nbsp; <a href="#commands">💬 Commands</a>
  &nbsp;&nbsp; <a href="#beta-status">🧪 Beta status</a>
</p>

---

## 🎮 Less checking. More choosing.

Dealio follows your public Steam wishlist and sends matching price alerts by DM. Browse game artwork, set a target, and see when a price was observed—all from a private Discord panel.

| 🎯 Your price | 🔕 Your schedule | 📊 Your context |
| :--- | :--- | :--- |
| Set a target price or a discount threshold for each game. Mute the games you want to skip. | Get alerts when detected, hold them during quiet hours, or choose a daily digest. | See Steam's regional currency, recent observed prices, and the reason behind an alert. |

### ✨ Inside Dealio

- 🏠 **A personal home.** Featured game artwork, observed prices, matching deals, and direct access to your wishlist, alert timing, and history.
- 🎮 **A wishlist you can work with.** Three compact game cards per page, name search, matching-deal filters, and a detail view for each game.
- 🎯 **Rules that stay yours.** A game can use your global discount threshold, its own percentage, or a target price in its Steam currency. Muting is independent.
- 📬 **A delivery record.** Pending, delivered, blocked, and expired alerts, with a way to test DM access. “Delivered to Discord” does not mean “read.”
- 📊 **An honest price history.** Up to 90 days of Dealio's own observations. New games may have little history; this is not an all-time-low database.
- 🌍 **Two languages.** Turkish and English panels, including setup, settings, and notifications.

<a name="start-in-discord"></a>

## 🚀 Start in Discord

1. **[Add Dealio to your server](https://discord.com/oauth2/authorize?client_id=1540325119690412172&integration_type=0&scope=bot%20applications.commands&permissions=0).** No administrator permission is requested.
2. **Run `/setup`.** Enter your SteamID64 or profile link, confirm your Steam Store country and language, then explicitly enable sale DMs.
3. **Open `/dealio`.** Browse your wishlist, choose a game, and set the price you want.

Your Steam wishlist must be publicly readable, and Discord must allow DMs from the bot. Dealio does not ask for a Steam password, cookie, or login session.

## 🔔 How alerts work

**Checks run on a 30-minute schedule, not a live Steam event feed.** The next automatic scan is scheduled 30 minutes after the previous scan completes. Steam or Discord outages can add delay.

| Stage | What happens |
| :--- | :--- |
| Observe | Read Steam prices for your configured country and language. Successful app-price requests share a five-minute cache; the original observation time is preserved. |
| Match | Evaluate your game's target or discount rule. An unavailable price is not treated as a deal. |
| Wait, if needed | Keep qualifying alerts in a persistent queue for quiet hours, a daily digest, or delivery retries. |
| Revalidate & deliver | Check pending offers again before sending. Offers confirmed to have ended are not sent. |

Setup establishes a baseline and can send a separate wishlist summary. It does **not** send a new-sale alert for every existing discount. Likewise, saving a target that the current price already meets does not create an initial alert.

Prices stay in Steam's reported currency, with no estimated exchange-rate conversion. Target prices are currency-bound; a region/currency change may require a new target. Always confirm the checkout price on Steam.

<a name="commands"></a>

## 💬 Commands

| Command | Purpose |
| :--- | :--- |
| `/dealio` | Your home: deals, tracking, and personal controls |
| `/setup` | Connect your Steam profile and choose your preferences |
| `/wishlist` | Browse, search, set targets, mute games, and inspect price observations |
| `/status` | Account settings, global discount threshold, and notification status |
| `/check` | Request a check, subject to a short cooldown |
| `/region` | Choose your Steam Store country |
| `/test-notification` | Send yourself a sample notification |
| `/delete-data` | Delete your active account data after confirmation |

Panels are private and bound to the person who opened them. After a timeout or bot restart, open a fresh command to continue.

<a name="beta-status"></a>

## 🧪 Beta status

**Current stage: limited beta on the existing Azure VM.** The core assistant is running. On 12 September 2026, 648 automated tests passed, CI passed on Node.js 22 and 24, and the owner reported that the manual checklist appeared to work. This is useful feedback, not a documented pass for every device or long-running delivery scenario.

Before announcing a general open beta:

- [ ] Publish accessible privacy, terms, and help pages; update the Discord application links.
- [ ] Verify Azure credit coverage before provisioning additional resources.
- [ ] Enable remote backups, run a restore rehearsal, and test an independent operational alert.
- [ ] Validate the distributed application lease and record desktop/mobile and timed-delivery acceptance.

The current deployment has a pinned-host startup restriction, an application lock, and a local rollback backup. Cloud lease, backup, monitoring, and website deployment code is prepared; those external services are **not yet provisioned**.

[Deployment evidence and remaining work →](deploy/IMPLEMENTATION-STATUS.tr.md)

## 🔒 Privacy & control

Dealio stores your account identifiers, preferences, game rules, observed wishlist prices, and delivery records. It does not collect ordinary Discord message content or Steam credentials.

Notification history displays the last **30 days**; price observations are retained for **90 days**. Active deliveries and ongoing-offer deduplication records may be kept longer. `/delete-data` removes active account records; existing backup copies are not rewritten by that command.

Policy sources are available in the repository: [privacy](docs/privacy.html) · [terms](docs/terms.html). Public policy endpoints are still a release prerequisite.

## ❓ A few useful answers

<details>
<summary><strong>I set a target. Why didn't a DM arrive immediately?</strong></summary>

Saving a rule establishes its starting state. An already-matching offer is visible in the panel; alerts wait for a later qualifying transition. Check the game's rule, mute state, and your notification schedule.

</details>

<details>
<summary><strong>Can I pause alerts without deleting my setup?</strong></summary>

Yes. Use the notification toggle in `/status`. Your settings remain available. Manual `/check` still works while automatic notifications are disabled.

</details>

<details>
<summary><strong>Can an alert arrive twice?</strong></summary>

Persistent deduplication prevents routine repeats for the same offer. If Discord accepts a message but its confirmation is lost, a retry can still produce a duplicate. Delivery is not guaranteed to be exactly once.

</details>

## 🛠️ Build & operate

TypeScript · discord.js Components V2 · SQLite · Azure VM

- [Development guide](docs/development.md) — isolated setup, environment, and checks
- [Architecture](docs/architecture.md) — pricing, rules, delivery, and persistence
- [Azure operations](deploy/azure/README.tr.md) — deployment prerequisites and recovery
- [CI runs](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml) — current verification

The first release stays focused on Steam wishlists. Payments, a separate web dashboard, other stores, and estimated currency conversion are outside its scope.

---

<p align="center">
  Built by <a href="https://github.com/blghnboz17-boop">Bilgehan</a> · <a href="LICENSE">MIT license</a> · Source repository is private.<br>
  <sub>Dealio is an independent project, not affiliated with Valve or Discord.</sub>
</p>

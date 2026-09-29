<p align="center">
  <img src="docs/assets/dealio-onboarding-banner.png" alt="Dealio — a blue price tag and heart on a dark background" width="960">
</p>

<h1 align="center">🎮 Your wishlist. Your rules.</h1>

<p align="center">
  A personal Steam price assistant, right inside Discord.<br>
  Pick your price. Choose when to hear about it. Let Dealio keep watch.
</p>

<p align="center">
  <a href="https://blghnboz17-boop.github.io/dealio-public-pages/index-en.html"><img src="https://img.shields.io/badge/Join_the_beta-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Join the beta"></a>
  <a href="#commands"><img src="https://img.shields.io/badge/Explore_commands-1B2838?style=for-the-badge&amp;logo=steam&amp;logoColor=white" alt="Explore commands"></a>
  <a href="#latest-updates"><img src="https://img.shields.io/badge/Latest_updates-8B5CF6?style=for-the-badge" alt="Latest updates"></a>
</p>

<p align="center">
  <a href="#commands"><img src="https://img.shields.io/badge/Steam-wishlist_tracking-171D25?style=flat-square&amp;logo=steam&amp;logoColor=white" alt="Steam-wishlist tracking"></a>
  <a href="README.tr.md"><img src="https://img.shields.io/badge/T%C3%BCrk%C3%A7e-English-2980B9?style=flat-square" alt="Türkçe-English"></a>
  <a href="#start-in-discord"><img src="https://img.shields.io/badge/Setup-no_Steam_password-238636?style=flat-square" alt="Setup-no Steam password"></a>
</p>

<p align="center">
  <a href="#beta-status"><img src="https://img.shields.io/badge/Status-Limited_beta-8B5CF6?style=flat-square" alt="Limited beta"></a>
  <a href="https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-View_checks-238636?style=flat-square&amp;logo=github" alt="View GitHub checks"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2980B9?style=flat-square" alt="MIT"></a>
</p>

<p align="center">
  <a href="https://blghnboz17-boop.github.io/dealio-public-pages/index-en.html">🌐 Dealio</a> &nbsp; · &nbsp; <a href="#latest-updates">✨ Latest updates</a> &nbsp; · &nbsp; <a href="#commands">💬 Commands</a> &nbsp; · &nbsp; <a href="README.tr.md">🇹🇷 Türkçe</a>
</p>

---

## 🎮 Less checking. More playing.

There's a game on your Steam wishlist, but the price isn't quite right. Tell Dealio what you'd like to pay. It checks Steam at regular intervals and sends you a Discord DM when your rule is met.

Set a different target for each game, or use one discount threshold across your list. Choose quiet hours if you don't want late-night notifications. To browse your games or change a setting, just open `/dealio`.

| 🎯 Your price | 🔕 Your schedule | 📊 Your context |
| :--- | :--- | :--- |
| Set a target price or a discount threshold for each game. Mute the games you want to skip. | Get alerts when detected, hold them during quiet hours, or choose a daily digest. | See Steam's regional currency, recent observed prices, and the reason behind an alert. |

### ✨ What's inside?

- 🏠 **One place to start.** Game artwork, matching deals, notification settings, and history.
- 🎮 **A list you can browse.** Search, filter, move through three-game pages, or open a game's details.
- 🎯 **A choice for each game.** Use your default discount threshold, set a different percentage, or enter a target price. Mute games you want to skip.
- 📬 **A record of your alerts.** See pending and sent DMs, and try a test message if delivery isn't working. A delivery record doesn't mean the message was read.
- 📊 **Prices over time.** Dealio keeps its own observations for 90 days. Newly tracked games may have little history; these records don't establish an all-time low.
- 🌍 **English and Turkish.** Both are available throughout setup, menus, and notifications. A human-led Turkish localization pass is also underway.

<a name="latest-updates"></a>

## ✨ Latest updates

> **30 September 2026 · Limited beta, first users**
>
> Three desktop users completed setup with the Türkiye store and Turkish menus. They reported no problems with the commands they tried. We're now watching how notifications hold up in everyday use.

Completed in this round: notification and latency measurements, reliability scenarios, encrypted offsite backups, a restore rehearsal, independent email alerts, and published help and privacy pages.

[Beta notes, TR](docs/phase4-beta.tr.md) · [Operations record, TR](docs/phase3-acceptance.tr.md) · [GitHub Releases](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/releases)

<sub>The latest tagged GitHub release is `discord`, published on 25 August 2026. The updates above are newer; that tag does not identify the current live bot revision.</sub>

<a name="start-in-discord"></a>

## 🚀 Start in Discord

Dealio is being tested with a small group. If you'd like to join, get in touch through the [beta page](https://blghnboz17-boop.github.io/dealio-public-pages/index-en.html). It's free to use; the general invite will open after acceptance testing.

1. **Join a server with the bot.** We'll share access details when you join the beta.
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

The bot runs on the existing Azure VM. **Real-user testing is underway; general-release acceptance is still pending.**

- [x] First Turkish desktop setup and command trials
- [x] Encrypted offsite backup, restore, and independent alarm exercises
- [x] Published help, privacy, and terms pages
- [ ] At least seven days of real-world use
- [ ] Real sale alerts, scheduled delivery, and duplicate checks
- [ ] English, mobile, and consented data-deletion trials

[Roadmap and acceptance notes, TR →](docs/phase4-beta.tr.md)

## 🔒 Privacy & control

Dealio stores your account identifiers, preferences, game rules, observed wishlist prices, and delivery records. It does not collect ordinary Discord message content or Steam credentials.

Notification history displays the last **30 days**; price observations are retained for **90 days**. Active deliveries and ongoing-offer deduplication records may be kept longer. `/delete-data` removes active account records; existing backup copies are not rewritten by that command.

[Privacy](https://blghnboz17-boop.github.io/dealio-public-pages/privacy.html) · [Terms](https://blghnboz17-boop.github.io/dealio-public-pages/terms.html) · [Help](https://blghnboz17-boop.github.io/dealio-public-pages/help.html)

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

Dealio records the alerts it sends and skips routine repeats for the same offer. If Discord accepts a message but its acknowledgement is lost, a retry can still produce a duplicate. Please report it if you see one.

</details>

## 🛠️ Build & operate

TypeScript · discord.js Components V2 · SQLite · Azure VM

- [Development guide](docs/development.md) — isolated setup, environment, and checks
- [Architecture](docs/architecture.md) — pricing, rules, delivery, and persistence
- [Current operations setup, TR](deploy/FREE-OPERATIONS.tr.md) — free backups, alerts, and recovery
- [CI runs](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml) — current verification

The first release stays focused on Steam wishlists. Payments, a separate web dashboard, other stores, and estimated currency conversion are outside its scope.

---

<p align="center">
  Made by <a href="https://github.com/blghnboz17-boop">Bilgehan</a>. Still growing. 💙 · <a href="LICENSE">MIT license</a> · Source repository is private.<br>
  <sub>Dealio is an independent project, not affiliated with Valve or Discord.</sub>
</p>

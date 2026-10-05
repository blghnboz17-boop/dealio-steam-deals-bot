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
  <a href="https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/releases/tag/v0.1.0-beta.1"><img src="https://img.shields.io/badge/Beta-v0.1.0--beta.1-8B5CF6?style=flat-square" alt="Limited beta v0.1.0-beta.1"></a>
  <a href="https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-View_checks-238636?style=flat-square&amp;logo=github" alt="View GitHub checks"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2980B9?style=flat-square" alt="MIT"></a>
</p>

---

## 🎮 Less checking. More playing.

There's a game on your Steam wishlist, but the price isn't quite right. Tell Dealio what you'd like to pay. It checks Steam at regular intervals and sends you a Discord DM when your rule is met.

Set a different target for each game, or use one discount threshold across your list. Choose quiet hours if you don't want late-night notifications. To browse your games or change a setting, just open `/dealio`.

| 🎯 Your price | 🔕 Your schedule | 📊 Your context |
| :--- | :--- | :--- |
| Set a target price or a discount threshold for each game. Mute the games you want to skip. | Get alerts when detected, hold them during quiet hours, or choose a daily digest. | See Steam's regional currency, recent observed prices, and the reason behind an alert. |

## 👀 A look inside Discord

<table>
  <tr>
    <td width="50%" valign="top"><strong>🏠 Dealio · your home panel</strong><br><br><a href="docs/assets/screenshots/dealio-home-desktop.png"><img src="docs/assets/screenshots/dealio-home-desktop.png" alt="Dealio home panel with Black Flag artwork, a matching deal, and wishlist, schedule and history controls" width="380"></a></td>
    <td width="50%" valign="top"><strong>🎮 Wishlist · games and price rules</strong><br><br><a href="docs/assets/screenshots/wishlist-desktop.png"><img src="docs/assets/screenshots/wishlist-desktop.png" alt="Dealio desktop wishlist with games, prices and alert controls" width="300"></a><br><br><strong>📬 A sale alert in your DMs</strong><br><br><a href="docs/assets/screenshots/sale-dm-example.png"><img src="docs/assets/screenshots/sale-dm-example.png" alt="An earlier Outbound sale DM showing price, discount and savings" width="380"></a></td>
  </tr>
</table>

<sub>Real Discord screenshots shared by the user, with English UI. The DM is an example from 22 September 2026; prices and some interface details may differ from the current version.</sub>

### ✨ What's inside?

- 🏠 **One place to start.** Game artwork, matching deals, notification settings, and history.
- 🎮 **A list you can browse.** Search, filter, move through three-game pages, or open a game's details.
- 🎯 **A choice for each game.** Use your default discount threshold, set a different percentage, or enter a target price. Mute games you want to skip.
- 📬 **A record of your alerts.** See pending and sent DMs, and try a test message if delivery isn't working. A delivery record doesn't mean the message was read.
- 📊 **Prices over time.** Alerts and game details show Steam's historical low for your Store region (from IsThereAnyDeal, same currency only), and the game detail lists recent price changes. Dealio keeps its own price observations for 90 days.
- 👤 **Switch accounts without starting over.** Change your Steam account from ⚙️ Settings with the same profile form as setup; your default discount, alert timing and language stay.
- 🌍 **Turkish, English, German and French.** Every language covers setup, menus, and notifications, written in a friendly first-person voice and using Steam’s own words for the wishlist in each language. German and French are new and have not had real-user trials yet.

<a name="latest-updates"></a>

## ✨ Latest updates

> **4 October 2026 · Account switch and steadier alerts**
>
> You can now change your Steam account from ⚙️ Settings without deleting your data. If Steam briefly leaves a game out of your wishlist, Dealio no longer treats it as a new sale when the game comes back, so you won't get duplicate alerts. Sale DMs now carry only the panel button; the optional support link moved to the Home panel. New sign-ups are capped while the beta runs on a single server.

> **30 September 2026 · Limited beta, first users**
>
> Three desktop users completed setup with the Türkiye store and Turkish menus. They reported no problems with the commands they tried. We're now watching how notifications hold up in everyday use.

This release brings together the notification reliability work and beta preparations. [Read the v0.1.0-beta.1 notes →](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/releases/tag/v0.1.0-beta.1)


<a name="start-in-discord"></a>

## 🚀 Start in Discord

Dealio is being tested with a small group. If you'd like to join, get in touch through the [beta page](https://blghnboz17-boop.github.io/dealio-public-pages/index-en.html). It's free to use; the general invite will open after acceptance testing. The beta has a limited number of places; when they're full, `/setup` says so and saves nothing.

1. **Join a server with the bot.** We'll share access details when you join the beta.
2. **Run `/setup`.** Pick your language, enter your Steam profile link, custom URL name or SteamID64, confirm your Steam Store country, then explicitly enable sale DMs.
3. **Open `/dealio`.** Browse your wishlist, choose a game, and set the price you want.

Your Steam profile and “Game details” must be public so the wishlist can be read, and Discord must allow DMs from the bot. Dealio does not ask for a Steam password, cookie, or login session.

## 🔔 When will I hear from Dealio?

Dealio checks again **30 minutes after each scan finishes**. When a price change meets your rule, it sends a DM according to your notification schedule. Steam or Discord issues can add delay.

Initial setup may send a summary of existing discounts, rather than a new-sale alert for each one. Saving a rule, or changing your default discount, while a game already meets it won't trigger a DM either; Dealio alerts when that sale gets clearly better (at least 10 more discount points, or a met target 10% lower). Prices use your selected Steam Store currency; check the final price on Steam before buying.

<a name="commands"></a>

## 💬 Commands

| Command | Purpose |
| :--- | :--- |
| `/dealio` | Your panel: 🏠 Home, 🎮 Wishlist, 🔔 Alerts and ⚙️ Settings |
| `/setup` | Connect your Steam profile and choose your preferences |
| `/delete-data` | Delete your active account data after confirmation |

Everything else is in the `/dealio` panel: browse and search your wishlist, set targets or mute games, choose when alerts arrive, check Steam now, send a test DM, and change your region, language or Steam account in ⚙️ Settings (which also has *Delete my data*).

Panels are private and bound to the person who opened them. After a timeout or bot restart, open a fresh command to continue.

<a name="beta-status"></a>

## 🧪 Beta status

Three users reported successful Turkish desktop setup and command trials. We're now working through at least seven days of real-world use. English, mobile, and longer-running delivery checks remain on the list before the general invite opens.

## 🔒 Privacy & control

Dealio stores your account identifiers, preferences, game rules, observed wishlist prices, and delivery records. It does not collect ordinary Discord message content or Steam credentials.

Notification history displays the last **30 days**; price observations are retained for **90 days**. Active deliveries and ongoing-offer deduplication records may be kept longer. `/delete-data` removes active account records. Existing backup copies are not rewritten, but a separate deletion record (a one-way hash of your Discord ID, kept for 35 days) makes sure a restore from backup can't bring your data back.

[Privacy](https://blghnboz17-boop.github.io/dealio-public-pages/privacy.html) · [Terms](https://blghnboz17-boop.github.io/dealio-public-pages/terms.html) · [Help](https://blghnboz17-boop.github.io/dealio-public-pages/help.html)

## ❓ A few useful answers

<details>
<summary><strong>What can I do if I get a “Failed” error?</strong></summary>

That message alone doesn't tell us the cause, and it doesn't necessarily mean you did anything wrong. Steam may not have returned prices, Discord may not have completed an action, or something may have gone wrong inside Dealio. Any extra detail in the message helps narrow it down.

Give it a moment, then try the command once more. If a cooldown is shown, wait for it to finish. If an old panel's button isn't working, open a fresh panel with `/dealio`. Still stuck? Use the [help page](https://blghnboz17-boop.github.io/dealio-public-pages/help.html) to share the command, approximate time, and error text. Hide personal details in screenshots; you don't need to delete your setup and start over as a first step.

</details>

<details>
<summary><strong>The bot works, but I'm not getting DMs. What should I check?</strong></summary>

Start with **Test DM** in `/dealio` → ⚙️ Settings. If the sample doesn't arrive either, check that you haven't blocked the bot and that you allow DMs from your shared server. If tracking was paused because DMs were blocked, press **Resume tracking** in ⚙️ Settings after fixing the setting.

If the test arrives but a sale alert doesn't, check your notification status in `/dealio` → ⚙️ Settings, the game's target or discount threshold, its mute setting, and your quiet hours or daily digest. A test DM confirms you can receive messages; it doesn't mean every game currently qualifies for an alert.

</details>

<details>
<summary><strong>My Steam profile was found, but my wishlist won't load. Why?</strong></summary>

Check that the profile link is correct and your wishlist is visible to other people. Try opening your wishlist link in a browser window where you aren't signed into Steam; being able to see your profile alone may not be enough.

If you've just changed your Steam privacy settings, give it a moment and try again. If the list opens while signed out but Dealio still can't read it, Steam may be temporarily unavailable. If another attempt doesn't help, [let us know](https://blghnboz17-boop.github.io/dealio-public-pages/help.html). Please don't share your Steam password or session details.

</details>

<details>
<summary><strong>I set a target. Why didn't a DM arrive immediately?</strong></summary>

Saving a rule establishes its starting state. An already-matching offer is visible in the panel; Dealio alerts when the price drops at least 10% further, or when it rises above your target and comes back. Check the game's rule, mute state, and your notification schedule. If your Store region changed currency, save the target again; until then the default discount rule applies.

</details>

<details>
<summary><strong>How do I switch to another Steam account?</strong></summary>

Open `/dealio` → ⚙️ Settings → **Change Steam account**. The same profile form as setup opens; Dealio shows the new account and switches only after you confirm. Your default discount, alert timing and language stay. Rules, targets and waiting alerts for the old account's games don't carry over, and games already on sale in the new list don't trigger alerts. You no longer need `/delete-data` for this.

</details>

<details>
<summary><strong>Can I pause alerts without deleting my setup?</strong></summary>

Yes. Press **Pause tracking** in `/dealio` → ⚙️ Settings. Your settings remain available, and **Check Steam now** on 🏠 Home still works while tracking is paused.

</details>

<details>
<summary><strong>Can an alert arrive twice?</strong></summary>

Dealio records the alerts it sends and skips routine repeats for the same offer. A game that Steam briefly leaves out of your wishlist keeps its sale state for a short grace period, so its return isn't a new sale. If Discord accepts a message but its acknowledgement is lost, a retry can still produce a duplicate. Please report it if you see one.

</details>

## 🛠️ Build & operate

TypeScript · discord.js Components V2 · SQLite · Azure VM

- [Development guide](docs/development.md) — isolated setup, environment, and checks
- [Architecture](docs/architecture.md) — pricing, rules, delivery, and persistence
- [Current operations setup, TR](deploy/FREE-OPERATIONS.tr.md) — free backups, alerts, and recovery
- [CI runs](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml) — current verification

The first release stays focused on Steam wishlists. Payments, a separate web dashboard, other stores, and estimated currency conversion are outside its scope.

<details>
<summary><strong>Technical details and beta checklist</strong></summary>

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

## 🧪 Beta status

The bot runs on the existing Azure VM. **Real-user testing is underway; general-release acceptance is still pending.**

- [x] First Turkish desktop setup and command trials
- [x] Encrypted offsite backup, restore, and independent alarm exercises
- [x] Published help, privacy, and terms pages
- [ ] At least seven days of real-world use
- [ ] Real sale alerts, scheduled delivery, and duplicate checks
- [ ] English, mobile, and consented data-deletion trials

[Roadmap and acceptance notes, TR →](docs/phase4-beta.tr.md)


</details>

---

<p align="center">
  Made by <a href="https://github.com/blghnboz17-boop">Bilgehan</a>. Still growing. 💙 · <a href="LICENSE">MIT license</a> · Source repository is private.<br>
  <sub>Dealio is an independent project, not affiliated with Valve or Discord.</sub>
</p>

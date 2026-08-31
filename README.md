# 🎮 Dealio

> 🌐 **Language / Dil:** [🇺🇸 English](README.md) · [🇹🇷 Türkçe](README.tr.md)

**A Discord bot that watches your Steam wishlist and sends you a direct message the moment a game actually goes on sale — with the region, currency, discount and observation time attached, so you can decide without leaving Discord.**

![Discord](https://img.shields.io/badge/Discord-Add%20to%20server-5865F2?logo=discord&logoColor=white)
![Steam](https://img.shields.io/badge/Steam-wishlist%20tracking-000000?logo=steam&logoColor=white)
![Languages](https://img.shields.io/badge/languages-T%C3%BCrk%C3%A7e%20%C2%B7%20English-informational)
![Setup](https://img.shields.io/badge/setup-no%20password%20required-success)
![License](https://img.shields.io/badge/license-MIT-blue)

---

> ⚠️ **Notice:** Dealio is an independent project and is **not affiliated with, endorsed by, or sponsored by Valve Corporation or Discord Inc.** It reads only **publicly visible** Steam wishlist data and never asks for your Steam password, cookies or login. Prices come directly from Steam and are shown as-is — always confirm the final price on the Steam store page before you buy.

---

## 🚀 Getting Started

No downloads. No terminal. No Steam login. Three steps:

### 1️⃣ Add Dealio to your server

👉 **[Add Dealio to Discord](https://discord.com/oauth2/authorize?client_id=1540325119690412172&scope=bot+applications.commands&permissions=0)**

### 2️⃣ Run `/setup`

A private wizard opens — only you can see it. It asks for two things:

| Field | What to enter |
|---|---|
| **Steam profile** | Your SteamID64, a profile link, or just your vanity name |
| **Store country** | Picked from a dropdown — Dealio pre-selects a guess from your Discord language |

Anything below works for the profile field:

```text
76561198012345678                                  ← SteamID64
https://steamcommunity.com/profiles/765611980...   ← profile link
https://steamcommunity.com/id/yourname             ← vanity link
yourname                                           ← just the name
```

### 3️⃣ Turn on sale DMs

Dealio checks that your wishlist is readable, shows you a confirmation card, and **saves nothing until you explicitly enable direct messages.**

That's it. From then on, Dealio watches your wishlist in the background.

---

## ✅ Before You Start

Only two things need to be true:

| Requirement | How to check |
|---|---|
| **Your Steam profile is public** | Steam → Profile → Edit Profile → Privacy Settings → set **Game details** to *Public* |
| **Your Discord DMs are open** | Server settings → Privacy Settings → allow direct messages from server members |

> Dealio can only read what is already public. It never asks for your Steam password, cookies, session, or any login information.

---

## ✨ What Makes Dealio Different

- **It never invents a sale.** When Steam returns an unknown price, an error for one game, or goes down entirely, Dealio records that as exactly what it is. A failure is never turned into "on sale!"
- **Your region, your prices.** Dealio uses the Steam Store country you configured, so the price you see is the price *you* actually pay — not a US number you have to convert in your head.
- **The first run is silent.** Installing Dealio does not dump 200 DMs on you. The first look at your wishlist is a quiet baseline; alerts start from the next real change.
- **One alert per sale.** Not one per check. If a game is on sale for two weeks, you hear about it once.
- **You set the bar.** A global minimum discount for everything, plus a separate threshold for individual games you care more about.
- **Pause without losing anything.** Turn notifications off and your wishlist, thresholds and history stay exactly where they were.
- **Nothing happens without your consent.** No data is saved until you confirm, and `/delete-data` erases all of it whenever you want.
- **Turkish and English.** Full interface in both, including correctly formatted local prices.

---

## 💬 Commands

| Command | What it does |
|---|---|
| `/dealio` | Opens the main control panel |
| `/setup` | One-time setup wizard (Steam profile + Store country) |
| `/status` | Your account, tracking state, notification settings and last check |
| `/wishlist` | Browse your wishlist, three games per page, and set per-game discount thresholds |
| `/check` | Check right now instead of waiting for the next scheduled run |
| `/region` | Change your Steam Store country |
| `/test-notification` | Send yourself a sample sale message to see what an alert looks like |
| `/delete-data` | Erase everything Dealio knows about you |

> Every panel is private to you and expires on its own. Buttons only respond to the person who opened them.

---

## 🔔 What an Alert Looks Like

When a game passes your threshold, you get a DM containing:

- 🎮 **Game name**
- 💸 **Original price → sale price**, in your region's currency
- 📉 **Discount percentage**
- 🌍 **The Store region** the price came from
- 🕐 **When the price was observed**
- 🔗 **A direct link to the Steam page**

Several games that go on sale together are grouped into **one message**, ordered by discount — not five separate DMs.

**Prices are never converted.** Dealio shows exactly what Steam reports for your region, in that region's currency. It does not guess exchange rates.

---

## ⚙️ How It Works

```
        Your Steam wishlist (public)
                    │
                    ▼
        Dealio checks it every few hours
                    │
                    ▼
   ┌────────────────────────────────────┐
   │  Is this a real, confirmed sale?   │
   │  ✅ yes  → does it pass your bar?  │
   │  ❓ unknown price → wait, don't ask│
   │  ⚠️ Steam error → wait, don't ask  │
   └────────────────┬───────────────────┘
                    │  yes to both
                    ▼
        Queued for delivery (survives restarts)
                    │
                    ▼
              📬 Direct message to you
```

The check loop and the delivery loop run **separately**, so a Discord hiccup can never stop Steam from being checked, and a Steam outage can never block a message that was already queued.

If a delivery fails temporarily, Dealio retries with growing gaps and gives up after five attempts. If your DMs are closed, that is permanent — it stops trying and tells you on `/status`.

---

## 🔒 Your Data

**What Dealio stores:** your Discord user ID, your public SteamID64, your chosen Store country and language, whether notifications are on, your discount thresholds, the games on your wishlist with their observed prices, and the delivery status of your notifications.

**What Dealio never stores:** Steam passwords, cookies, login details, your Discord messages, the vanity name you typed, or the raw profile link you pasted.

**Deleting everything:** run `/delete-data` and tick the confirmation box. It removes your configuration, wishlist state, sale history and notification records together, using SQLite's secure-delete mode. Closing or cancelling the confirmation changes nothing.

📄 Full details: [Privacy Policy](docs/privacy.html) · [Terms of Service](docs/terms.html)

---

## ❓ FAQ

<details>
<summary><b>I set it up but haven't received anything. Is it broken?</b></summary>

Probably not. The first look at your wishlist is a **silent baseline** — Dealio records what is already on sale without messaging you, so you don't get flooded on day one. You'll be notified when something *changes* after that.

Also check `/status` — if your global minimum discount is set high, games below it are filtered out.
</details>

<details>
<summary><b>Dealio says it can't read my wishlist.</b></summary>

Your Steam profile's **Game details** setting must be *Public*. Steam → Profile → Edit Profile → Privacy Settings. "Friends only" is not enough — Dealio isn't your friend on Steam and never asks to be.
</details>

<details>
<summary><b>The price shown is different from what I see on Steam.</b></summary>

Check `/status` to see which Store country is configured. If it's wrong, fix it with `/region`. Changing your region starts fresh — old prices are never compared against new ones, and you get a new silent baseline.
</details>

<details>
<summary><b>I got the same game twice.</b></summary>

Rare, but possible. If Discord accepts a message and the confirmation is lost in transit, Dealio can't tell whether it arrived and may retry. We'd rather send twice than lose an alert — and we say so instead of pretending it can't happen.
</details>

<details>
<summary><b>How do I stop the notifications without losing my setup?</b></summary>

Use the notification toggle on `/status`. Your wishlist, thresholds and history stay intact. Manual `/check` still works while notifications are off. Turn it back on whenever you like.
</details>

<details>
<summary><b>The commands don't show up in my server.</b></summary>

Dealio's commands are registered globally, and Discord can take up to an hour to propagate them everywhere. Try again a bit later.
</details>

<details>
<summary><b>How often is my wishlist checked?</b></summary>

Every few hours by default. You can always force a fresh check with `/check` — there's a short per-user cooldown to keep things fair.
</details>

<details>
<summary><b>Can I only get alerts for big discounts?</b></summary>

Yes. Set a global minimum on `/status`, then use `/wishlist` to give individual games their own threshold. A per-game value overrides the global one.
</details>

---

## 🗺️ Roadmap

| Coming up | |
|---|---|
| 🎯 **Target price** | "Tell me when this drops below X" |
| 📊 **Historical low** | See whether this is genuinely the best price yet |
| 🏷️ **Price change type** | Real sale · permanent price cut · regional change — clearly separated |
| 💱 **Approximate local cost** | With the exchange rate and timestamp shown, never mixed with the Steam price |
| 🔕 **Quiet hours & digests** | Batch alerts instead of instant, on your schedule |
| 👥 **Server summaries** | Opt-in, low-noise channel digests |

**Deliberately never:** asking for your Steam password or cookies · unauthorized key resellers in results · sponsored placement mixed into "best deal" ordering.

---

## 👤 Author

Built by **[@blghnboz17-boop](https://github.com/blghnboz17-boop)**

Technical architecture is documented in [`docs/architecture.md`](docs/architecture.md).

---

## 📄 License

MIT — see [LICENSE](LICENSE)

import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { storeCountryName, type StoreCountryCode } from '../../domain/store-country.js';
import type { Language } from '../../domain/user-config.js';
import type { StoreFacts, UpcomingRelease, WishlistItem, WishlistItemError } from '../../domain/steam.js';
import { formatMinorPrice } from '../notification-messages.js';
import { dealioBrand } from './brand.js';
import { openPanelCustomId } from './components-v2.js';
import type { DealioTab } from './tab-bar.js';

/**
 * The shared look of every Dealio screen: one header pattern, one accent per
 * tab, and the same price line and badges, so the four tabs read as one app.
 */
export const tabAccent: Record<DealioTab, number> = {
  home: dealioBrand.colors.primary,
  games: dealioBrand.colors.success,
  alerts: dealioBrand.colors.accent,
  settings: 0xc7d5e0,
};

const sectionNames: Record<DealioTab, { readonly emoji: string; readonly tr: string; readonly en: string }> = {
  home: { emoji: '🏠', tr: 'ANA SAYFA', en: 'HOME' },
  games: { emoji: '🎮', tr: 'OYUNLARIM', en: 'MY GAMES' },
  alerts: { emoji: '🔔', tr: 'BİLDİRİMLER', en: 'ALERTS' },
  settings: { emoji: '⚙️', tr: 'AYARLAR', en: 'SETTINGS' },
};

/** "-# 🎮 DEALIO · OYUNLARIM", a large title and an optional one-line subtitle. */
export function panelHeader(tab: DealioTab, language: Language, title: string, subtitle?: string): string {
  const section = sectionNames[tab];
  return `-# ${section.emoji} DEALIO · ${language === 'tr' ? section.tr : section.en}\n# ${title}${subtitle ? `\n${subtitle}` : ''}`;
}

/** "🇹🇷 Türkiye": the one way a Store country is shown. */
export function countryDisplay(countryCode: StoreCountryCode, language: Language): string {
  return `${flagEmoji(countryCode)} ${storeCountryName(countryCode, language)}`;
}

/** The country's flag from its two-letter code (regional indicator symbols). */
export function flagEmoji(countryCode: string): string {
  return /^[A-Z]{2}$/.test(countryCode)
    ? String.fromCodePoint(...[...countryCode].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
    : '🌍';
}

/** From this discount on a deal is "hot": 🔥 and the green dot are reserved for it. */
export const hotDealPercent = 60;

/** How strong a discount is at a glance: 🟢 hot (60%+), 🟡 good (30%+), 🟠 small. */
export function discountTier(percent: number): string {
  return percent >= hotDealPercent ? '🟢' : percent >= 30 ? '🟡' : '🟠';
}

/** "🎁 " for a free-to-keep game, "🔥 " for a hot deal, nothing otherwise, so each keeps its meaning. */
export function hotPrefix(percent: number | null | undefined): string {
  return (percent ?? 0) >= 100 ? '🎁 ' : (percent ?? 0) >= hotDealPercent ? '🔥 ' : '';
}

/** "🟢 `−%90`": the tier dot and an inline-code pill, which Discord draws as a small badge. */
export function discountBadge(percent: number, language: Language): string {
  return `${discountTier(percent)} ${language === 'tr' ? `\`−%${percent}\`` : `\`−${percent}%\``}`;
}

/** "**$1,99**  ~~$19,99~~  🟢 `−%90`", or the price alone when there is no discount. */
export function priceLine(
  price: { readonly finalMinor: number; readonly initialMinor: number; readonly discountPercent: number; readonly currency: string },
  language: Language,
): string {
  const freeToKeep = price.finalMinor === 0 && price.initialMinor > 0;
  const final = `**${freeToKeep ? (language === 'tr' ? 'Ücretsiz' : 'Free') : formatMinorPrice(price.finalMinor, price.currency, language)}**`;
  return price.discountPercent > 0 && price.initialMinor > price.finalMinor
    ? `${final}  ~~${formatMinorPrice(price.initialMinor, price.currency, language)}~~  ${discountBadge(price.discountPercent, language)}`
    : final;
}

/** "💰 $18,00 tasarruf" for a discounted price, else null. */
export function savingsLine(
  price: { readonly finalMinor: number; readonly initialMinor: number; readonly currency: string },
  language: Language,
): string | null {
  const saved = price.initialMinor - price.finalMinor;
  if (saved <= 0) return null;
  const amount = formatMinorPrice(saved, price.currency, language);
  return language === 'tr' ? `💰 ${amount} tasarruf` : `💰 You save ${amount}`;
}

/** "🏠 Dealio panel": opens a fresh /dealio panel from any message, DMs included. */

export function openPanelButton(language: Language, style: ButtonStyle = ButtonStyle.Primary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(openPanelCustomId).setStyle(style).setEmoji('🏠')
    .setLabel(language === 'tr' ? 'Dealio paneli' : 'Dealio panel');
}

const steamDeckLabels = {
  verified: { tr: 'Doğrulandı', en: 'Verified' },
  playable: { tr: 'Oynanabilir', en: 'Playable' },
  unsupported: { tr: 'Desteklenmiyor', en: 'Unsupported' },
} as const;

/** "⭐ Son Derece Olumlu · %98　🎮 Steam Deck: Doğrulandı", or null when Steam gave neither. */
export function reviewLine(facts: StoreFacts | undefined, language: Language): string | null {
  const parts: string[] = [];
  if (facts?.reviewLabel || facts?.reviewPercent !== undefined) {
    const percent = facts.reviewPercent === undefined ? null
      : language === 'tr' ? `%${facts.reviewPercent}` : `${facts.reviewPercent}%`;
    parts.push(`⭐ ${[facts.reviewLabel ? `**${facts.reviewLabel}**` : null, percent].filter(Boolean).join(' · ')}`);
  }
  if (facts?.steamDeck) parts.push(`🎮 Steam Deck: ${steamDeckLabels[facts.steamDeck][language]}`);
  return parts.length > 0 ? parts.join('　') : null;
}

/** "💻 Windows · macOS · Linux", or null. */
export function platformText(facts: StoreFacts | undefined): string | null {
  const platforms = facts?.platforms;
  if (!platforms) return null;
  const names = [platforms.windows && 'Windows', platforms.mac && 'macOS', platforms.linux && 'Linux'].filter(Boolean);
  return names.length > 0 ? `💻 ${names.join(' · ')}` : null;
}

/** "⏳ İndirim 3 gün içinde bitiyor" (a Discord relative time), only for a future end. */
export function saleEndLine(facts: StoreFacts | undefined, language: Language, now = Date.now()): string | null {
  const end = facts?.saleEndsAt ? Date.parse(facts.saleEndsAt) : Number.NaN;
  if (!Number.isFinite(end) || end <= now) return null;
  const at = `<t:${Math.floor(end / 1000)}:R>`;
  return language === 'tr' ? `⏳ İndirim ${at} bitiyor` : `⏳ Sale ends ${at}`;
}

/** "🎁 Sınırlı süre: şimdi alırsan oyun sonsuza kadar senin." for a 100% discount, else null. */
export function freeToKeepLine(price: { readonly finalMinor: number; readonly initialMinor: number }, language: Language): string | null {
  if (price.finalMinor !== 0 || price.initialMinor <= 0) return null;
  return language === 'tr'
    ? '🎁 **Sınırlı süre ücretsiz:** şimdi kütüphanene eklersen oyun sonsuza kadar senin.'
    : '🎁 **Free for a limited time:** add it to your library now and it is yours to keep.';
}

/**
 * Opens the game in the Steam app. Discord links accept only http(s), so a tiny
 * page on Dealio's public site forwards to steam://store/<appId>.
 */
export function steamAppUrl(appId: number): string {
  return `https://blghnboz17-boop.github.io/dealio-public-pages/open.html?app=${appId}`;
}

/** "[🖥️ Steam uygulamasında aç](…)" for inline use in alert text. */
export function steamAppLink(appId: number, language: Language): string {
  return `[🖥️ ${language === 'tr' ? 'Steam uygulamasında aç' : 'Open in the Steam app'}](${steamAppUrl(appId)})`;
}

/** "12 Ekim 2026", "Ekim 2026", "2027 Ç4", "2027", or Steam's own text, as precise as Steam states it. */
export function releaseDateText(upcoming: UpcomingRelease, language: Language): string {
  const locale = language === 'tr' ? 'tr-TR' : 'en-US';
  const date = upcoming.date ? new Date(upcoming.date) : null;
  if (date && !Number.isNaN(date.getTime())) {
    const year = date.getUTCFullYear();
    if (upcoming.precision === 'day') return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
    if (upcoming.precision === 'month') return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
    if (upcoming.precision === 'quarter') {
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
      return language === 'tr' ? `${year} ${quarter}. çeyrek` : `Q${quarter} ${year}`;
    }
    if (upcoming.precision === 'year') return String(year);
  }
  return upcoming.message ?? (language === 'tr' ? 'tarih açıklanmadı' : 'date not announced');
}

/** "🗓️ Yakında · 12 Ekim 2026": an unreleased game has no price yet, and that is not an error. */
export function upcomingLine(upcoming: UpcomingRelease, language: Language): string {
  return `🗓️ ${language === 'tr' ? 'Yakında' : 'Coming soon'} · ${releaseDateText(upcoming, language)}`;
}

/** What to show instead of a price: the release for an unreleased game, else an honest "unavailable". */
export function noPriceText(item: Pick<WishlistItem, 'upcoming'>, language: Language): string {
  return item.upcoming ? upcomingLine(item.upcoming, language)
    : language === 'tr' ? '❔ Fiyat şu an doğrulanamadı' : '❔ Price could not be confirmed right now';
}

/** "🚫 1 oyun Türkiye mağazasında satılmıyor · 🗑️ 1 oyun Steam'den kaldırılmış", or null. */
export function unavailableGamesLine(
  errors: readonly Pick<WishlistItemError, 'code'>[] | undefined,
  countryCode: StoreCountryCode,
  language: Language,
): string | null {
  const regionLocked = errors?.filter((error) => error.code === 'STEAM_APP_REGION_UNAVAILABLE').length ?? 0;
  const delisted = errors?.filter((error) => error.code === 'STEAM_APP_NOT_FOUND').length ?? 0;
  const country = storeCountryName(countryCode, language);
  const parts = [
    regionLocked > 0 ? (language === 'tr' ? `🚫 ${regionLocked} oyun ${country} mağazasında satılmıyor`
      : `🚫 ${regionLocked} ${regionLocked === 1 ? 'game is' : 'games are'} not sold in ${country}`) : null,
    delisted > 0 ? (language === 'tr' ? `🗑️ ${delisted} oyun Steam'den kaldırılmış`
      : `🗑️ ${delisted} ${delisted === 1 ? 'game was' : 'games were'} removed from Steam`) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

import type { Language } from '../../domain/user-config.js';
import { formatMinorPrice } from '../notification-messages.js';
import { dealioBrand } from './brand.js';
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

/** The country's flag from its two-letter code (regional indicator symbols). */
export function flagEmoji(countryCode: string): string {
  return /^[A-Z]{2}$/.test(countryCode)
    ? String.fromCodePoint(...[...countryCode].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
    : '🌍';
}

/** An inline-code pill such as `−%90`, which Discord draws as a small badge. */
export function discountBadge(percent: number, language: Language): string {
  return language === 'tr' ? `\`−%${percent}\`` : `\`−${percent}%\``;
}

/** "**USD 1,99**  ~~USD 19,99~~  `−%90`", or the price alone when there is no discount. */
export function priceLine(
  price: { readonly finalMinor: number; readonly initialMinor: number; readonly discountPercent: number; readonly currency: string },
  language: Language,
): string {
  const final = `**${formatMinorPrice(price.finalMinor, price.currency, language)}**`;
  return price.discountPercent > 0 && price.initialMinor > price.finalMinor
    ? `${final}  ~~${formatMinorPrice(price.initialMinor, price.currency, language)}~~  ${discountBadge(price.discountPercent, language)}`
    : final;
}

/** "💰 USD 18,00 tasarruf" for a discounted price, else null. */
export function savingsLine(
  price: { readonly finalMinor: number; readonly initialMinor: number; readonly currency: string },
  language: Language,
): string | null {
  const saved = price.initialMinor - price.finalMinor;
  if (saved <= 0) return null;
  const amount = formatMinorPrice(saved, price.currency, language);
  return language === 'tr' ? `💰 ${amount} tasarruf` : `💰 You save ${amount}`;
}

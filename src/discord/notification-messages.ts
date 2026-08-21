import type { Language } from '../domain/user-config.js';
import type { NotificationCandidate } from '../domain/wishlist-state.js';

const maxGameNameLength = 256;

export function sanitizeGameName(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = normalized.length > maxGameNameLength
    ? `${normalized.slice(0, maxGameNameLength - 3)}...`
    : normalized;

  return truncated.replace(/([\\`*_{}\[\]()|>~<>])/g, '\\$1');
}

export function formatMinorPrice(
  minorValue: number,
  currency: string,
  language: Language,
): string {
  return new Intl.NumberFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorValue / 100);
}

export function buildSaleNotificationMessage(
  candidate: NotificationCandidate,
  language: Language,
): string {
  const normalPrice = formatMinorPrice(candidate.normalPriceMinor, candidate.currency, language);
  const finalPrice = formatMinorPrice(candidate.finalPriceMinor, candidate.currency, language);
  const storeUrl = `https://store.steampowered.com/app/${candidate.appId}/`;
  const gameName = sanitizeGameName(candidate.gameName);

  if (language === 'tr') {
    return [
      'Steam wishlist indirimi',
      `Oyun: ${gameName}`,
      `İndirim: %${candidate.discountPercent}`,
      `Normal fiyat: ${normalPrice}`,
      `İndirimli fiyat: ${finalPrice}`,
      `Steam mağazası: ${storeUrl}`,
    ].join('\n');
  }

  return [
    'Steam wishlist sale',
    `Game: ${gameName}`,
    `Discount: ${candidate.discountPercent}%`,
    `Normal price: ${normalPrice}`,
    `Sale price: ${finalPrice}`,
    `Steam store: ${storeUrl}`,
  ].join('\n');
}

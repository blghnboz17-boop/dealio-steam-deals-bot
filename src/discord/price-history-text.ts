import { historicalLowStanding, type HistoricalLow, type PriceChange } from '../domain/price-history.js';
import type { Language } from '../domain/user-config.js';
import { formatMinorPrice } from './notification-messages.js';

/** IsThereAnyDeal asks API users to credit the service. */
export function priceHistoryCredit(language: Language): string {
  return `-# ${language === 'tr' ? 'Fiyat geçmişi' : 'Price history'}: [IsThereAnyDeal](https://isthereanydeal.com/)`;
}

export function monthYear(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}

/** How a confirmed Steam price compares with its recorded low; null when not comparable. */
export function historicalLowLine(
  finalPriceMinor: number,
  currency: string,
  low: HistoricalLow,
  language: Language,
): string | null {
  const standing = historicalLowStanding(finalPriceMinor, currency, low);
  if (!standing) {
    return null;
  }
  // A low limited to the current currency's period must not be called "all-time".
  // "sonrası" avoids a Turkish suffix that would depend on how the year is read.
  const since = low.since ? monthYear(low.since, language) : null;
  if (standing === 'new-low') {
    return language === 'tr'
      ? since ? `🏆 **${since} sonrasının en düşük fiyatı!**` : '🏆 **Tüm zamanların en düşük fiyatı!**'
      : since ? `🏆 **Lowest price since ${since}!**` : '🏆 **Lowest price ever!**';
  }
  if (standing === 'matches-low') {
    return language === 'tr'
      ? since ? `🏆 **${since} sonrasının en düşük fiyatına eşit**` : '🏆 **Tarihî en düşük fiyata eşit**'
      : since ? `🏆 **Matches the lowest price since ${since}**` : '🏆 **Matches the all-time low**';
  }
  const price = formatMinorPrice(low.amountMinor, low.currency, language);
  const details = [
    ...(low.discountPercent > 0 ? [discountText(low, language)] : []),
    monthYear(low.recordedAt, language),
  ].join(' · ');
  return language === 'tr'
    ? `📉 ${since ? `${since} sonrası en düşük` : 'Tarihî en düşük'}: **${price}** (${details})`
    : `📉 ${since ? `Lowest since ${since}` : 'All-time low'}: **${price}** (${details})`;
}

/** One recorded Steam price change for a game's detail panel. */
export function priceChangeLine(change: PriceChange, language: Language): string {
  const price = formatMinorPrice(change.amountMinor, change.currency, language);
  const discount = change.discountPercent > 0 ? ` · ${discountText(change, language)}` : '';
  return `<t:${Math.floor(Date.parse(change.recordedAt) / 1000)}:d> · **${price}**${discount}`;
}

function discountText(change: PriceChange, language: Language): string {
  return language === 'tr' ? `%${change.discountPercent}` : `${change.discountPercent}% off`;
}

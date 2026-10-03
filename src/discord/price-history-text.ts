import { historicalLowStanding, type HistoricalLow, type PriceChange } from '../domain/price-history.js';
import { languageLocale, type Language } from '../domain/user-config.js';
import { localizer, percentOff } from './i18n.js';
import { formatMinorPrice } from './notification-messages.js';

/** IsThereAnyDeal asks API users to credit the service. */
export function priceHistoryCredit(language: Language): string {
  const label = localizer(language)({ tr: 'Fiyat geçmişi', en: 'Price history', de: 'Preisverlauf', fr: 'Historique des prix' });
  return `-# ${label}: [IsThereAnyDeal](https://isthereanydeal.com/)`;
}

export function monthYear(value: string, language: Language): string {
  return new Intl.DateTimeFormat(languageLocale[language], {
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
  const t = localizer(language);
  if (standing === 'new-low') {
    return since
      ? t({
          tr: `🏆 **${since} sonrasının en düşük fiyatı!**`,
          en: `🏆 **Lowest price since ${since}!**`,
          de: `🏆 **Tiefstpreis seit ${since}!**`,
          fr: `🏆 **Prix le plus bas depuis ${since} !**`,
        })
      : t({
          tr: '🏆 **Tüm zamanların en düşük fiyatı!**',
          en: '🏆 **Lowest price ever!**',
          de: '🏆 **So günstig war es noch nie!**',
          fr: '🏆 **Prix le plus bas jamais vu !**',
        });
  }
  if (standing === 'matches-low') {
    return since
      ? t({
          tr: `🏆 **${since} sonrasının en düşük fiyatıyla aynı**`,
          en: `🏆 **Matches the lowest price since ${since}**`,
          de: `🏆 **Genauso günstig wie der Tiefstpreis seit ${since}**`,
          fr: `🏆 **Égale le prix le plus bas depuis ${since}**`,
        })
      : t({
          tr: '🏆 **Gelmiş geçmiş en düşük fiyatla aynı**',
          en: '🏆 **Matches the all-time low**',
          de: '🏆 **Genauso günstig wie der Allzeit-Tiefstpreis**',
          fr: '🏆 **Égale le prix le plus bas jamais vu**',
        });
  }
  const price = formatMinorPrice(low.amountMinor, low.currency, language);
  const details = [
    ...(low.discountPercent > 0 ? [discountText(low, language)] : []),
    monthYear(low.recordedAt, language),
  ].join(' · ');
  const label = since
    ? t({ tr: `${since} sonrası en düşük`, en: `Lowest since ${since}`, de: `Tiefstpreis seit ${since}`, fr: `Le plus bas depuis ${since}` })
    : t({ tr: 'Gelmiş geçmiş en düşük', en: 'All-time low', de: 'Allzeit-Tiefstpreis', fr: 'Le plus bas jamais vu' });
  return `📉 ${label}: **${price}** (${details})`;
}

/** One recorded Steam price change for a game's detail panel. */
export function priceChangeLine(change: PriceChange, language: Language): string {
  const price = formatMinorPrice(change.amountMinor, change.currency, language);
  const discount = change.discountPercent > 0 ? ` · ${discountText(change, language)}` : '';
  return `<t:${Math.floor(Date.parse(change.recordedAt) / 1000)}:d> · **${price}**${discount}`;
}

function discountText(change: PriceChange, language: Language): string {
  return percentOff(change.discountPercent, language);
}

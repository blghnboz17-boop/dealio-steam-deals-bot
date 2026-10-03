import { languageLocale, type Language } from '../domain/user-config.js';

const maxGameNameLength = 256;

export function sanitizeGameName(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const escaped = normalized.replace(/([\\`*_{}\[\]()|>~<>])/g, '\\$1');

  if (escaped.length <= maxGameNameLength) {
    return escaped;
  }

  return `${escaped.slice(0, maxGameNameLength - 3).replace(/\\$/, '')}...`;
}

/** Narrow symbols that several currencies share; those use the distinct "CA$"/"CN¥" form. */
const sharedNarrowSymbols = new Map([['$', 'USD'], ['¥', 'JPY'], ['£', 'GBP'], ['kr', ''], ['Fr', '']]);

/**
 * "$3,99", "€3,99", "₺3,99", "₽3,99": the familiar symbol, unless it is shared
 * with another currency (CA$, AU$, CN¥…). Never converts between currencies.
 */
export function formatMinorPrice(
  minorValue: number,
  currency: string,
  language: Language,
): string {
  const format = (currencyDisplay: 'narrowSymbol' | 'symbol') => new Intl.NumberFormat(languageLocale[language], {
    style: 'currency',
    currency,
    currencyDisplay,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const narrow = format('narrowSymbol');
  const symbol = narrow.formatToParts(0).find((part) => part.type === 'currency')?.value ?? '';
  const owner = sharedNarrowSymbols.get(symbol);
  return (owner === undefined || owner === currency ? narrow : format('symbol')).format(minorValue / 100);
}

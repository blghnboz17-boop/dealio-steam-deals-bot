import { isLanguage, type Language } from '../domain/user-config.js';
import { parseStoreCountryCode, type StoreCountryCode } from '../domain/store-country.js';

/** Discord's own language ("de", "fr", "tr", "en-US"…); anything Dealio does not speak falls back to English. */
export function languageFromDiscordLocale(locale: string): Language {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? '';
  return isLanguage(language) ? language : 'en';
}

export function suggestedStoreCountryFromDiscordLocale(
  locale: string,
): StoreCountryCode | undefined {
  const normalized = locale.trim().replace('_', '-');
  const localeOverrides: Readonly<Record<string, StoreCountryCode>> = {
    'es-419': 'MX',
  };
  const override = localeOverrides[normalized.toLowerCase()];
  if (override) {
    return override;
  }
  const explicitRegion = normalized.split('-')[1];
  const parsedRegion = explicitRegion ? parseStoreCountryCode(explicitRegion) : null;
  if (parsedRegion) {
    return parsedRegion;
  }

  const language = normalized.split('-')[0]?.toLowerCase();
  const languageDefaults: Readonly<Record<string, StoreCountryCode>> = {
    id: 'ID',
    da: 'DK',
    tr: 'TR',
    de: 'DE',
    fr: 'FR',
    hr: 'HR',
    it: 'IT',
    lt: 'LT',
    hu: 'HU',
    ja: 'JP',
    ko: 'KR',
    nl: 'NL',
    no: 'NO',
    pl: 'PL',
    ro: 'RO',
    fi: 'FI',
    vi: 'VN',
    cs: 'CZ',
    el: 'GR',
    bg: 'BG',
    ru: 'RU',
    uk: 'UA',
    hi: 'IN',
    th: 'TH',
    es: 'ES',
    pt: 'BR',
    sv: 'SE',
    zh: 'CN',
  };
  return language ? languageDefaults[language] : undefined;
}

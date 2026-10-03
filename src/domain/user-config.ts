import type { StoreCountryCode } from './store-country.js';

/** Every language Dealio speaks, in the order a picker lists them. */
export const languages = ['tr', 'en', 'de', 'fr'] as const;
export type Language = typeof languages[number];

/** The BCP 47 locale behind a language: dates, numbers, prices and country names. */
export const languageLocale: Readonly<Record<Language, string>> = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
};

export interface UserConfig {
  readonly discordUserId: string;
  readonly configurationId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly language: Language;
  readonly storeCountryCode: StoreCountryCode;
  readonly enabled: boolean;
  readonly minimumDiscountPercent: number;
  readonly dmOptInAt: string;
  readonly dmDeliveryBlockedAt: string | null;
  readonly dmDeliveryErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isMinimumDiscountPercent(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

export function isSteamId64(value: string): boolean {
  return /^\d{17}$/.test(value);
}

export function isLanguage(value: string): value is Language {
  return (languages as readonly string[]).includes(value);
}

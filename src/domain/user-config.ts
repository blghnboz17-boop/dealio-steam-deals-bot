import type { StoreCountryCode } from './store-country.js';

export type Language = 'tr' | 'en';

export interface UserConfig {
  readonly discordUserId: string;
  readonly configurationId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly language: Language;
  readonly storeCountryCode: StoreCountryCode;
  readonly enabled: boolean;
  readonly minimumDiscountPercent: number;
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
  return value === 'tr' || value === 'en';
}

export type Language = 'tr' | 'en';

export interface UserConfig {
  readonly discordUserId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly language: Language;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isSteamId64(value: string): boolean {
  return /^\d{17}$/.test(value);
}

export function isLanguage(value: string): value is Language {
  return value === 'tr' || value === 'en';
}

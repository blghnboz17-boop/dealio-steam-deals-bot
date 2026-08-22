import type { Language } from '../domain/user-config.js';

export function languageFromDiscordLocale(locale: string): Language {
  return locale.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

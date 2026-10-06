import { languageLocale, type Language } from '../domain/user-config.js';

/** One text in every language; the compiler rejects a missing translation. */
export type Localized<T = string> = Readonly<Record<Language, T>>;

/** A language's name in that language, as a picker shows it. */
export const languageNames: Localized = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
};

/** The flag a language picker shows beside each language. */
export const languageFlags: Localized = {
  tr: '🇹🇷',
  en: '🇬🇧',
  de: '🇩🇪',
  fr: '🇫🇷',
};

/** "🇹🇷 Türkçe": a language as every picker lists it. */
export function languageChoice(language: Language): string {
  return `${languageFlags[language]} ${languageNames[language]}`;
}

const percentFormats = new Map<Language, Intl.NumberFormat>();

/** "%30", "30%", "30 %": the percent sign where each language puts it. */
export function percentText(value: number, language: Language): string {
  let format = percentFormats.get(language);
  if (!format) {
    format = new Intl.NumberFormat(languageLocale[language], { style: 'percent', maximumFractionDigits: 0 });
    percentFormats.set(language, format);
  }
  return format.format(value / 100);
}

/** Picks one language's text: `t(language)({ tr: '…', en: '…', de: '…', fr: '…' })`. */
export function localizer(language: Language): <T>(values: Localized<T>) => T {
  return (values) => values[language];
}

/** "%30 indirim", "30% off", "30 % Rabatt", "30 % de réduction". */
export function percentOff(value: number, language: Language): string {
  const percent = percentText(value, language);
  return localizer(language)({ tr: `${percent} indirim`, en: `${percent} off`, de: `${percent} Rabatt`, fr: `${percent} de réduction` });
}

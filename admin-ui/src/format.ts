const locale = 'tr-TR';
const numberFormat = new Intl.NumberFormat(locale);
const compactFormat = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
const regionNames = new Intl.DisplayNames([locale], { type: 'region' });

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : numberFormat.format(value);
}

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Math.abs(value) < 10_000 ? numberFormat.format(value) : compactFormat.format(value);
}

export function dateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
}

export function day(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function relative(value: string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  const delta = time - now;
  for (const [unit, size] of units) {
    if (Math.abs(delta) >= size) return relativeFormat.format(Math.round(delta / size), unit);
  }
  return relativeFormat.format(Math.round(delta / 1000), 'second');
}

export function bytes(value: number): string {
  const steps = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < steps.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toLocaleString(locale, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${steps[index]}`;
}

export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} dk` : `${minutes} dk ${seconds % 60} sn`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours} sa` : `${hours} sa ${minutes % 60} dk`;
  return `${Math.floor(hours / 24)} gün ${hours % 24} sa`;
}

/** Steam prices are minor units ×100 in every currency; never converted. */
export function money(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  if (!currency) return (minor / 100).toLocaleString(locale, { minimumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function flag(countryCode: string): string {
  if (!/^[A-Z]{2}$/.test(countryCode)) return '';
  return String.fromCodePoint(...[...countryCode].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function country(countryCode: string): string {
  try {
    return regionNames.of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

export const languageNames: Readonly<Record<string, string>> = {
  tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca',
};

export const notificationModeNames: Readonly<Record<string, string>> = {
  instant: 'Anında', quiet: 'Sessiz saatler', digest: 'Günlük özet',
};

export const checkStatusNames: Readonly<Record<string, string>> = {
  success: 'Başarılı', unavailable: 'Erişilemedi', failed: 'Hatalı', pending: 'Sürüyor', never: 'Hiç kontrol edilmedi',
};

export const notificationStatusNames: Readonly<Record<string, string>> = {
  candidate: 'Bekliyor', sending: 'Gönderiliyor', sent: 'Gönderildi', failed: 'Tekrar denenecek',
  terminal_failed: 'Başarısız', expired: 'Süresi doldu',
};

export function minuteOfDay(value: number | null): string {
  if (value === null) return '—';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function displayName(profile: { readonly globalName: string | null; readonly username: string } | null | undefined,
  fallback: string): string {
  return profile ? profile.globalName ?? profile.username : fallback;
}

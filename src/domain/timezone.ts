import type { StoreCountryCode } from './store-country.js';

/**
 * Countries whose population lives in one IANA time zone, so the Store region
 * can choose it for the user. Countries with several zones are offered a list.
 */
const singleZoneCountries: Partial<Record<StoreCountryCode, string>> = {
  TR: 'Europe/Istanbul', GB: 'Europe/London', IE: 'Europe/Dublin', DE: 'Europe/Berlin',
  FR: 'Europe/Paris', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', ES: 'Europe/Madrid',
  IT: 'Europe/Rome', PT: 'Europe/Lisbon', AT: 'Europe/Vienna', CH: 'Europe/Zurich',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest',
  RO: 'Europe/Bucharest', BG: 'Europe/Sofia', GR: 'Europe/Athens', CY: 'Asia/Nicosia',
  UA: 'Europe/Kyiv', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki', RS: 'Europe/Belgrade', HR: 'Europe/Zagreb', AZ: 'Asia/Baku',
  GE: 'Asia/Tbilisi', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', IL: 'Asia/Jerusalem',
  EG: 'Africa/Cairo', ZA: 'Africa/Johannesburg', IN: 'Asia/Kolkata', PK: 'Asia/Karachi',
  TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila', MY: 'Asia/Kuala_Lumpur',
  SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', TW: 'Asia/Taipei', CN: 'Asia/Shanghai',
  KR: 'Asia/Seoul', JP: 'Asia/Tokyo', NZ: 'Pacific/Auckland', AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
};

const multiZoneCountries: Partial<Record<StoreCountryCode, readonly string[]>> = {
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
    'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
  CA: ['America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg',
    'America/Edmonton', 'America/Vancouver'],
  AU: ['Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth'],
  BR: ['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco'],
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Chihuahua', 'America/Tijuana'],
  RU: ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg',
    'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Vladivostok'],
  ID: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
  KZ: ['Asia/Almaty', 'Asia/Aqtobe'],
};

/** A spread of common zones for any other country, west to east. */
const commonZones: readonly string[] = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Africa/Lagos', 'Africa/Johannesburg',
  'Europe/Istanbul', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

/** Discord select menus hold at most 25 options. */
const maxChoices = 25;

/** The zone for a single-zone Store country; null when the user must choose. */
export function defaultTimezone(country: StoreCountryCode): string | null {
  return singleZoneCountries[country] ?? null;
}

/** Zones to offer, the current and the country's own first, without duplicates. */
export function timezoneChoices(country: StoreCountryCode, current?: string | null): string[] {
  const own = multiZoneCountries[country] ?? [singleZoneCountries[country]].filter((zone): zone is string => Boolean(zone));
  return [...new Set([...(current ? [current] : []), ...own, ...commonZones])].slice(0, maxChoices);
}

/** "New York (UTC−4)": the city and its offset at `now`, so DST is shown as it is today. */
export function timezoneLabel(zone: string, now = new Date()): string {
  const city = zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ');
  let offset = '';
  try {
    offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return city;
  }
  const utc = offset === 'GMT' ? 'UTC+0' : offset.replace('GMT', 'UTC').replace('-', '−');
  return utc ? `${city} (${utc})` : city;
}

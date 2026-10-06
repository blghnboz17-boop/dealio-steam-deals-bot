/**
 * Steam starts and ends discounts at 10:00 Pacific time, so that is when most
 * wishlist prices change. Daylight saving time moves the instant in UTC.
 */
const steamPriceZone = 'America/Los_Angeles';
const steamPriceChangeHour = 10;

const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: steamPriceZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

function zoneDate(at: number): { year: number; month: number; day: number; offsetMinutes: number } {
  const parts = Object.fromEntries(zoneParts.formatToParts(at).map((part) => [part.type, part.value]));
  const offset = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(parts.timeZoneName ?? '');
  const sign = offset?.[1] === '-' ? -1 : 1;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    offsetMinutes: offset?.[1] ? sign * (Number(offset[2]) * 60 + Number(offset[3])) : 0,
  };
}

/** The UTC instant of 10:00 Pacific on a Pacific calendar day (day may overflow the month). */
function priceChangeOn(year: number, month: number, day: number): number {
  const wallClock = Date.UTC(year, month - 1, day, steamPriceChangeHour);
  // A first guess lands within hours of the answer; its offset is the one in force
  // at 10:00, since daylight saving switches happen at 02:00.
  const guess = wallClock - zoneDate(wallClock).offsetMinutes * 60_000;
  return wallClock - zoneDate(guess).offsetMinutes * 60_000;
}

/** The first Steam price change strictly after `now`. */
export function nextSteamPriceChange(now: Date): Date {
  const nowMs = now.getTime();
  const today = zoneDate(nowMs);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const candidate = priceChangeOn(today.year, today.month, today.day + dayOffset);
    if (candidate > nowMs) {
      return new Date(candidate);
    }
  }
  throw new Error('Could not find the next Steam price change');
}

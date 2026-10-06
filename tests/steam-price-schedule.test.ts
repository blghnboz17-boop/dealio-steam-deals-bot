import { describe, expect, it } from 'vitest';
import { nextSteamPriceChange } from '../src/domain/steam-price-schedule.js';

describe('nextSteamPriceChange', () => {
  it.each([
    // Pacific daylight time: 10:00 PDT is 17:00 UTC.
    ['2026-10-07T09:00:00.000Z', '2026-10-07T17:00:00.000Z'],
    ['2026-10-07T16:59:59.999Z', '2026-10-07T17:00:00.000Z'],
    // Exactly at the change, the next one is a day later.
    ['2026-10-07T17:00:00.000Z', '2026-10-08T17:00:00.000Z'],
    // Before midnight Pacific (still 7 October there), already 8 October in UTC.
    ['2026-10-08T05:00:00.000Z', '2026-10-08T17:00:00.000Z'],
    // Pacific standard time: 10:00 PST is 18:00 UTC.
    ['2026-12-15T17:30:00.000Z', '2026-12-15T18:00:00.000Z'],
    ['2026-12-31T19:00:00.000Z', '2027-01-01T18:00:00.000Z'],
    // Daylight saving starts 8 March 2026 and ends 1 November 2026 at 02:00 local.
    ['2026-03-07T19:00:00.000Z', '2026-03-08T17:00:00.000Z'],
    ['2026-10-31T18:00:00.000Z', '2026-11-01T18:00:00.000Z'],
  ])('after %s is %s', (now, expected) => {
    expect(nextSteamPriceChange(new Date(now)).toISOString()).toBe(expected);
  });
});

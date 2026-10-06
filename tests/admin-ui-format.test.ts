import { beforeAll, describe, expect, it } from 'vitest';

// The owner reads the panel in Turkey; calendar days follow the viewer's timezone.
process.env.TZ = 'Europe/Istanbul';
let relative: (value: string | number | null | undefined, now?: number) => string;
beforeAll(async () => {
  ({ relative } = await import('../admin-ui/src/format.js'));
});

const now = Date.parse('2026-10-06T19:30:00.000Z'); // 22:30 in Istanbul

describe('admin panel relative times', () => {
  it('never rounds a span up', () => {
    // The bot joined on 21 August: 46 days, one and a half months, is "1 ay önce".
    expect(relative('2026-08-21T11:47:18.679Z', now)).toBe('1 ay önce');
    expect(relative('2026-09-26T19:30:00.000Z', now)).toBe('1 hafta önce'); // 10 days
    expect(relative('2026-09-22T19:30:00.000Z', now)).toBe('2 hafta önce'); // 14 days
    expect(relative('2026-10-06T17:40:00.000Z', now)).toBe('1 saat önce'); // 110 minutes
  });

  it('counts calendar days from a day on', () => {
    expect(relative('2026-10-01T17:10:19.899Z', now)).toBe('5 gün önce');
    expect(relative('2026-10-05T12:00:00.000Z', now)).toBe('dün');
    // 30 hours ago is still yesterday in Istanbul (5 October, 16:30).
    expect(relative('2026-10-05T13:30:00.000Z', now)).toBe('dün');
    // At 01:00 on 7 October, 22:00 on 5 October is 27 hours back but two calendar days.
    expect(relative('2026-10-05T19:00:00.000Z', Date.parse('2026-10-06T22:00:00.000Z'))).toBe('2 gün önce');
    expect(relative('2026-10-04T12:30:00.000Z', now)).toBe('2 gün önce');
  });

  it('handles the future, the present and missing values', () => {
    expect(relative('2026-10-06T19:40:00.000Z', now)).toBe('10 dakika sonra');
    expect(relative(now - 4_000, now)).toBe('şimdi');
    expect(relative(null, now)).toBe('—');
    expect(relative('not a date', now)).toBe('—');
    expect(relative('2025-09-01T00:00:00.000Z', now)).toBe('1 yıl önce');
  });
});

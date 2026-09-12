
export interface NotificationPreference {
  mode: 'instant' | 'quiet' | 'digest';
  timezone: string | null;
  quietStart: number | null;
  quietEnd: number | null;
  digestMinute: number | null;
  lastDigestDate?: string | null;
}

export function validatePreference(p: NotificationPreference): void {
  if (!['instant','quiet','digest'].includes(p.mode)) throw new Error('Invalid delivery mode');
  if (p.mode === 'instant') return;
  if (!p.timezone) throw new Error('Choose a timezone first');
  try { new Intl.DateTimeFormat('en', { timeZone: p.timezone }).format(); }
  catch { throw new Error('Invalid IANA timezone'); }
  const minute = (v: number | null): boolean => v !== null && Number.isInteger(v) && v >= 0 && v < 1440;
  if (p.mode === 'quiet' && (!minute(p.quietStart) || !minute(p.quietEnd) || p.quietStart === p.quietEnd))
    throw new Error('Invalid quiet hours');
  if (p.mode === 'digest' && !minute(p.digestMinute)) throw new Error('Invalid digest time');
}

export function localClock(now: Date, timezone: string): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (name: string): string => parts.find(p => p.type === name)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')) };
}

/** Wall-clock evaluation handles DST gaps by sending after the chosen time, folds once per date. */
export function deliveryAllowed(p: NotificationPreference, now: Date): boolean {
  validatePreference(p);
  if (p.mode === 'instant') return true;
  const local = localClock(now, p.timezone!);
  if (p.mode === 'digest') return local.minute >= p.digestMinute! && local.date !== p.lastDigestDate;
  const start = p.quietStart!, end = p.quietEnd!;
  const quiet = start < end ? local.minute >= start && local.minute < end
    : local.minute >= start || local.minute < end;
  return !quiet;
}

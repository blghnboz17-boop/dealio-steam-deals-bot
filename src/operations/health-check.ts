export function healthProblems(heartbeat: unknown, scanAt: string | null, queueAt: string | null, now: number): string[] {
  const record = heartbeat && typeof heartbeat === 'object' ? heartbeat as Record<string, unknown> : {};
  const stale = (value: unknown, seconds: number): boolean => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    return !Number.isFinite(time) || time > now + 60_000 || now - time > seconds * 1000;
  };
  const problems: string[] = [];
  if (stale(record.heartbeatAt, 180)) problems.push('heartbeat');
  if (record.phase !== 'ready' || record.discordReady !== true) problems.push('discord');
  if (scanAt !== null && stale(scanAt, 7200)) problems.push('scan');
  if (queueAt !== null && stale(queueAt, 93600)) problems.push('queue');
  return problems;
}

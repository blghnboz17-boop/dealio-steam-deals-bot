// Oldest scan the health signal waits on. A wishlist its owner made private (or a
// deleted Steam account) fails every check until the user acts, which is not a
// stalled scanner: for those users the last completed attempt counts, so the
// signal still notices when the scheduler stops visiting them.
export const OLDEST_SCAN_SQL = `SELECT MIN(COALESCE(
    CASE WHEN state.last_error_code = 'STEAM_WISHLIST_INACCESSIBLE' THEN state.last_completed_at
         ELSE state.last_success_completed_at END,
    config.created_at)) at
  FROM user_config config
  LEFT JOIN check_state state ON state.discord_user_id = config.discord_user_id
  WHERE config.enabled = 1`;

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

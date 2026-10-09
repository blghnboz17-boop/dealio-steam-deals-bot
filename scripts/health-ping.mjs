import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { healthProblems, OLDEST_SCAN_SQL } from '../dist/operations/health-check.js';

let problems;
let db;
try {
  let heartbeat = null;
  try { heartbeat = JSON.parse(await readFile('.runtime/bot.health.json', 'utf8')); } catch { /* assessed below */ }
  db = new DatabaseSync(process.env.DATABASE_PATH ?? './data/wishlist.db', { readOnly: true, timeout: 2000 });
  const scan = db.prepare(OLDEST_SCAN_SQL).get();
  const queue = db.prepare(`SELECT MIN(n.created_at) at FROM notification_log n JOIN user_config u ON u.discord_user_id=n.discord_user_id
    WHERE u.enabled=1 AND n.config_version=u.config_version AND n.status IN ('candidate','failed','sending')`).get();
  problems = healthProblems(heartbeat, scan.at, queue.at, Date.now());
} catch { problems = ['database-unavailable']; }
finally { db?.close(); }

if (process.argv.includes('--preview')) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems }));
} else {
  try {
    const url = new URL(process.env.HEALTHCHECKS_BOT_PING_URL);
    if (url.protocol !== 'https:' || url.hostname !== 'hc-ping.com' || url.search || url.hash
      || !/^\/[0-9a-f-]{36}$/.test(url.pathname)) throw new Error('Invalid health URL');
    if (problems.length) url.pathname += '/fail';
    const response = await fetch(url, { method: 'POST', body: problems.join(','), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Health service rejected ping');
    console.log(JSON.stringify({ delivered: true, ok: problems.length === 0, problems }));
  } catch {
    console.error('External health ping failed');
    process.exitCode = 1;
  }
}

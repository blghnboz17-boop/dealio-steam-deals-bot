import { afterEach, describe, expect, it, vi } from 'vitest';
import { reliabilityFixture } from './helpers/reliability-fixture.js';

afterEach(() => vi.restoreAllMocks());

describe('a stored notification preference that no longer validates', () => {
  it('delivers the alert instead of holding it back on every tick', async () => {
    const f = reliabilityFixture(1);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      f.addUser();
      await f.services.check.check('fixture-user');
      f.steamTransport.mode = 'sale';
      f.advance(301_000);
      await f.services.check.check('fixture-user');
      expect(f.counts()).toEqual([{ status: 'candidate', count: 1 }]);

      // e.g. a timezone that the runtime's ICU data no longer knows.
      f.services.db.prepare(`INSERT INTO notification_preference
        (discord_user_id, mode, timezone, quiet_start, quiet_end, digest_minute)
        VALUES ('fixture-user', 'quiet', 'Invalid/Zone', 60, 120, NULL)`).run();

      const result = await f.services.notifications.deliverPending('fixture-user');

      expect(result.sentCount).toBe(1);
      expect(f.counts()).toEqual([{ status: 'sent', count: 1 }]);
    } finally { f.close(); }
  });
});

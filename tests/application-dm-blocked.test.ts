import { afterEach, describe, expect, it, vi } from 'vitest';
import { reliabilityFixture } from './helpers/reliability-fixture.js';

afterEach(() => vi.restoreAllMocks());

describe('a user who blocks DMs during a large sale', () => {
  it('gets one rejected DM, not one per planned message', async () => {
    const f = reliabilityFixture(25);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      f.addUser();
      await f.services.check.check('fixture-user');
      f.steamTransport.mode = 'sale';
      f.advance(301_000);
      await f.services.check.check('fixture-user');
      expect(f.counts()).toEqual([{ status: 'candidate', count: 25 }]);

      f.discordTransport.failure = 'blocked';
      const result = await f.services.notifications.deliverPending('fixture-user');

      expect(f.discordTransport.attempts).toBe(1);
      expect(result.sentCount).toBe(0);
      expect(f.services.users.findByDiscordUserId('fixture-user')).toMatchObject({
        enabled: false,
        dmDeliveryBlockedAt: expect.any(String),
      });
      // Monitoring is paused, so nothing else is attempted for this user.
      f.advance(86_400_000);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.discordTransport.attempts).toBe(1);
    } finally { f.close(); }
  });
});

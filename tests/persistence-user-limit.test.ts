import { expect, it } from 'vitest';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository, UserLimitReachedError } from '../src/persistence/user-config-repository.js';

const at = '2026-10-01T00:00:00.000Z';

it('enforces the user limit inside the write, so two sign-ups cannot both take the last place', () => {
  const database = createDatabase(':memory:');
  try {
    const users = new UserConfigRepository(database);
    users.upsert('first', '76561198000000030', 'en', 'US', at, { maximumUsers: 2 });
    // Both passed the earlier capacity check while one place was left.
    users.upsert('second', '76561198000000031', 'en', 'US', at, { maximumUsers: 2 });
    expect(() => users.upsert('third', '76561198000000032', 'en', 'US', at, { maximumUsers: 2 }))
      .toThrow(UserLimitReachedError);
    expect(database.isTransaction).toBe(false);
    expect(users.countUsers()).toBe(2);
    expect(users.findByDiscordUserId('third')).toBeNull();
    // A configured user can still change their own settings at the limit.
    expect(users.upsert('first', '76561198000000033', 'tr', 'TR', at, { maximumUsers: 2 }).steamId64)
      .toBe('76561198000000033');
    // Without the option the repository applies no limit (owner tools, tests).
    users.upsert('third', '76561198000000032', 'en', 'US', at);
    expect(users.countUsers()).toBe(3);
  } finally {
    database.close();
  }
});

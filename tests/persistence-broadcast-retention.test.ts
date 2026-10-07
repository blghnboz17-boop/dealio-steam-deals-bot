import { expect, it } from 'vitest';
import { BroadcastRepository } from '../src/persistence/broadcast-repository.js';
import { createDatabase } from '../src/persistence/database.js';

const content = { en: { title: 'News', body: 'Hello' } };

it('keeps announcement delivery records 90 days, also for an announcement left paused', () => {
  const database = createDatabase(':memory:');
  try {
    const broadcasts = new BroadcastRepository(database);
    const recipients = [{ discordUserId: '444444444444444444', language: 'en' as const }];
    for (const id of ['old-paused', 'old-sending', 'recent-paused']) {
      const at = id.startsWith('old') ? '2026-06-01T00:00:00.000Z' : '2026-09-30T00:00:00.000Z';
      broadcasts.create(id, content, {}, recipients, at);
      if (id.endsWith('paused')) broadcasts.setStatus(id, 'paused', at);
    }

    broadcasts.cleanup(new Date('2026-10-07T00:00:00.000Z'));

    expect(broadcasts.get('old-paused')).toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS n FROM broadcast_recipient WHERE broadcast_id = 'old-paused'").get())
      .toEqual({ n: 0 });
    // Still being delivered, or paused only recently: kept.
    expect(broadcasts.get('old-sending')).not.toBeNull();
    expect(broadcasts.get('recent-paused')).not.toBeNull();
  } finally {
    database.close();
  }
});

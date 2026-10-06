import { ActivityType, Events, type Client, type Guild } from 'discord.js';
import { safeLogger } from '../application/safe-logger.js';
import type { AdminControlRepository } from '../persistence/admin-control-repository.js';
import type { TelemetryRepository } from '../persistence/telemetry-repository.js';

export interface GuildTrackingOptions {
  readonly client: Client;
  readonly telemetry: Pick<TelemetryRepository, 'recordGuildEvent' | 'latestGuildEvents'>;
  readonly controls: Pick<AdminControlRepository, 'isGuildBlocked'>;
  readonly presenceText: () => string | null;
  readonly now?: () => Date;
}

/** Shows the owner's status line under the bot's name; null clears it. */
export function applyPresence(client: Client, text: string | null): void {
  if (!client.user) return;
  client.user.setPresence({
    activities: text ? [{ name: 'Custom Status', type: ActivityType.Custom, state: text.slice(0, 128) }] : [],
  });
}

/**
 * Records server joins and leaves for the admin panel, leaves servers the owner
 * blocked, and applies the configured presence. Failures are logged and ignored.
 */
export function registerGuildTracking(options: GuildTrackingOptions): void {
  const { client, telemetry, controls } = options;
  const now = options.now ?? (() => new Date());
  const record = (guild: Guild, event: 'join' | 'leave', at: Date): void => {
    try {
      telemetry.recordGuildEvent({
        guildId: guild.id, guildName: guild.name ?? guild.id, memberCount: guild.memberCount ?? null, event,
        occurredAt: at.toISOString(),
      });
    } catch (error: unknown) {
      safeLogger.error('Could not record a server event', error);
    }
  };
  const leaveIfBlocked = (guild: Guild): void => {
    try {
      if (!controls.isGuildBlocked(guild.id)) return;
    } catch (error: unknown) {
      safeLogger.error('Could not read the server block list', error);
      return;
    }
    console.log(`${now().toISOString()} [admin] Leaving a blocked server.`);
    void guild.leave().catch((error: unknown) => safeLogger.error('Could not leave a blocked server', error));
  };

  client.once(Events.ClientReady, () => {
    try {
      // Servers joined or left while the bot was offline, and the first run's backfill.
      const latest = telemetry.latestGuildEvents();
      for (const guild of client.guilds.cache.values()) {
        if (latest.get(guild.id)?.event !== 'join') {
          record(guild, 'join', Number.isFinite(guild.joinedTimestamp) ? new Date(guild.joinedTimestamp) : now());
        }
        leaveIfBlocked(guild);
      }
      for (const [guildId, last] of latest) {
        if (last.event === 'join' && !client.guilds.cache.has(guildId)) {
          telemetry.recordGuildEvent({
            guildId, guildName: last.guildName, memberCount: null, event: 'leave', occurredAt: now().toISOString(),
          });
        }
      }
    } catch (error: unknown) {
      safeLogger.error('Could not reconcile server history', error);
    }
    try {
      applyPresence(client, options.presenceText());
    } catch (error: unknown) {
      safeLogger.error('Could not apply the bot presence', error);
    }
  });
  client.on(Events.GuildCreate, (guild) => {
    record(guild, 'join', now());
    leaveIfBlocked(guild);
  });
  client.on(Events.GuildDelete, (guild) => {
    // An outage makes a server unavailable; only a real removal is a leave.
    if (guild.available === false) return;
    record(guild, 'leave', now());
  });
}

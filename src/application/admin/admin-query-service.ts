import { existsSync, statSync } from 'node:fs';
import type { DiscordDirectory, DirectoryGuild, DirectoryUser } from '../../admin/discord-directory.js';
import type { AdminRepository } from '../../persistence/admin-repository.js';
import type { AssistantRepository } from '../../persistence/assistant-repository.js';
import type { DeletionJournal } from '../../persistence/deletion-journal.js';
import type { PollScheduleRepository } from '../../persistence/poll-schedule-repository.js';
import type { UserConfigRepository } from '../../persistence/user-config-repository.js';
import type { AdminControlRepository } from '../../persistence/admin-control-repository.js';
import type { BroadcastRepository } from '../../persistence/broadcast-repository.js';
import type { TelemetryRepository } from '../../persistence/telemetry-repository.js';
import type { RuntimeSettingsSnapshot } from './runtime-settings.js';
import type { RuntimeHealthDocument } from '../runtime-health.js';
import type { SchedulerStatus } from '../scheduler.js';

export interface AdminQueryDependencies {
  readonly adminRepository: AdminRepository;
  readonly userConfigRepository: Pick<UserConfigRepository, 'findByDiscordUserId'>;
  readonly assistant: Pick<AssistantRepository, 'snapshot' | 'rules' | 'preference'>;
  readonly pollSchedule: Pick<PollScheduleRepository, 'findNextScheduledAt'>;
  readonly directory: DiscordDirectory;
  readonly schedulerStatus: () => SchedulerStatus;
  readonly health?: () => RuntimeHealthDocument;
  readonly deletionJournal?: Pick<DeletionJournal, 'count'>;
  readonly telemetry: TelemetryRepository;
  readonly controls: AdminControlRepository;
  readonly broadcasts: BroadcastRepository;
  readonly runtimeSettings: () => RuntimeSettingsSnapshot;
  readonly databasePath: string;
  readonly settings: {
    readonly pollIntervalHours: number;
    readonly notificationRetryIntervalSeconds: number;
    readonly priceHistoryEnabled: boolean;
    readonly steamVanityEnabled: boolean;
    readonly production: boolean;
  };
  readonly now?: () => Date;
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

/** Everything the admin panel reads. No method here changes state. */
export class AdminQueryService {
  private readonly now: () => Date;

  public constructor(private readonly dependencies: AdminQueryDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async overview(): Promise<unknown> {
    const { adminRepository: repository, directory, telemetry } = this.dependencies;
    const now = this.now();
    const guilds = directory.guilds();
    const day = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();
    return {
      generatedAt: now.toISOString(),
      discord: directory.status(),
      application: await directory.applicationCounts(),
      guilds: {
        count: guilds.length,
        members: guilds.reduce((sum, guild) => sum + guild.memberCount, 0),
      },
      counts: repository.overviewCounts(now),
      activity: {
        active24h: telemetry.activeUsersSince(day(1)),
        active7d: telemetry.activeUsersSince(day(7)),
        active30d: telemetry.activeUsersSince(day(30)),
      },
      settings: this.dependencies.runtimeSettings(),
      maxUsers: this.dependencies.runtimeSettings().maxUsers,
      scheduler: this.scheduler(),
      process: this.process(),
      charts: {
        signups: repository.signupsByDay(90, now),
        alerts: repository.alertsByDay(30, now),
        activeUsers: telemetry.dailyActiveUsers(day(30)),
        guilds: telemetry.guildCountByDay(),
      },
      distributions: {
        countries: repository.distribution('store_country_code'),
        languages: repository.distribution('language'),
        notificationModes: repository.notificationModes(),
        checkStatuses: repository.checkStatuses(),
        checkErrors: repository.checkErrorCodes(),
        currencies: repository.currencies(),
      },
    };
  }

  public users(): unknown {
    const { telemetry, controls } = this.dependencies;
    const sources = telemetry.firstGuildByUser();
    const lastSeen = telemetry.lastSeenByUser();
    const blocked = new Set(controls.userBlocks().map((block) => block.discordUserId));
    const guildNames = new Map(this.dependencies.directory.guilds().map((guild) => [guild.id, guild.name]));
    return {
      users: this.dependencies.adminRepository.users().map((user) => {
        const source = sources.get(user.discordUserId) ?? null;
        return {
          ...user,
          sourceGuildId: source,
          sourceGuildName: source ? guildNames.get(source) ?? null : null,
          lastSeenAt: lastSeen.get(user.discordUserId) ?? null,
          blocked: blocked.has(user.discordUserId),
        };
      }),
    };
  }

  public async profiles(ids: readonly string[]): Promise<Record<string, DirectoryUser | null>> {
    return Object.fromEntries(await this.dependencies.directory.users(ids.slice(0, 100)));
  }

  public async user(discordUserId: string): Promise<unknown | null> {
    const config = this.dependencies.userConfigRepository.findByDiscordUserId(discordUserId);
    if (!config) return null;
    const { assistant, adminRepository } = this.dependencies;
    const snapshot = assistant.snapshot(config);
    const rules = assistant.rules(config);
    const names = new Map(snapshot?.items.map((item) => [item.appId, item.name]) ?? []);
    const profile = (await this.dependencies.directory.users([discordUserId])).get(discordUserId) ?? null;
    const summary = adminRepository.users().find((row) => row.discordUserId === discordUserId) ?? null;
    return {
      config,
      summary,
      profile,
      checkState: adminRepository.checkState(discordUserId),
      preference: assistant.preference(discordUserId),
      rules: [...rules].map(([appId, rule]) => ({ appId, name: names.get(appId) ?? null, ...rule })),
      snapshot: snapshot ? {
        capturedAt: snapshot.capturedAt,
        language: snapshot.language,
        errorCount: snapshot.errors.length,
        items: snapshot.items.map((item) => ({
          appId: item.appId,
          name: item.name,
          price: item.price,
          onSale: item.onSale,
          priority: item.priority,
          dateAdded: item.dateAdded,
          upcoming: item.upcoming ?? null,
          headerImageUrl: item.headerImageUrl ?? null,
        })),
      } : null,
      notifications: adminRepository.notifications(discordUserId, 100),
      usage: this.withGuildNames(this.dependencies.telemetry.userUsage(discordUserId)),
      blocked: this.dependencies.controls.isUserBlocked(discordUserId),
      messages: this.dependencies.broadcasts.forUser(discordUserId, 20),
      audit: this.dependencies.controls.auditEntries(30, discordUserId),
    };
  }

  public async guilds(): Promise<unknown> {
    const { telemetry, controls, directory } = this.dependencies;
    const guilds = directory.guilds();
    const owners = await directory.users(guilds.map((guild) => guild.ownerId));
    const sources = new Map(telemetry.guildSources().map((source) => [source.guildId, source]));
    return {
      guilds: guilds.map((guild: DirectoryGuild) => ({
        ...guild,
        owner: owners.get(guild.ownerId) ?? null,
        dealioUsers: sources.get(guild.id)?.users ?? 0,
        registeredUsers: sources.get(guild.id)?.registeredUsers ?? 0,
        lastActivityAt: sources.get(guild.id)?.lastSeenAt ?? null,
      })),
      departed: telemetry.departedGuilds(),
      blocked: controls.guildBlocks(),
      events: telemetry.guildEvents(100),
    };
  }

  public async guild(guildId: string): Promise<unknown | null> {
    const { telemetry, directory, controls } = this.dependencies;
    const live = directory.guilds().find((guild) => guild.id === guildId) ?? null;
    const events = telemetry.guildEvents(100, guildId);
    if (!live && events.length === 0) return null;
    const users = telemetry.guildUsers(guildId);
    const profiles = await directory.users([...(live ? [live.ownerId] : []), ...users.slice(0, 50).map((user) => user.discordUserId)]);
    return {
      guild: live ? { ...live, owner: profiles.get(live.ownerId) ?? null } : null,
      name: live?.name ?? events[0]?.guildName ?? guildId,
      blocked: controls.isGuildBlocked(guildId),
      events,
      users: users.map((user) => ({ ...user, profile: profiles.get(user.discordUserId) ?? null })),
      audit: controls.auditEntries(30, guildId),
    };
  }

  public usage(days: number): unknown {
    const { telemetry } = this.dependencies;
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    const guildNames = new Map(this.dependencies.directory.guilds().map((guild) => [guild.id, guild.name]));
    return {
      days,
      dailyActive: telemetry.dailyActiveUsers(since),
      actions: telemetry.usageBy('action', since),
      contexts: telemetry.usageBy('context', since),
      installs: telemetry.usageBy('install', since),
      locales: telemetry.usageBy('locale', since),
      setup: telemetry.setupFunnel(since),
      sources: telemetry.guildSources()
        .map((source) => ({ ...source, guildName: guildNames.get(source.guildId) ?? null }))
        .sort((left, right) => right.users - left.users),
    };
  }

  public audit(limit: number): unknown {
    return { entries: this.dependencies.controls.auditEntries(limit) };
  }

  public broadcastList(): unknown {
    return { broadcasts: this.dependencies.broadcasts.list(50) };
  }

  public async broadcastDetail(broadcastId: string): Promise<unknown | null> {
    const broadcast = this.dependencies.broadcasts.get(broadcastId);
    if (!broadcast) return null;
    const recipients = this.dependencies.broadcasts.recipients(broadcastId);
    const profiles = await this.dependencies.directory.users(recipients.slice(0, 100).map((row) => row.discordUserId));
    return {
      broadcast,
      recipients: recipients.map((row) => ({ ...row, profile: profiles.get(row.discordUserId) ?? null })),
    };
  }

  private withGuildNames<T extends { guilds: Array<{ guildId: string }> }>(usage: T): T {
    const names = new Map(this.dependencies.directory.guilds().map((guild) => [guild.id, guild.name]));
    return { ...usage, guilds: usage.guilds.map((guild) => ({ ...guild, guildName: names.get(guild.guildId) ?? null })) };
  }

  public games(): unknown {
    const repository = this.dependencies.adminRepository;
    return {
      wishlisted: repository.topWishlistedGames(50),
      onSale: repository.topGamesOnSale(50),
      alerted: repository.topAlertedGames(30, 50, this.now()),
      ruled: repository.topRuledGames(50),
      currencies: repository.currencies(),
    };
  }

  public system(): unknown {
    const { settings, databasePath, deletionJournal, health, adminRepository } = this.dependencies;
    return {
      health: health?.() ?? null,
      discord: this.dependencies.directory.status(),
      scheduler: this.scheduler(),
      process: this.process(),
      database: {
        path: databasePath === ':memory:' ? ':memory:' : databasePath,
        sizeBytes: databasePath === ':memory:' ? 0 : fileSize(databasePath),
        walBytes: databasePath === ':memory:' ? 0 : fileSize(`${databasePath}-wal`),
        schemaVersion: adminRepository.schemaVersion(),
      },
      deletionsKept: deletionJournal?.count() ?? 0,
      runtimeSettings: this.dependencies.runtimeSettings(),
      blockedUsers: this.dependencies.controls.userBlocks(),
      settings: {
        maxUsers: this.dependencies.runtimeSettings().maxUsers,
        pollIntervalHours: settings.pollIntervalHours,
        notificationRetryIntervalSeconds: settings.notificationRetryIntervalSeconds,
        priceHistoryEnabled: settings.priceHistoryEnabled,
        steamVanityEnabled: settings.steamVanityEnabled,
        production: settings.production,
      },
    };
  }

  private scheduler(): unknown {
    return {
      ...this.dependencies.schedulerStatus(),
      nextScheduledAt: this.dependencies.pollSchedule.findNextScheduledAt(),
    };
  }

  private process(): unknown {
    const memory = process.memoryUsage();
    return {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    };
  }
}

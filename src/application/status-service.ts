import type { CheckState } from '../domain/check-state.js';
import type { UserConfig } from '../domain/user-config.js';
import { CheckStateRepository } from '../persistence/check-state-repository.js';
import {
  StatusDashboardRepository,
  type NotificationQueueCounts,
} from '../persistence/status-dashboard-repository.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import type { Language } from '../domain/user-config.js';
import type { DiscountThresholdRepository } from '../persistence/discount-threshold-repository.js';

export interface UserStatus {
  readonly config: UserConfig | null;
  readonly checkState: CheckState | null;
}

export type StatusDashboardResult =
  | { readonly status: 'not-configured'; readonly language: Language }
  | { readonly status: 'unavailable'; readonly language: Language }
  | {
      readonly status: 'ready';
      readonly language: Language;
      readonly config: UserConfig;
      readonly checkState: CheckState | null;
      readonly notificationQueue: NotificationQueueCounts;
      readonly gameDiscountOverrideCount: number;
    };

export class StatusService {
  public constructor(
    private readonly userConfigRepository: UserConfigRepository,
    private readonly checkStateRepository: CheckStateRepository,
    private readonly dashboardRepository: StatusDashboardRepository,
    private readonly thresholdRepository?: Pick<DiscountThresholdRepository, 'countGameOverrides'>,
  ) {}

  public get(discordUserId: string): UserStatus {
    return {
      config: this.userConfigRepository.findByDiscordUserId(discordUserId),
      checkState: this.checkStateRepository.findByDiscordUserId(discordUserId),
    };
  }

  public getDashboard(
    discordUserId: string,
    fallbackLanguage: Language,
  ): StatusDashboardResult {
    let config: UserConfig | null;
    try {
      config = this.userConfigRepository.findByDiscordUserId(discordUserId);
    } catch (_error: unknown) {
      return { status: 'unavailable', language: fallbackLanguage };
    }
    if (!config) {
      return { status: 'not-configured', language: fallbackLanguage };
    }

    try {
      return {
        status: 'ready',
        language: config.language,
        config,
        checkState: this.checkStateRepository.findByDiscordUserId(discordUserId),
        notificationQueue: this.dashboardRepository.findNotificationQueueCounts(config),
        gameDiscountOverrideCount: this.thresholdRepository?.countGameOverrides(config) ?? 0,
      };
    } catch (_error: unknown) {
      return { status: 'unavailable', language: config.language };
    }
  }
}

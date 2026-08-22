import {
  isMinimumDiscountPercent,
  type UserConfig,
} from '../domain/user-config.js';
import { DiscountThresholdRepository } from '../persistence/discount-threshold-repository.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export class InvalidDiscountThresholdError extends Error {}

export interface GameDiscountThresholdResult {
  readonly config: UserConfig;
  readonly appId: number;
  readonly overridePercent: number | null;
  readonly effectivePercent: number;
}

export class DiscountThresholdService {
  public constructor(
    private readonly userConfigRepository: UserConfigRepository,
    private readonly thresholdRepository: DiscountThresholdRepository,
    private readonly coordinator = new UserOperationCoordinator(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  public setGlobal(
    discordUserId: string,
    percent: number,
    expectedConfigurationId?: string,
  ): Promise<UserConfig | null> {
    this.validatePercent(percent);
    return this.coordinator.runExclusive(discordUserId, () =>
      this.userConfigRepository.setMinimumDiscountPercent(
        discordUserId,
        percent,
        this.now().toISOString(),
        expectedConfigurationId,
      ),
    );
  }

  public setGame(
    discordUserId: string,
    appId: number,
    percent: number | null,
    expectedConfigVersion?: number,
    expectedConfigurationId?: string,
  ): Promise<GameDiscountThresholdResult | null> {
    if (!Number.isSafeInteger(appId) || appId <= 0) {
      throw new InvalidDiscountThresholdError('Steam app ID must be a positive integer');
    }
    if (percent !== null) {
      this.validatePercent(percent);
    }

    return this.coordinator.runExclusive(discordUserId, () => {
      const config = this.userConfigRepository.findByDiscordUserId(discordUserId);
      if (!config) {
        return null;
      }
      if (
        expectedConfigVersion !== undefined
        && config.configVersion !== expectedConfigVersion
      ) {
        return null;
      }
      if (
        expectedConfigurationId !== undefined
        && config.configurationId !== expectedConfigurationId
      ) {
        return null;
      }
      if (percent === null) {
        this.thresholdRepository.deleteGameOverride(config, appId);
      } else if (!this.thresholdRepository.setGameOverride(
        config,
        appId,
        percent,
        this.now().toISOString(),
      )) {
        return null;
      }
      return {
        config,
        appId,
        overridePercent: percent,
        effectivePercent: percent ?? config.minimumDiscountPercent,
      };
    });
  }

  private validatePercent(percent: number): void {
    if (!isMinimumDiscountPercent(percent)) {
      throw new InvalidDiscountThresholdError(
        'Minimum discount percent must be an integer between 0 and 100',
      );
    }
  }
}

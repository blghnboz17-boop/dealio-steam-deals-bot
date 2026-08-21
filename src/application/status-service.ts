import type { CheckState } from '../domain/check-state.js';
import type { UserConfig } from '../domain/user-config.js';
import { CheckStateRepository } from '../persistence/check-state-repository.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';

export interface UserStatus {
  readonly config: UserConfig | null;
  readonly checkState: CheckState | null;
}

export class StatusService {
  public constructor(
    private readonly userConfigRepository: UserConfigRepository,
    private readonly checkStateRepository: CheckStateRepository,
  ) {}

  public get(discordUserId: string): UserStatus {
    return {
      config: this.userConfigRepository.findByDiscordUserId(discordUserId),
      checkState: this.checkStateRepository.findByDiscordUserId(discordUserId),
    };
  }
}

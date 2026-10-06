import type { AdminControlRepository } from '../../persistence/admin-control-repository.js';

export interface RuntimeSettingsSnapshot {
  readonly maxUsers: number;
  readonly maxUsersOverride: number | null;
  readonly defaultMaxUsers: number;
  readonly signupsOpen: boolean;
  readonly presenceText: string | null;
}

export interface RuntimeSettingsUpdate {
  readonly maxUsers?: number | null;
  readonly signupsOpen?: boolean;
  readonly presenceText?: string | null;
}

export class InvalidSettingError extends Error {
  public readonly name = 'InvalidSettingError';
}

/**
 * Settings the owner changes from the admin panel without a restart. The
 * environment's DEALIO_MAX_USERS stays the default; an override lives in SQLite.
 */
export class RuntimeSettings {
  public constructor(
    private readonly repository: Pick<AdminControlRepository, 'setting' | 'setSetting'>,
    private readonly defaultMaxUsers: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public maxUsers(): number {
    return this.maxUsersOverride() ?? this.defaultMaxUsers;
  }

  public signupsOpen(): boolean {
    return this.read('signups_open') !== 'false';
  }

  public presenceText(): string | null {
    return this.read('presence_text');
  }

  public snapshot(): RuntimeSettingsSnapshot {
    return {
      maxUsers: this.maxUsers(),
      maxUsersOverride: this.maxUsersOverride(),
      defaultMaxUsers: this.defaultMaxUsers,
      signupsOpen: this.signupsOpen(),
      presenceText: this.presenceText(),
    };
  }

  public update(update: RuntimeSettingsUpdate): RuntimeSettingsSnapshot {
    const at = this.now().toISOString();
    if (update.maxUsers !== undefined) {
      if (update.maxUsers !== null && (!Number.isSafeInteger(update.maxUsers) || update.maxUsers < 1 || update.maxUsers > 1_000_000)) {
        throw new InvalidSettingError('The user limit must be a whole number between 1 and 1,000,000');
      }
      this.repository.setSetting('max_users', update.maxUsers === null ? null : String(update.maxUsers), at);
    }
    if (update.signupsOpen !== undefined) {
      this.repository.setSetting('signups_open', update.signupsOpen ? null : 'false', at);
    }
    if (update.presenceText !== undefined) {
      const text = update.presenceText?.trim() ?? '';
      if (text.length > 128) throw new InvalidSettingError('The status text can be at most 128 characters');
      this.repository.setSetting('presence_text', text === '' ? null : text, at);
    }
    return this.snapshot();
  }

  private maxUsersOverride(): number | null {
    const value = Number(this.read('max_users'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  /** A broken settings table must not stop setup; fall back to the defaults. */
  private read(key: string): string | null {
    try {
      return this.repository.setting(key);
    } catch {
      return null;
    }
  }
}

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { UserConfig } from '../domain/user-config.js';

type ThresholdScope = Pick<UserConfig, 'discordUserId' | 'configVersion' | 'minimumDiscountPercent'>;

function percentageValue(value: SQLOutputValue): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error('Invalid minimum_discount_percent value in game discount threshold');
  }
  return value;
}

export class DiscountThresholdRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findGameOverride(scope: ThresholdScope, appId: number): number | null {
    const row = this.database.prepare(
      `SELECT minimum_discount_percent
       FROM game_discount_threshold
       WHERE discord_user_id = ? AND config_version = ? AND app_id = ?`,
    ).get(scope.discordUserId, scope.configVersion, appId) as
      | { minimum_discount_percent: SQLOutputValue }
      | undefined;
    return row ? percentageValue(row.minimum_discount_percent) : null;
  }

  public findGameOverrides(
    scope: ThresholdScope,
    appIds: readonly number[],
  ): ReadonlyMap<number, number> {
    const uniqueAppIds = [...new Set(appIds)];
    if (uniqueAppIds.length === 0) {
      return new Map();
    }
    const rows = this.database.prepare(
      `SELECT app_id, minimum_discount_percent
       FROM game_discount_threshold
       WHERE discord_user_id = ? AND config_version = ?
         AND app_id IN (${uniqueAppIds.map(() => '?').join(', ')})`,
    ).all(scope.discordUserId, scope.configVersion, ...uniqueAppIds) as unknown as Array<{
      app_id: SQLOutputValue;
      minimum_discount_percent: SQLOutputValue;
    }>;
    return new Map(rows.map((row) => {
      if (typeof row.app_id !== 'number' || !Number.isSafeInteger(row.app_id) || row.app_id <= 0) {
        throw new Error('Invalid app_id value in game discount threshold');
      }
      return [row.app_id, percentageValue(row.minimum_discount_percent)];
    }));
  }

  public countGameOverrides(scope: ThresholdScope): number {
    const row = this.database.prepare(
      `SELECT COUNT(*) AS count
       FROM (SELECT app_id FROM game_discount_threshold WHERE discord_user_id=? AND config_version=?
         UNION SELECT app_id FROM game_rule WHERE discord_user_id=? AND config_version=? AND (mode!='inherit' OR muted=1))`,
    ).get(scope.discordUserId, scope.configVersion, scope.discordUserId, scope.configVersion) as { count: SQLOutputValue };
    if (typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error('Invalid game discount threshold count');
    }
    return row.count;
  }

  public setGameOverride(
    scope: ThresholdScope,
    appId: number,
    minimumDiscountPercent: number,
    now: string,
  ): boolean {
    const result = this.database.prepare(
      `INSERT INTO game_discount_threshold
         (discord_user_id, config_version, app_id, minimum_discount_percent, updated_at)
       SELECT discord_user_id, config_version, ?, ?, ?
       FROM user_config
       WHERE discord_user_id = ? AND config_version = ?
       ON CONFLICT(discord_user_id, config_version, app_id) DO UPDATE SET
         minimum_discount_percent = excluded.minimum_discount_percent,
         updated_at = excluded.updated_at`,
    ).run(
      appId,
      minimumDiscountPercent,
      now,
      scope.discordUserId,
      scope.configVersion,
    );
    return Number(result.changes) === 1;
  }

  public deleteGameOverride(scope: ThresholdScope, appId: number): boolean {
    const result = this.database.prepare(
      `DELETE FROM game_discount_threshold
       WHERE discord_user_id = ? AND config_version = ? AND app_id = ?`,
    ).run(scope.discordUserId, scope.configVersion, appId);
    return Number(result.changes) === 1;
  }
}

import type { DatabaseSync } from 'node:sqlite';
import { preparedStatement } from './prepared-statement.js';

/**
 * How Dealio decides that an ongoing sale deserves another alert.
 *
 * Every sale remembers the discount it already alerted, or took as a baseline
 * (setup, a new rule, a new default threshold). It alerts again only when the
 * rule is met and the discount went clearly deeper than that level. Target
 * prices work the same way with the price that was alerted.
 */
export const deeperDiscountStepPoints = 10;
/** A target alert repeats when the price falls at least this far below the alerted price. */
export const deeperTargetPriceRatio = 0.9;

export function discountAlertDue(discountPercent: number, alertedDiscountPercent: number | null): boolean {
  return alertedDiscountPercent === null || discountPercent >= alertedDiscountPercent + deeperDiscountStepPoints;
}

export function deeperTargetPrice(finalMinor: number, alertedMinor: number | null): boolean {
  return alertedMinor !== null && finalMinor <= Math.floor(alertedMinor * deeperTargetPriceRatio);
}

interface Scope {
  readonly discordUserId: string;
  readonly configVersion: number;
}

interface OngoingSale {
  app_id: number;
  sale_episode_id: string;
  discount_percent: number;
  alerted_discount_percent: number | null;
  threshold: number;
  muted: number | null;
  target_active: number;
  has_own_threshold: number;
}

/**
 * Takes a new baseline for ongoing sales after a rule or the default threshold
 * changed, the same way for both: a sale that already meets the new rule is not
 * alerted for its current discount, a waiting alert that still meets it is kept,
 * and one that no longer meets it is retired. A sale below the new rule alerts
 * once it crosses it.
 */
export function rebaselineDiscountAlerts(
  database: DatabaseSync,
  scope: Scope,
  selection: { readonly appId: number } | { readonly inheritingOnly: true },
): void {
  const byApp = 'appId' in selection;
  const sales = preparedStatement(database,
    `SELECT state.app_id, state.sale_episode_id, state.discount_percent, state.alerted_discount_percent,
            COALESCE(threshold.minimum_discount_percent, config.minimum_discount_percent) AS threshold,
            rule.muted,
            CASE WHEN rule.mode = 'target' AND rule.currency = state.currency THEN 1 ELSE 0 END AS target_active,
            CASE WHEN threshold.app_id IS NULL THEN 0 ELSE 1 END AS has_own_threshold
     FROM wishlist_item_state AS state
     JOIN user_config AS config
       ON config.discord_user_id = state.discord_user_id AND config.config_version = state.config_version
     LEFT JOIN game_discount_threshold AS threshold
       ON threshold.discord_user_id = state.discord_user_id AND threshold.config_version = state.config_version
      AND threshold.app_id = state.app_id
     LEFT JOIN game_rule AS rule
       ON rule.discord_user_id = state.discord_user_id AND rule.config_version = state.config_version
      AND rule.app_id = state.app_id
     WHERE state.discord_user_id = ? AND state.config_version = ? AND state.on_sale = 1
       AND state.sale_episode_id IS NOT NULL AND state.discount_percent IS NOT NULL
       ${byApp ? 'AND state.app_id = ?' : ''}`,
  ).all(scope.discordUserId, scope.configVersion, ...(byApp ? [selection.appId] : [])) as unknown as OngoingSale[];

  for (const sale of sales) {
    const governedByDefault = sale.has_own_threshold === 0 && sale.target_active === 0;
    if (!byApp && !governedByDefault) continue;
    const meets = sale.muted !== 1 && sale.target_active === 0
      && sale.discount_percent > 0 && sale.discount_percent >= sale.threshold;
    if (!meets) {
      retireWaitingDiscountAlert(database, scope, sale.app_id, sale.sale_episode_id, 'Rule changed and is no longer met');
      continue;
    }
    // Already-met discounts become the baseline; an earlier, deeper alert level is kept.
    const alerted = Math.max(sale.alerted_discount_percent ?? sale.discount_percent, sale.discount_percent);
    preparedStatement(database,
      `UPDATE wishlist_item_state SET alerted_discount_percent = ?
       WHERE discord_user_id = ? AND config_version = ? AND app_id = ?`,
    ).run(alerted, scope.discordUserId, scope.configVersion, sale.app_id);
  }
}

/** Retires a waiting (not yet sent) discount alert, with any retry envelope that holds it. */
export function retireWaitingDiscountAlert(
  database: DatabaseSync,
  scope: Scope,
  appId: number,
  saleEpisodeId: string,
  reason: string,
): void {
  preparedStatement(database,
    `UPDATE notification_batch SET status = 'expired', next_attempt_at = NULL
     WHERE status = 'failed' AND batch_id IN (
       SELECT batch_id FROM notification_batch_item
       WHERE discord_user_id = ? AND config_version = ? AND app_id = ? AND sale_episode_id = ?)`,
  ).run(scope.discordUserId, scope.configVersion, appId, saleEpisodeId);
  preparedStatement(database,
    `UPDATE notification_log SET status = 'expired', next_attempt_at = NULL, last_error = ?
     WHERE discord_user_id = ? AND config_version = ? AND app_id = ? AND sale_episode_id = ?
       AND reason = 'discount' AND status IN ('candidate', 'failed')`,
  ).run(reason, scope.discordUserId, scope.configVersion, appId, saleEpisodeId);
}

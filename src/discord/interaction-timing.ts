import { safeLogger } from '../application/safe-logger.js';

type DiscordOperation = `${string}.${'ack' | 'button-ack' | 'button-update' | 'modal' | 'modal-submit-ack' | 'render' | 'load' | 'open'}`;

export async function measureDiscordOperation<T>(
  interaction: { readonly createdTimestamp?: number },
  operation: DiscordOperation,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let failed = false;
  let errorCode: number | undefined;
  try {
    return await run();
  } catch (error: unknown) {
    failed = true;
    if (typeof error === 'object' && error !== null && 'code' in error
      && typeof error.code === 'number') errorCode = error.code;
    throw error;
  } finally {
    const finished = Date.now();
    const durationMs = Math.max(0, finished - started);
    const startAgeMs = interaction.createdTimestamp === undefined
      ? undefined : Math.max(0, started - interaction.createdTimestamp);
    const interactionAgeMs = interaction.createdTimestamp === undefined
      ? undefined : Math.max(0, finished - interaction.createdTimestamp);
    const phase = operation.slice(operation.lastIndexOf('.') + 1);
    // A button-update is the click's acknowledgement and its panel edit in one call.
    const acknowledgement = ['ack', 'button-ack', 'button-update', 'modal', 'modal-submit-ack'].includes(phase);
    const lateAcknowledgement = acknowledgement && (interactionAgeMs ?? 0) >= 2000;
    if (acknowledgement) {
      safeLogger.log('[discord-metric]', JSON.stringify({
        operation, durationMs, failed, interactionAgeMs,
      }));
    } else if (['load', 'render', 'open'].includes(phase)) {
      // Keep UI work separate: its duration is not an interaction acknowledgement.
      // Only *.open age denotes initial panel readiness; later render ages do not.
      safeLogger.log('[discord-ui-metric]', JSON.stringify({
        operation, durationMs, failed, interactionAgeMs,
      }));
    }
    if (failed || durationMs >= 1000 || lateAcknowledgement) {
      // Never log interaction objects, response bodies, custom IDs or error URLs.
      safeLogger.warn('[discord-timing]', {
        operation, durationMs, failed, errorCode,
        startAgeMs, interactionAgeMs,
      });
    }
  }
}

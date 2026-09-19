import { safeLogger } from '../application/safe-logger.js';

type DiscordOperation = `${string}.${'ack' | 'button-ack' | 'modal' | 'modal-submit-ack' | 'render' | 'load'}`;

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
    const acknowledgement = ['ack', 'button-ack', 'modal', 'modal-submit-ack'].includes(phase);
    const lateAcknowledgement = acknowledgement && (interactionAgeMs ?? 0) >= 2000;
    if (failed || durationMs >= 1000 || lateAcknowledgement) {
      // Never log interaction objects, response bodies, custom IDs or error URLs.
      safeLogger.warn('[discord-timing]', {
        operation, durationMs, failed, errorCode,
        startAgeMs, interactionAgeMs,
      });
    }
  }
}

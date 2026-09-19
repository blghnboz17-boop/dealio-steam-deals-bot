import { safeLogger } from '../application/safe-logger.js';

export async function measureDiscordOperation<T>(
  interaction: { readonly createdTimestamp?: number },
  operation: string,
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
    const durationMs = Math.max(0, Date.now() - started);
    if (failed || durationMs >= 1000) {
      // Never log interaction objects, response bodies, custom IDs or error URLs.
      safeLogger.warn('[discord-timing]', {
        operation, durationMs, failed, errorCode,
        startAgeMs: interaction.createdTimestamp === undefined
          ? undefined : Math.max(0, started - interaction.createdTimestamp),
        interactionAgeMs: interaction.createdTimestamp === undefined
          ? undefined : Math.max(0, Date.now() - interaction.createdTimestamp),
      });
    }
  }
}

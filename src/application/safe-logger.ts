
import { inspect } from 'node:util';

export function redactSecrets(value: unknown): string {
  const text = typeof value === 'string' ? value : inspect(value, {depth:5, maxArrayLength:20, getters:false});
  return text
    .replace(/(https?:\/\/[^\s'"]*\/(?:webhooks|interactions)\/[^\/\s]+\/)[^\s\/?'"]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|token|password|secret|api[_-]?key)\s*['"]?\s*[:=]\s*['"]?)(?:Bot\s+|Bearer\s+|Basic\s+)?[^\s,'"}]+/gi, '$1[REDACTED]')
    .replace(/\b(?:Bot|Bearer|Basic)\s+[\w.\-]+/g, '[REDACTED AUTH]')
    .replace(/([?&](?:sig|code|token|key)=)[^&#\s]+/gi, '$1[REDACTED]');
}

export const safeLogger = {
  error: (...values: unknown[]): void => console.error(...values.map(redactSecrets)),
  warn: (...values: unknown[]): void => console.warn(...values.map(redactSecrets)),
  log: (...values: unknown[]): void => console.log(...values.map(redactSecrets)),
};

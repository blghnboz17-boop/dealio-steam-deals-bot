import { isPasswordVerifier } from './password.js';
import {
  parsePublicOrigin,
  RequestValidationError,
  type PublicOrigin,
} from './security.js';

const usernamePattern = /^[a-z][a-z0-9._-]{2,63}$/;
const defaultPort = 3_001;
const defaultDatabasePath = './data/wishlist.db';
const defaultHealthPath = './.runtime/bot.health.json';

export interface AdminEnvironment {
  readonly users: ReadonlyMap<string, string>;
  readonly publicOrigin: PublicOrigin;
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly databasePath: string;
  readonly healthPath: string;
}

export class AdminEnvironmentError extends Error {
  public readonly name = 'AdminEnvironmentError';
}

function invalidConfiguration(): AdminEnvironmentError {
  return new AdminEnvironmentError('ADMIN_USERS_JSON must contain valid admin credentials');
}

function invalidOrigin(): AdminEnvironmentError {
  return new AdminEnvironmentError(
    'ADMIN_PUBLIC_ORIGIN must be a canonical pathless HTTPS origin',
  );
}

function parseAdminOrigin(value: string | undefined): PublicOrigin {
  let parsed: PublicOrigin;
  try {
    parsed = parsePublicOrigin(value);
  } catch (error: unknown) {
    if (error instanceof RequestValidationError) {
      throw invalidOrigin();
    }
    throw error;
  }
  if (parsed.host.includes('*')) {
    throw invalidOrigin();
  }
  return parsed;
}

function parseAdminPort(value: string | undefined): number {
  const configured = value?.trim();
  if (configured === undefined || configured === '') {
    return defaultPort;
  }
  if (!/^\d+$/.test(configured)) {
    throw new AdminEnvironmentError('ADMIN_PORT must be an integer from 1 through 65535');
  }
  const port = Number(configured);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new AdminEnvironmentError('ADMIN_PORT must be an integer from 1 through 65535');
  }
  return port;
}

function pathValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw invalidConfiguration();
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadAdminEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AdminEnvironment {
  const configured = environment.ADMIN_USERS_JSON;
  if (configured === undefined || configured.trim() === '') {
    throw invalidConfiguration();
  }
  const parsed = parseJson(configured);
  if (!isRecord(parsed)) {
    throw invalidConfiguration();
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw invalidConfiguration();
  }
  const users = new Map<string, string>();
  for (const [username, verifier] of entries) {
    if (
      !usernamePattern.test(username) ||
      typeof verifier !== 'string' ||
      !isPasswordVerifier(verifier)
    ) {
      throw invalidConfiguration();
    }
    users.set(username, verifier);
  }
  return {
    users,
    publicOrigin: parseAdminOrigin(environment.ADMIN_PUBLIC_ORIGIN),
    host: '127.0.0.1',
    port: parseAdminPort(environment.ADMIN_PORT),
    databasePath: pathValue(environment.DATABASE_PATH, defaultDatabasePath),
    healthPath: pathValue(environment.ADMIN_HEALTH_PATH, defaultHealthPath),
  };
}

import type { IncomingMessage } from 'node:http';
import type { AdminAuditLogger } from './audit-logger.js';
import { parseAdminClientIdentity } from './client-identity.js';
import type { AdminLoginService } from './login-service.js';
import {
  FormBodyError,
  parseAdminCookie,
  parseUrlEncodedBody,
  serializeAdminCookie,
} from './security.js';
import type { LoginViewModel } from './ui/login-view.js';

const LOGIN_COOKIE = '__Host-dealio_login';
const SESSION_COOKIE = '__Host-dealio_admin';
const LOGIN_COOKIE_SECONDS = 600;
const SESSION_COOKIE_SECONDS = 8 * 60 * 60;
const GENERIC_LOGIN_ERROR = 'Kullanıcı adı veya parola geçersiz.';

export type AdminResponseSpec = {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly cookies?: string | readonly string[];
  readonly location?: string;
  readonly allow?: string;
  readonly retryAfter?: number;
};

export type AdminLoginHttpDependencies = {
  readonly loginService: AdminLoginService;
  readonly auditLogger: AdminAuditLogger;
  readonly renderLogin: (model: LoginViewModel) => string;
  readonly now: () => Date;
};

function client(request: IncomingMessage) {
  return parseAdminClientIdentity({
    peerAddress: request.socket.remoteAddress,
    rawHeaders: request.rawHeaders,
  });
}

function formField(fields: ReadonlyMap<string, string>, name: string): string {
  const value = fields.get(name);
  if (value === undefined) throw new FormBodyError(400);
  return value;
}

function unavailable(status: 429 | 503, retryAfter?: number): AdminResponseSpec {
  if (status === 429 && retryAfter !== undefined) {
    return { status, retryAfter, body: 'Çok fazla istek gönderildi.' };
  }
  return { status, body: 'Hizmet geçici olarak kullanılamıyor.' };
}

function assertNever(value: never): never {
  throw new TypeError('Unexpected admin login result');
}

export function getAdminLoginResponse(
  request: IncomingMessage,
  dependencies: AdminLoginHttpDependencies,
): AdminResponseSpec {
  const result = dependencies.loginService.issueChallenge(client(request));
  switch (result.kind) {
    case 'issued':
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        cookies: serializeAdminCookie({
          name: LOGIN_COOKIE,
          value: result.challenge.challengeToken,
          maxAgeSeconds: LOGIN_COOKIE_SECONDS,
        }),
        body: dependencies.renderLogin({ username: '', csrfToken: result.challenge.csrfToken }),
      };
    case 'rate_limited':
      return unavailable(429, result.retryAfterSeconds);
    case 'capacity':
      return unavailable(503);
    default:
      return assertNever(result);
  }
}

export async function postAdminLoginResponse(
  request: IncomingMessage,
  dependencies: AdminLoginHttpDependencies,
): Promise<AdminResponseSpec> {
  const identity = client(request);
  const fields = await parseUrlEncodedBody({
    contentType: request.headers['content-type'],
    body: request,
    expectedFields: ['username', 'password', 'csrfToken'],
  });
  const result = dependencies.loginService.attempt({
    client: identity,
    username: formField(fields, 'username'),
    password: formField(fields, 'password'),
    challengeToken: parseAdminCookie(request.headers.cookie, LOGIN_COOKIE) ?? '',
    csrfToken: formField(fields, 'csrfToken'),
  });
  switch (result.kind) {
    case 'authenticated':
      dependencies.auditLogger.record({
        event: 'admin.login.succeeded',
        timestamp: dependencies.now().toISOString(),
        username: result.username.slice(0, 128),
      });
      return {
        status: 303,
        location: '/admin',
        cookies: [
          serializeAdminCookie({ name: LOGIN_COOKIE, value: '', maxAgeSeconds: 0 }),
          serializeAdminCookie({
            name: SESSION_COOKIE,
            value: result.session.sessionToken,
            maxAgeSeconds: SESSION_COOKIE_SECONDS,
          }),
        ],
      };
    case 'failed':
      dependencies.auditLogger.record({
        event: 'admin.login.failed',
        timestamp: dependencies.now().toISOString(),
        username: result.username.slice(0, 128),
      });
      return {
        status: 401,
        contentType: 'text/html; charset=utf-8',
        cookies: serializeAdminCookie({
          name: LOGIN_COOKIE,
          value: result.challenge.challengeToken,
          maxAgeSeconds: LOGIN_COOKIE_SECONDS,
        }),
        body: dependencies.renderLogin({
          username: result.username,
          csrfToken: result.challenge.csrfToken,
          error: GENERIC_LOGIN_ERROR,
        }),
      };
    case 'rate_limited':
      return unavailable(429, result.retryAfterSeconds);
    case 'capacity':
      return unavailable(503);
    default:
      return assertNever(result);
  }
}

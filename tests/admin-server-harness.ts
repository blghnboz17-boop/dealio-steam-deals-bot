import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';
import { AdminAuditLogger, type AdminAuditRecord } from '../src/admin/audit-logger.js';
import type { BotAction, BotActionSnapshot } from '../src/admin/bot-controller.js';
import { AdminChallengeStore } from '../src/admin/challenge-store.js';
import { parseAdminClientIdentity } from '../src/admin/client-identity.js';
import type { AdminHealthResult } from '../src/admin/contracts.js';
import { AdminDashboardService } from '../src/admin/dashboard-service.js';
import { AdminLoginService } from '../src/admin/login-service.js';
import { AdminLoginThrottle } from '../src/admin/login-throttle.js';
import { createPasswordVerifier, verifyAdminPassword } from '../src/admin/password.js';
import { parsePublicOrigin } from '../src/admin/security.js';
import { createAdminServer } from '../src/admin/server.js';
import { AdminSessionStore } from '../src/admin/session-store.js';
import { renderDashboardView } from '../src/admin/ui/dashboard-view.js';
import { renderLoginView } from '../src/admin/ui/login-view.js';
import { adminStyles } from '../src/admin/ui/styles.js';

export const PUBLIC_ORIGIN = parsePublicOrigin('https://admin.example.test');
export const USERNAME = 'contract-operator';
export const TEST_PASSWORD = 'fixture-only admin password';
export const FORM_TYPE = 'application/x-www-form-urlencoded';
const PASSWORDS = new Map([
  [USERNAME, createPasswordVerifier(TEST_PASSWORD, () => Buffer.alloc(16, 7))],
]);

export type HttpResponse = {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

export type RequestOptions = {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly rawHeaders?: readonly string[];
  readonly includeDefaultClientIp?: boolean;
  readonly body?: string | Buffer;
};

export function deterministicRandom(): (size: number) => Buffer {
  let sequence = 0;
  return (size) => createHash('sha256')
    .update(String(sequence += 1))
    .digest()
    .subarray(0, size);
}

export function cookie(response: HttpResponse, name: string): string {
  const value = response.headers['set-cookie']?.find((item) => item.startsWith(`${name}=`));
  if (value === undefined) throw new TypeError(`Missing ${name} cookie`);
  const pair = value.split(';', 1)[0];
  if (pair === undefined) throw new TypeError(`Malformed ${name} cookie`);
  return pair;
}

export function csrf(response: HttpResponse): string {
  const token = /name="csrfToken" value="([A-Za-z0-9_-]{43})"/.exec(response.body)?.[1];
  if (token === undefined) throw new TypeError('Missing CSRF field');
  return token;
}

export function failureAlert(response: HttpResponse): string {
  const alert = /<div class="state state--critical" role="alert">[\s\S]*?<\/div>/
    .exec(response.body)?.[0];
  if (alert === undefined) throw new TypeError('Missing generic login alert');
  return alert;
}

export function availableHealth(phase: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'):
AdminHealthResult {
  return {
    status: 'available',
    phase,
    discordReady: phase === 'ready',
    guildCount: phase === 'ready' ? 4 : null,
    startedAt: '2026-08-29T09:00:00.000Z',
    readyAt: phase === 'ready' ? '2026-08-29T09:00:05.000Z' : null,
    heartbeatAt: '2026-08-29T11:59:55.000Z',
  };
}

export class AdminServerHarness {
  public readonly sessions = new AdminSessionStore({
    now: () => 1_000,
    randomBytes: deterministicRandom(),
  });
  public readonly challenges = new AdminChallengeStore({
    now: () => 1_000,
    randomBytes: deterministicRandom(),
  });
  public readonly throttle = new AdminLoginThrottle({ now: () => 1_000, random: () => 0 });
  public readonly verifyPassword = vi.fn((username: string, password: string) =>
    verifyAdminPassword(username, password, PASSWORDS));
  public readonly audit: AdminAuditRecord[] = [];
  public readonly reportLifecycleAuditFailure = vi.fn<() => void>();
  public execute = vi.fn(async (action: BotAction): Promise<BotActionSnapshot> => ({
    action,
    state: 'completed',
    startedAt: '2026-08-29T12:00:00.000Z',
    completedAt: '2026-08-29T12:00:01.000Z',
    outcome: 'succeeded',
  }));
  public lifecycle: BotActionSnapshot = { state: 'idle' };
  public health: AdminHealthResult = { status: 'unavailable', reason: 'stale' };
  public throwLifecycleAudit = false;
  private readonly server: Server;
  private port = 0;

  public constructor() {
    const loginService = new AdminLoginService({
      challenges: this.challenges,
      sessions: this.sessions,
      throttle: this.throttle,
      verifyPassword: this.verifyPassword,
    });
    const dashboardService = new AdminDashboardService(
      { readSnapshot: () => this.health },
      { readSnapshot: () => ({ status: 'unavailable', reason: 'database' }) },
      { now: () => new Date('2026-08-29T12:00:00.000Z') },
    );
    this.server = createAdminServer({
      publicOrigin: PUBLIC_ORIGIN,
      loginService,
      sessionStore: this.sessions,
      dashboardService,
      botController: {
        snapshot: () => this.lifecycle,
        execute: (action) => this.execute(action),
      },
      auditLogger: new AdminAuditLogger((record) => {
        if (this.throwLifecycleAudit && record.event === 'admin.bot.action') {
          throw new TypeError('sensitive audit sink failure');
        }
        this.audit.push(record);
      }),
      renderers: { login: renderLoginView, dashboard: renderDashboardView, styles: adminStyles },
      now: () => new Date('2026-08-29T12:00:00.000Z'),
      reportLifecycleAuditFailure: this.reportLifecycleAuditFailure,
    });
  }

  public async start(): Promise<void> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new TypeError('Expected TCP listener');
    this.port = (address satisfies AddressInfo).port;
  }

  public async stop(): Promise<void> {
    this.server.close();
    await once(this.server, 'close');
  }

  public async send(path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const method = options.method ?? 'GET';
    const configuredHeaders = options.headers ?? {};
    const configuredNames = new Set(Object.keys(configuredHeaders).map((name) => name.toLowerCase()));
    const rawHeaders: string[] = [];
    if (!configuredNames.has('host')) rawHeaders.push('Host', PUBLIC_ORIGIN.host);
    if (method === 'POST' && !configuredNames.has('origin')) {
      rawHeaders.push('Origin', PUBLIC_ORIGIN.origin);
    }
    if (path === '/admin/login' && options.includeDefaultClientIp !== false) {
      rawHeaders.push('X-Dealio-Client-IP', '192.0.2.10');
    }
    for (const [name, value] of Object.entries(configuredHeaders)) rawHeaders.push(name, value);
    rawHeaders.push(...(options.rawHeaders ?? []));
    if (options.body !== undefined) {
      rawHeaders.push('Content-Length', String(Buffer.byteLength(options.body)));
    }
    return new Promise((resolve, reject) => {
      const outgoing = request({
        host: '127.0.0.1', port: this.port, path, method, headers: rawHeaders,
      }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.once('end', () => resolve({
          status: incoming.statusCode ?? 0,
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      outgoing.once('error', reject);
      if (options.body !== undefined) outgoing.write(options.body);
      outgoing.end();
    });
  }

  public async challenge(options: RequestOptions = {}): Promise<{
    readonly cookie: string;
    readonly csrf: string;
  }> {
    const response = await this.send('/admin/login', options);
    return { cookie: cookie(response, '__Host-dealio_login'), csrf: csrf(response) };
  }

  public async authenticate(): Promise<string> {
    const login = await this.challenge();
    const body = new URLSearchParams({
      username: USERNAME, password: TEST_PASSWORD, csrfToken: login.csrf,
    }).toString();
    const response = await this.send('/admin/login', {
      method: 'POST',
      headers: { Cookie: login.cookie, 'Content-Type': FORM_TYPE },
      body,
    });
    if (response.status !== 303) throw new TypeError('Authentication fixture failed');
    return cookie(response, '__Host-dealio_admin');
  }

  public client(address: string) {
    return parseAdminClientIdentity({
      peerAddress: '127.0.0.1',
      rawHeaders: ['X-Dealio-Client-IP', address],
    });
  }
}

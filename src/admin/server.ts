import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AdminAuditBotOutcome, AdminAuditLogger } from './audit-logger.js';
import { InvalidBotActionError, parseBotAction, type BotAction } from './bot-controller.js';
import { AdminClientIdentityError } from './client-identity.js';
import type { AdminDashboardService } from './dashboard-service.js';
import { startLifecycleExecution, type AdminLifecycleController } from './lifecycle-execution.js';
import { getLifecyclePolicy } from './lifecycle-policy.js';
import { getAdminLoginResponse, postAdminLoginResponse, type AdminResponseSpec } from './login-http.js';
import type { AdminLoginService } from './login-service.js';
import { ADMIN_SECURITY_HEADERS, FormBodyError, RequestValidationError, parseAdminCookie, parseUrlEncodedBody, serializeAdminCookie, validateRequestAuthority, type PublicOrigin } from './security.js';
import { AdminSessionCapacityError, type AdminAuthenticatedView, type AdminSessionStore } from './session-store.js';
import type { DashboardViewModel } from './ui/dashboard-view.js';
import type { LoginViewModel } from './ui/login-view.js';

const SESSION_COOKIE = '__Host-dealio_admin';

type AdminRenderers = { readonly login: (model: LoginViewModel) => string; readonly dashboard: (model: DashboardViewModel) => string; readonly styles: string };

export type AdminServerDependencies = {
  readonly publicOrigin: PublicOrigin;
  readonly loginService: AdminLoginService;
  readonly sessionStore: AdminSessionStore;
  readonly dashboardService: AdminDashboardService;
  readonly botController: AdminLifecycleController;
  readonly auditLogger: AdminAuditLogger;
  readonly renderers: AdminRenderers;
  readonly now: () => Date;
  readonly reportLifecycleAuditFailure: () => void;
};

type AuthenticatedRequest = { readonly sessionToken: string; readonly view: AdminAuthenticatedView };
type RequestContext = { readonly request: IncomingMessage; readonly response: ServerResponse };
type ActionAudit = { readonly username: string; readonly action: BotAction; readonly outcome: AdminAuditBotOutcome; readonly durationMs: number };

function respond(response: ServerResponse, spec: AdminResponseSpec): void {
  response.statusCode = spec.status;
  if (spec.contentType !== undefined) response.setHeader('Content-Type', spec.contentType);
  if (spec.cookies !== undefined) response.setHeader('Set-Cookie', spec.cookies);
  if (spec.location !== undefined) response.setHeader('Location', spec.location);
  if (spec.allow !== undefined) response.setHeader('Allow', spec.allow);
  if (spec.retryAfter !== undefined) response.setHeader('Retry-After', String(spec.retryAfter));
  response.end(spec.body ?? '');
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function formField(fields: ReadonlyMap<string, string>, name: string): string {
  const value = fields.get(name);
  if (value === undefined) throw new FormBodyError(400);
  return value;
}

class AdminHttpHandler {
  public constructor(private readonly dependencies: AdminServerDependencies) {}

  public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    try {
      const method = request.method ?? '';
      validateRequestAuthority(requestHeaders(request), this.dependencies.publicOrigin, method);
      await this.route(request.url?.split('?', 1)[0] ?? '', method, { request, response });
    } catch (error: unknown) {
      request.resume();
      if (error instanceof FormBodyError) {
        respond(response, { status: error.status, body: 'Geçersiz istek.' });
      } else if (error instanceof RequestValidationError || error instanceof InvalidBotActionError || error instanceof AdminClientIdentityError) {
        respond(response, { status: 400, body: 'Geçersiz istek.' });
      } else if (error instanceof AdminSessionCapacityError) {
        respond(response, { status: 503, body: 'Hizmet geçici olarak kullanılamıyor.' });
      } else {
        respond(response, { status: 500, body: 'Sunucu isteği tamamlayamadı.' });
      }
    }
  }

  private async route(path: string, method: string, context: RequestContext): Promise<void> {
    const { request, response } = context;
    if (path === '/admin/login') {
      if (method === 'GET') {
        request.resume();
        respond(response, getAdminLoginResponse(request, this.loginDependencies()));
        return;
      }
      if (method === 'POST') return this.postLogin(request, response);
      return this.methodNotAllowed(request, response, 'GET, POST');
    }
    if (path === '/admin') {
      if (method === 'GET') return this.getDashboard(request, response);
      return this.methodNotAllowed(request, response, 'GET');
    }
    if (path === '/admin/logout') {
      if (method === 'POST') return this.postLogout(request, response);
      return this.methodNotAllowed(request, response, 'POST');
    }
    if (path === '/admin/bot-action') {
      if (method === 'POST') return this.postBotAction(request, response);
      return this.methodNotAllowed(request, response, 'POST');
    }
    if (path === '/admin/styles.css') {
      if (method === 'GET') {
        request.resume();
        respond(response, { status: 200, contentType: 'text/css; charset=utf-8', body: this.dependencies.renderers.styles });
        return;
      }
      return this.methodNotAllowed(request, response, 'GET');
    }
    request.resume();
    respond(response, { status: 404, body: 'Bulunamadı.' });
  }

  private async postLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    respond(response, await postAdminLoginResponse(request, this.loginDependencies()));
  }

  private getDashboard(request: IncomingMessage, response: ServerResponse): void {
    request.resume();
    const authenticated = this.authenticate(request);
    if (authenticated === null) return respond(response, { status: 303, location: '/admin/login' });
    respond(response, {
      status: 200, contentType: 'text/html; charset=utf-8',
      body: this.dependencies.renderers.dashboard({
        username: authenticated.view.username,
        csrfToken: authenticated.view.csrfToken,
        dashboard: this.dependencies.dashboardService.getSnapshot(),
        lifecycle: this.dependencies.botController.snapshot(),
      }),
    });
  }

  private async postLogout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authenticated = this.authenticate(request);
    if (authenticated === null) {
      request.resume();
      respond(response, { status: 303, location: '/admin/login' });
      return;
    }
    const fields = await parseUrlEncodedBody({ contentType: request.headers['content-type'], body: request, expectedFields: ['csrfToken'] });
    if (!this.dependencies.sessionStore.verifyCsrf(authenticated.sessionToken, formField(fields, 'csrfToken'))) {
      respond(response, { status: 403, body: 'İstek doğrulanamadı.' });
      return;
    }
    this.dependencies.sessionStore.revokeSession(authenticated.sessionToken);
    this.dependencies.auditLogger.record({ event: 'admin.logout', timestamp: this.dependencies.now().toISOString(), username: authenticated.view.username.slice(0, 128) });
    respond(response, {
      status: 303, location: '/admin/login',
      cookies: serializeAdminCookie({ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0 }),
    });
  }

  private async postBotAction(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authenticated = this.authenticate(request);
    if (authenticated === null) {
      request.resume();
      respond(response, { status: 303, location: '/admin/login' });
      return;
    }
    const fields = await parseUrlEncodedBody({ contentType: request.headers['content-type'], body: request, expectedFields: ['action', 'csrfToken'] });
    if (!this.dependencies.sessionStore.verifyCsrf(authenticated.sessionToken, formField(fields, 'csrfToken'))) {
      respond(response, { status: 403, body: 'İstek doğrulanamadı.' });
      return;
    }
    const action = parseBotAction(formField(fields, 'action'));
    const health = this.dependencies.dashboardService.readHealthSnapshot();
    const lifecycle = this.dependencies.botController.snapshot();
    const policy = getLifecyclePolicy(health, lifecycle);
    if (!policy.enabledActions.includes(action)) {
      respond(response, { status: 409, body: 'İşlem şu anda kullanılamıyor.' });
      return;
    }
    startLifecycleExecution(this.dependencies.botController, action, {
      onSettled: (result) => {
        this.auditAction({ username: authenticated.view.username, ...result });
      },
      onInternalFailure: this.dependencies.reportLifecycleAuditFailure,
    });
    respond(response, { status: 303, location: '/admin' });
  }

  private authenticate(request: IncomingMessage): AuthenticatedRequest | null {
    const sessionToken = parseAdminCookie(request.headers.cookie, SESSION_COOKIE);
    if (sessionToken === null) return null;
    const view = this.dependencies.sessionStore.resolveAuthenticatedView(sessionToken);
    return view === null ? null : { sessionToken, view };
  }

  private auditAction(details: ActionAudit): void {
    this.dependencies.auditLogger.record({
      event: 'admin.bot.action', timestamp: this.dependencies.now().toISOString(), username: details.username.slice(0, 128),
      action: details.action, outcome: details.outcome, durationMs: details.durationMs,
    });
  }

  private loginDependencies() {
    return {
      loginService: this.dependencies.loginService,
      auditLogger: this.dependencies.auditLogger,
      renderLogin: this.dependencies.renderers.login,
      now: this.dependencies.now,
    };
  }

  private methodNotAllowed(request: IncomingMessage, response: ServerResponse, allow: string): void {
    request.resume();
    respond(response, { status: 405, allow, body: 'Yönteme izin verilmiyor.' });
  }
}

export function createAdminServer(dependencies: AdminServerDependencies): Server {
  const handler = new AdminHttpHandler(dependencies);
  return createServer((request, response) => {
    void handler.handle(request, response);
  });
}

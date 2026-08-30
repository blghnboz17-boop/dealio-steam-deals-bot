import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotAction, BotActionSnapshot } from '../src/admin/bot-controller.js';
import type { AdminHealthResult } from '../src/admin/contracts.js';
import {
  AdminServerHarness,
  FORM_TYPE,
  availableHealth,
  csrf,
} from './admin-server-harness.js';

describe('admin lifecycle HTTP contract', () => {
  let harness: AdminServerHarness;
  let sessionCookie: string;

  beforeEach(async () => {
    harness = new AdminServerHarness();
    await harness.start();
    sessionCookie = await harness.authenticate();
  });

  afterEach(async () => {
    await harness.stop();
  });

  async function dashboardCsrf(): Promise<string> {
    return csrf(await harness.send('/admin', { headers: { Cookie: sessionCookie } }));
  }

  async function action(actionName: string, token: string) {
    return harness.send('/admin/bot-action', {
      method: 'POST',
      headers: { Cookie: sessionCookie, 'Content-Type': FORM_TYPE },
      body: new URLSearchParams({ action: actionName, csrfToken: token }).toString(),
    });
  }

  it('rejects logout without session CSRF and revokes after valid logout', async () => {
    // Given
    const token = await dashboardCsrf();
    const headers = { Cookie: sessionCookie, 'Content-Type': FORM_TYPE };

    // When
    const rejected = await harness.send('/admin/logout', {
      method: 'POST', headers, body: 'csrfToken=invalid',
    });
    const accepted = await harness.send('/admin/logout', {
      method: 'POST', headers, body: new URLSearchParams({ csrfToken: token }).toString(),
    });
    const afterLogout = await harness.send('/admin', { headers: { Cookie: sessionCookie } });

    // Then
    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(303);
    expect(accepted.headers.location).toBe('/admin/login');
    expect(accepted.headers['set-cookie']?.join(';')).toContain(
      '__Host-dealio_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    );
    expect(afterLogout.headers.location).toBe('/admin/login');
    expect(harness.audit.at(-1)?.event).toBe('admin.logout');
  });

  it('allows only a CSRF-authorized parsed lifecycle action and audits allowlisted output', async () => {
    // Given
    harness.health = availableHealth('ready');
    const token = await dashboardCsrf();

    // When
    const badCsrf = await action('restart', 'invalid');
    const badAction = await action('shell', token);
    const accepted = await action('restart', token);

    // Then
    expect([badCsrf.status, badAction.status, accepted.status]).toEqual([403, 400, 303]);
    expect(harness.execute).toHaveBeenCalledOnce();
    expect(harness.execute).toHaveBeenCalledWith('restart');
    await vi.waitFor(() => expect(
      harness.audit.filter((record) => record.event === 'admin.bot.action'),
    ).toHaveLength(1));
    expect(harness.audit.at(-1)).toEqual({
      event: 'admin.bot.action',
      timestamp: '2026-08-29T12:00:00.000Z',
      username: 'contract-operator',
      action: 'restart',
      outcome: 'succeeded',
      durationMs: 1_000,
    });
    expect(JSON.stringify(harness.audit)).not.toMatch(
      /password|cookie|token|stderr|stdout|stack|\\private/i,
    );
  });

  it.each<readonly [string, AdminHealthResult, BotAction, number]>([
    ['stale permits start', { status: 'unavailable', reason: 'stale' }, 'start', 303],
    ['unavailable permits start', { status: 'unavailable', reason: 'unavailable' }, 'start', 303],
    ['malformed rejects start', { status: 'unavailable', reason: 'malformed' }, 'start', 409],
    ['future rejects start', { status: 'unavailable', reason: 'future' }, 'start', 409],
    ['ready permits restart', availableHealth('ready'), 'restart', 303],
    ['ready permits stop', availableHealth('ready'), 'stop', 303],
    ['ready rejects start', availableHealth('ready'), 'start', 409],
    ['starting permits stop', availableHealth('starting'), 'stop', 303],
    ['stopped permits start', availableHealth('stopped'), 'start', 303],
    ['failed permits start', availableHealth('failed'), 'start', 303],
    ['stopping rejects start', availableHealth('stopping'), 'start', 409],
  ])('enforces fresh shared policy when %s', async (_case, health, requested, expectedStatus) => {
    // Given
    harness.health = health;
    const token = await dashboardCsrf();
    harness.execute.mockClear();
    const auditBefore = harness.audit.length;

    // When
    const response = await action(requested, token);

    // Then
    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 303) {
      expect(harness.execute).toHaveBeenCalledOnce();
    } else {
      expect(response.body).toBe('İşlem şu anda kullanılamıyor.');
      expect(harness.execute).not.toHaveBeenCalled();
      expect(harness.audit).toHaveLength(auditBefore);
    }
  });

  it('rereads health on POST instead of trusting a stale dashboard view', async () => {
    // Given
    harness.health = { status: 'unavailable', reason: 'stale' };
    const token = await dashboardCsrf();
    harness.health = { status: 'unavailable', reason: 'malformed' };
    harness.execute.mockClear();
    const auditBefore = harness.audit.length;

    // When
    const response = await action('start', token);

    // Then
    expect(response.status).toBe(409);
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.audit).toHaveLength(auditBefore);
  });

  it('rejects every action while the controller is running without side effects', async () => {
    // Given
    harness.health = { status: 'unavailable', reason: 'stale' };
    harness.lifecycle = {
      action: 'start', state: 'running', startedAt: '2026-08-29T12:00:00.000Z',
    };
    const token = await dashboardCsrf();
    harness.execute.mockClear();
    const auditBefore = harness.audit.length;

    // When
    const response = await action('start', token);

    // Then
    expect(response.status).toBe(409);
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.audit).toHaveLength(auditBefore);
  });

  it('redirects immediately, exposes busy controls, and audits completion once', async () => {
    // Given
    harness.health = availableHealth('ready');
    const token = await dashboardCsrf();
    let complete = (_snapshot: BotActionSnapshot): void => {
      throw new TypeError('Deferred controller not initialized');
    };
    const completion = new Promise<BotActionSnapshot>((resolve) => {
      complete = resolve;
    });
    harness.execute = vi.fn((requested: BotAction) => {
      harness.lifecycle = {
        action: requested, state: 'running', startedAt: '2026-08-29T12:00:00.000Z',
      };
      return completion;
    });

    // When
    const accepted = await action('restart', token);
    const running = await harness.send('/admin', { headers: { Cookie: sessionCookie } });
    const conflict = await action('restart', token);

    // Then
    expect(accepted.status).toBe(303);
    expect(running.body).toContain('aria-busy="true"');
    expect(running.body).toContain(' disabled');
    expect(conflict.status).toBe(409);
    expect(harness.execute).toHaveBeenCalledOnce();
    complete({
      action: 'restart', state: 'completed',
      startedAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:02.000Z', outcome: 'failed',
    });
    await vi.waitFor(() => expect(
      harness.audit.filter((record) => record.event === 'admin.bot.action'),
    ).toHaveLength(1));
  });

  it('keeps the immediate redirect when lifecycle audit storage fails', async () => {
    // Given
    harness.health = availableHealth('stopped');
    harness.throwLifecycleAudit = true;
    const token = await dashboardCsrf();

    // When
    const response = await action('start', token);

    // Then
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/admin');
    await vi.waitFor(() => expect(harness.reportLifecycleAuditFailure).toHaveBeenCalledOnce());
    expect(harness.execute).toHaveBeenCalledOnce();
    expect(harness.audit.filter((record) => record.event === 'admin.bot.action')).toEqual([]);
  });
});

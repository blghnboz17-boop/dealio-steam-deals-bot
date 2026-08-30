import { describe, expect, it } from 'vitest';
import type {
  AdminDashboardSnapshot,
  AdminHealthResult,
  AdminTelemetryResult,
} from '../src/admin/contracts.js';
import type { BotAction, BotActionSnapshot } from '../src/admin/bot-controller.js';
import { renderDashboardView } from '../src/admin/ui/dashboard-view.js';
import { renderLoginView } from '../src/admin/ui/login-view.js';
import { adminStyles } from '../src/admin/ui/styles.js';

const telemetry: AdminTelemetryResult = {
  status: 'available',
  users: { configured: 12, enabled: 9, disabled: 3, dmBlocked: 1 },
  checks: {
    statuses: { never: 1, pending: 2, success: 7, unavailable: 1, failed: 1 },
    latestCompletedAt: '2026-08-29T11:00:00.000Z',
    nextScheduledAt: '2026-08-29T17:00:00.000Z',
  },
  notifications: {
    statuses: { candidate: 2, sending: 1, sent: 24, failed: 1, terminalFailed: 1, expired: 3 },
    latestCreatedAt: '2026-08-29T10:00:00.000Z',
    latestAttemptAt: '2026-08-29T10:10:00.000Z',
  },
  batches: {
    statuses: { sending: 1, sent: 8, failed: 1, terminalFailed: 0, expired: 2 },
    latestCreatedAt: '2026-08-29T10:00:00.000Z',
    latestAttemptAt: '2026-08-29T10:10:00.000Z',
  },
};

const dashboard: AdminDashboardSnapshot = {
  status: 'degraded',
  generatedAt: '2026-08-29T12:00:00.000Z',
  health: {
    status: 'available',
    phase: 'ready',
    discordReady: true,
    guildCount: 4,
    startedAt: '2026-08-29T09:00:00.000Z',
    readyAt: '2026-08-29T09:00:05.000Z',
    heartbeatAt: '2026-08-29T11:59:55.000Z',
  },
  telemetry,
  incidents: [
    { code: 'notification_terminal_failures', severity: 'critical', count: 1 },
    { code: 'dm_blocked_users', severity: 'warning', count: 1 },
  ],
};

const idle: BotActionSnapshot = { state: 'idle' };

function actionButtonAttributes(html: string, action: BotAction): string {
  const match = new RegExp(`name="action" value="${action}"><button type="submit" ([^>]*)>`).exec(html);
  return match?.[1] ?? '';
}

describe('Dealio admin login view', () => {
  it('renders a Turkish semantic login form with escaped values and CSRF protection', () => {
    const html = renderLoginView({
      username: `operatör"><script>raw-secret</script>`,
      csrfToken: `csrf"><img src=x onerror=alert(1)>`,
      error: `Giriş başarısız <raw-error>`,
    });

    expect(html).toContain('<html lang="tr">');
    expect(html).toContain('<main');
    expect(html).toContain('<form method="post" action="/admin/login"');
    expect(html).toContain('name="csrfToken"');
    expect(html).toContain('Kullanıcı adı');
    expect(html).toContain('Parola');
    expect(html).toContain('role="alert"');
    expect(html).toContain('<span class="title-keep">merkezine giriş</span>');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('&lt;script&gt;raw-secret&lt;/script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<raw-error>');
  });
});

describe('Dealio admin dashboard view', () => {
  it.each<readonly [string, AdminHealthResult, string]>([
    [
      'positive count',
      { ...dashboard.health, status: 'available', guildCount: 4 },
      '<li class="status status--info"><span>Aktif sunucu</span><strong>4</strong></li>',
    ],
    [
      'zero count',
      { ...dashboard.health, status: 'available', guildCount: 0 },
      '<li class="status status--info"><span>Aktif sunucu</span><strong>0</strong></li>',
    ],
    [
      'legacy null count',
      { ...dashboard.health, status: 'available', guildCount: null },
      '<li class="status status--critical"><span>Aktif sunucu</span><strong>Kullanılamıyor</strong></li>',
    ],
    [
      'unavailable health',
      { status: 'unavailable', reason: 'stale' },
      '<li class="status status--critical"><span>Aktif sunucu</span><strong>Kullanılamıyor</strong></li>',
    ],
  ])('renders Aktif sunucu for %s', (_case, health, expected) => {
    const html = renderDashboardView({
      username: 'operatör',
      csrfToken: 'csrf-token',
      dashboard: { ...dashboard, health },
      lifecycle: idle,
    });

    expect(html).toContain(expected);
  });

  it('renders landmarks, status, lifecycle controls, metrics, incidents, and safe Turkish labels', () => {
    const html = renderDashboardView({
      username: 'operatör',
      csrfToken: 'csrf-token',
      dashboard,
      lifecycle: idle,
    });

    expect(html).toContain('<header');
    expect(html).toContain('<nav aria-label="Ana menü"');
    expect(html).toContain('<main id="ana-icerik"');
    expect(html).toContain('<footer');
    expect(html).toContain('Sistem durumu');
    expect(html).toContain('Yaşam döngüsü');
    expect(html).toContain('Kullanıcılar');
    expect(html).toContain('Bildirimler');
    expect(html).toContain('<table');
    expect(html).toContain('<caption>Aktif olaylar</caption>');
    expect(html).toContain('Kalıcı bildirim hatası');
    expect(html).toContain('DM erişimi engelli kullanıcı');
    expect(html.match(/name="csrfToken"/g)).toHaveLength(4);
    expect(html).not.toMatch(/batch_terminal_failures|notification_terminal_failures|dm_blocked_users/);
    expect(html).not.toMatch(/discordUserId|steamId|raw|stderr|stack trace/i);
    expect(html).not.toMatch(/<style|<script|style=/i);
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it.each<readonly [string, AdminHealthResult, BotActionSnapshot, readonly BotAction[], BotAction | null]>([
    ['health source unavailable', { status: 'unavailable', reason: 'unavailable' }, idle, ['start'], 'start'],
    ['health stale', { status: 'unavailable', reason: 'stale' }, idle, ['start'], 'start'],
    ['health malformed', { status: 'unavailable', reason: 'malformed' }, idle, [], null],
    ['health oversized', { status: 'unavailable', reason: 'oversized' }, idle, [], null],
    ['health unsupported', { status: 'unavailable', reason: 'unsupported' }, idle, [], null],
    ['health future', { status: 'unavailable', reason: 'future' }, idle, [], null],
    ['stopped', { ...dashboard.health, status: 'available', phase: 'stopped' }, idle, ['start'], 'start'],
    ['failed', { ...dashboard.health, status: 'available', phase: 'failed' }, idle, ['start'], 'start'],
    ['ready', { ...dashboard.health, status: 'available', phase: 'ready' }, idle, ['restart', 'stop'], 'restart'],
    ['starting', { ...dashboard.health, status: 'available', phase: 'starting' }, idle, ['stop'], null],
    ['stopping', { ...dashboard.health, status: 'available', phase: 'stopping' }, idle, [], null],
    ['controller running', dashboard.health, { action: 'restart', state: 'running', startedAt: dashboard.generatedAt }, [], null],
  ])('renders safe lifecycle controls when %s', (_case, health, lifecycle, enabled, emphasized) => {
    const html = renderDashboardView({ username: 'operatör', csrfToken: 'csrf-token', dashboard: { ...dashboard, health }, lifecycle });

    for (const action of ['start', 'restart', 'stop'] as const) {
      const attributes = actionButtonAttributes(html, action);
      expect(attributes).not.toBe('');
      expect(attributes.includes(' disabled')).toBe(!enabled.includes(action));
      expect(attributes.includes(' aria-busy="true"')).toBe(lifecycle.state === 'running');
      expect(attributes.includes('button--accent')).toBe(action === emphasized);
    }
  });

  it('renders running and completed lifecycle action banners without process output', () => {
    const running = renderDashboardView({
      username: 'operatör',
      csrfToken: 'csrf-token',
      dashboard,
      lifecycle: { action: 'restart', state: 'running', startedAt: '2026-08-29T12:01:00.000Z' },
    });
    const completed = renderDashboardView({
      username: 'operatör',
      csrfToken: 'csrf-token',
      dashboard,
      lifecycle: {
        action: 'stop',
        state: 'completed',
        startedAt: '2026-08-29T12:01:00.000Z',
        completedAt: '2026-08-29T12:01:05.000Z',
        outcome: 'failed',
      },
    });

    expect(running).toContain('role="status"');
    expect(running).toContain('aria-busy="true"');
    expect(running).toContain('Yeniden başlatma sürüyor');
    expect(running).toContain('<meta http-equiv="refresh" content="2;url=/admin">');
    expect(completed).toContain('İşlem tamamlanamadı');
    expect(completed).not.toContain('http-equiv="refresh"');
    expect(completed).not.toMatch(/stdout|stderr|powershell|exit code/i);
  });

  it('renders explicit empty and unavailable states instead of false healthy zeroes', () => {
    const empty = renderDashboardView({
      username: 'operatör',
      csrfToken: 'csrf-token',
      dashboard: { ...dashboard, status: 'healthy', incidents: [] },
      lifecycle: idle,
    });
    const unavailable = renderDashboardView({
      username: 'operatör',
      csrfToken: 'csrf-token',
      dashboard: {
        status: 'unavailable',
        generatedAt: dashboard.generatedAt,
        health: { status: 'unavailable', reason: 'stale' },
        telemetry: { status: 'unavailable', reason: 'database' },
        incidents: [
          { code: 'health_source_unavailable', severity: 'critical' },
          { code: 'telemetry_source_unavailable', severity: 'critical' },
        ],
      },
      lifecycle: idle,
    });

    expect(empty).toContain('Aktif olay yok');
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).toContain('Sağlık verisi kullanılamıyor');
    expect(unavailable).toContain('Telemetri kullanılamıyor');
    expect(unavailable).not.toContain('>0<');
    expect(unavailable).not.toMatch(/stale|database/);
  });
});

describe('Dealio admin stylesheet', () => {
  it('gives buttons a specificity-matched zero-duration reduced-motion override', () => {
    const reducedMotion = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(adminStyles)?.[1] ?? '';

    expect(reducedMotion).toMatch(/\.button\s*\{[^}]*transition-duration:\s*0s;/);
    expect(reducedMotion).not.toContain('!important');
  });

  it('is token-driven and contains responsive, focus, target, scroll, and reduced-motion contracts', () => {
    expect(adminStyles).toContain(':root');
    expect(adminStyles).toContain('min-block-size: 44px');
    expect(adminStyles).toContain(':focus-visible');
    expect(adminStyles).toContain('overflow-y: auto');
    expect(adminStyles).toContain('@media (max-width: 767px)');
    expect(adminStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(adminStyles).toContain('.button { transition-duration: 0s; }');
    expect(adminStyles).toContain('--color-border-strong: #7c6487;');
    expect(adminStyles).toContain('.title-keep { white-space: nowrap; }');
    expect(adminStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(adminStyles).not.toContain('overflow-x: auto');
    const componentRules = adminStyles.replace(/:root\s*\{[\s\S]*?\}/, '');
    expect(componentRules).not.toMatch(/url\(|@import|#[0-9a-f]{3,8}\b/i);
  });
});

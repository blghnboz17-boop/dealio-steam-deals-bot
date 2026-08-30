import { describe, expect, it, vi } from 'vitest';
import type { AdminHealthResult, AdminTelemetryResult } from '../src/admin/contracts.js';
import { AdminDashboardService } from '../src/admin/dashboard-service.js';

const healthy: AdminHealthResult = {
  status: 'available',
  phase: 'ready',
  discordReady: true,
  guildCount: 4,
  startedAt: '2026-08-29T09:00:00.000Z',
  readyAt: '2026-08-29T09:00:05.000Z',
  heartbeatAt: '2026-08-29T11:59:55.000Z',
};

const telemetry: AdminTelemetryResult = {
  status: 'available',
  users: { configured: 3, enabled: 2, disabled: 1, dmBlocked: 1 },
  checks: {
    statuses: { never: 0, pending: 0, success: 1, unavailable: 1, failed: 1 },
    latestCompletedAt: '2026-08-29T11:00:00.000Z',
    nextScheduledAt: '2026-08-29T17:00:00.000Z',
  },
  notifications: {
    statuses: { candidate: 1, sending: 0, sent: 8, failed: 2, terminalFailed: 1, expired: 0 },
    latestCreatedAt: '2026-08-29T10:00:00.000Z',
    latestAttemptAt: '2026-08-29T10:10:00.000Z',
  },
  batches: {
    statuses: { sending: 0, sent: 3, failed: 1, terminalFailed: 1, expired: 0 },
    latestCreatedAt: '2026-08-29T10:00:00.000Z',
    latestAttemptAt: '2026-08-29T10:10:00.000Z',
  },
};

describe('AdminDashboardService', () => {
  it('composes sanitized incidents in deterministic severity and code order', () => {
    const service = new AdminDashboardService(
      { readSnapshot: () => healthy },
      { readSnapshot: () => telemetry },
      { now: () => new Date('2026-08-29T12:00:00.000Z') },
    );

    const dashboard = service.getSnapshot();

    expect(dashboard.status).toBe('degraded');
    expect(dashboard.incidents).toEqual([
      { code: 'batch_terminal_failures', severity: 'critical', count: 1 },
      { code: 'notification_terminal_failures', severity: 'critical', count: 1 },
      { code: 'batch_retries', severity: 'warning', count: 1 },
      { code: 'check_failures', severity: 'warning', count: 1 },
      { code: 'check_unavailable', severity: 'warning', count: 1 },
      { code: 'dm_blocked_users', severity: 'warning', count: 1 },
      { code: 'notification_retries', severity: 'warning', count: 2 },
    ]);
    expect(JSON.stringify(dashboard)).not.toContain('raw');
  });

  it('keeps stale health and unavailable telemetry explicit instead of healthy zeroes', () => {
    const service = new AdminDashboardService(
      { readSnapshot: () => ({ status: 'unavailable', reason: 'stale' }) },
      { readSnapshot: () => ({ status: 'unavailable', reason: 'database' }) },
      { now: () => new Date('2026-08-29T12:00:00.000Z') },
    );

    expect(service.getSnapshot()).toEqual({
      status: 'unavailable',
      generatedAt: '2026-08-29T12:00:00.000Z',
      health: { status: 'unavailable', reason: 'stale' },
      telemetry: { status: 'unavailable', reason: 'database' },
      incidents: [
        { code: 'health_source_unavailable', severity: 'critical' },
        { code: 'telemetry_source_unavailable', severity: 'critical' },
      ],
    });
  });

  it('marks a ready bot with clean aggregates healthy', () => {
    const cleanTelemetry: AdminTelemetryResult = {
      ...telemetry,
      users: { configured: 3, enabled: 3, disabled: 0, dmBlocked: 0 },
      checks: { ...telemetry.checks, statuses: { never: 0, pending: 0, success: 3, unavailable: 0, failed: 0 } },
      notifications: { ...telemetry.notifications, statuses: { candidate: 0, sending: 0, sent: 8, failed: 0, terminalFailed: 0, expired: 0 } },
      batches: { ...telemetry.batches, statuses: { sending: 0, sent: 3, failed: 0, terminalFailed: 0, expired: 0 } },
    };
    const service = new AdminDashboardService(
      { readSnapshot: () => healthy },
      { readSnapshot: () => cleanTelemetry },
    );

    const dashboard = service.getSnapshot();

    expect(dashboard.status).toBe('healthy');
    expect(dashboard.incidents).toEqual([]);
  });

  it('routes dashboard composition through a reusable fresh health read', () => {
    // Given a dashboard service with an observable health policy seam.
    const service = new AdminDashboardService(
      { readSnapshot: () => healthy },
      { readSnapshot: () => telemetry },
    );
    const readHealthSnapshot = vi.spyOn(service, 'readHealthSnapshot');

    // When a dashboard snapshot is composed.
    const dashboard = service.getSnapshot();

    // Then composition obtains health through the reusable read.
    expect(readHealthSnapshot).toHaveBeenCalledOnce();
    expect(dashboard.health).toEqual(healthy);
  });
});

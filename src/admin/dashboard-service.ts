import type {
  AdminDashboardSnapshot,
  AdminHealthResult,
  AdminHealthSource,
  AdminIncident,
  AdminTelemetrySource,
  IncidentCode,
  IncidentSeverity,
} from './contracts.js';

type DashboardOptions = {
  readonly now?: () => Date;
};

const severityRank: Readonly<Record<IncidentSeverity, number>> = {
  critical: 0,
  warning: 1,
};

function incident(code: IncidentCode, severity: IncidentSeverity, count?: number): AdminIncident {
  return count === undefined ? { code, severity } : { code, severity, count };
}

export class AdminDashboardService {
  private readonly now: () => Date;

  public constructor(
    private readonly healthSource: AdminHealthSource,
    private readonly telemetrySource: AdminTelemetrySource,
    options: DashboardOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public getSnapshot(): AdminDashboardSnapshot {
    const health = this.readHealthSnapshot();
    const telemetry = this.telemetrySource.readSnapshot();
    const incidents: AdminIncident[] = [];

    if (health.status === 'unavailable') {
      incidents.push(incident('health_source_unavailable', 'critical'));
    } else if (health.phase !== 'ready') {
      incidents.push(incident('bot_not_ready', 'critical'));
    } else if (!health.discordReady) {
      incidents.push(incident('discord_disconnected', 'critical'));
    }

    if (telemetry.status === 'unavailable') {
      incidents.push(incident('telemetry_source_unavailable', 'critical'));
    } else {
      const { users, checks, notifications, batches } = telemetry;
      if (batches.statuses.terminalFailed > 0) {
        incidents.push(incident('batch_terminal_failures', 'critical', batches.statuses.terminalFailed));
      }
      if (notifications.statuses.terminalFailed > 0) {
        incidents.push(incident(
          'notification_terminal_failures',
          'critical',
          notifications.statuses.terminalFailed,
        ));
      }
      if (batches.statuses.failed > 0) {
        incidents.push(incident('batch_retries', 'warning', batches.statuses.failed));
      }
      if (checks.statuses.failed > 0) {
        incidents.push(incident('check_failures', 'warning', checks.statuses.failed));
      }
      if (checks.statuses.unavailable > 0) {
        incidents.push(incident('check_unavailable', 'warning', checks.statuses.unavailable));
      }
      if (users.dmBlocked > 0) {
        incidents.push(incident('dm_blocked_users', 'warning', users.dmBlocked));
      }
      if (notifications.statuses.failed > 0) {
        incidents.push(incident('notification_retries', 'warning', notifications.statuses.failed));
      }
    }

    incidents.sort((left, right) => {
      const severityDifference = severityRank[left.severity] - severityRank[right.severity];
      return severityDifference !== 0
        ? severityDifference
        : left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    });
    const sourcesAvailable = health.status === 'available' && telemetry.status === 'available';
    return {
      status: !sourcesAvailable ? 'unavailable' : incidents.length === 0 ? 'healthy' : 'degraded',
      generatedAt: this.now().toISOString(),
      health,
      telemetry,
      incidents,
    };
  }

  public readHealthSnapshot(): AdminHealthResult {
    return this.healthSource.readSnapshot();
  }
}

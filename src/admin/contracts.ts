export const runtimePhases = ['starting', 'ready', 'stopping', 'stopped', 'failed'] as const;
export type RuntimePhase = (typeof runtimePhases)[number];

export const healthUnavailableReasons = [
  'unavailable',
  'malformed',
  'unsupported',
  'oversized',
  'future',
  'stale',
] as const;
export type HealthUnavailableReason = (typeof healthUnavailableReasons)[number];

export type AdminHealthResult =
  | {
    readonly status: 'available';
    readonly phase: RuntimePhase;
    readonly discordReady: boolean;
    readonly guildCount: number | null;
    readonly startedAt: string;
    readonly readyAt: string | null;
    readonly heartbeatAt: string;
  }
  | {
    readonly status: 'unavailable';
    readonly reason: HealthUnavailableReason;
  };

export type UserTelemetry = {
  readonly configured: number;
  readonly enabled: number;
  readonly disabled: number;
  readonly dmBlocked: number;
};

export type CheckStatusCounts = {
  readonly never: number;
  readonly pending: number;
  readonly success: number;
  readonly unavailable: number;
  readonly failed: number;
};

export type NotificationStatusCounts = {
  readonly candidate: number;
  readonly sending: number;
  readonly sent: number;
  readonly failed: number;
  readonly terminalFailed: number;
  readonly expired: number;
};

export type BatchStatusCounts = {
  readonly sending: number;
  readonly sent: number;
  readonly failed: number;
  readonly terminalFailed: number;
  readonly expired: number;
};

export type AdminTelemetryResult =
  | {
    readonly status: 'available';
    readonly users: UserTelemetry;
    readonly checks: {
      readonly statuses: CheckStatusCounts;
      readonly latestCompletedAt: string | null;
      readonly nextScheduledAt: string | null;
    };
    readonly notifications: {
      readonly statuses: NotificationStatusCounts;
      readonly latestCreatedAt: string | null;
      readonly latestAttemptAt: string | null;
    };
    readonly batches: {
      readonly statuses: BatchStatusCounts;
      readonly latestCreatedAt: string | null;
      readonly latestAttemptAt: string | null;
    };
  }
  | {
    readonly status: 'unavailable';
    readonly reason: 'database';
  };

export const incidentCodes = [
  'batch_retries',
  'batch_terminal_failures',
  'bot_not_ready',
  'check_failures',
  'check_unavailable',
  'discord_disconnected',
  'dm_blocked_users',
  'health_source_unavailable',
  'notification_retries',
  'notification_terminal_failures',
  'telemetry_source_unavailable',
] as const;
export type IncidentCode = (typeof incidentCodes)[number];
export type IncidentSeverity = 'critical' | 'warning';

export type AdminIncident = {
  readonly code: IncidentCode;
  readonly severity: IncidentSeverity;
  readonly count?: number;
};

export type AdminDashboardSnapshot = {
  readonly status: 'healthy' | 'degraded' | 'unavailable';
  readonly generatedAt: string;
  readonly health: AdminHealthResult;
  readonly telemetry: AdminTelemetryResult;
  readonly incidents: readonly AdminIncident[];
};

export interface AdminHealthSource {
  readSnapshot(): AdminHealthResult;
}

export interface AdminTelemetrySource {
  readSnapshot(): AdminTelemetryResult;
}

export const ADMIN_AUDIT_EVENT_NAMES = [
  'admin.login.succeeded',
  'admin.login.failed',
  'admin.logout',
  'admin.bot.action',
] as const;

export const ADMIN_AUDIT_BOT_ACTIONS = ['start', 'stop', 'restart'] as const;
export const ADMIN_AUDIT_BOT_OUTCOMES = [
  'succeeded',
  'failed',
  'timed_out',
  'terminated',
] as const;

export type AdminAuditEventName = (typeof ADMIN_AUDIT_EVENT_NAMES)[number];
export type AdminAuditBotAction = (typeof ADMIN_AUDIT_BOT_ACTIONS)[number];
export type AdminAuditBotOutcome = (typeof ADMIN_AUDIT_BOT_OUTCOMES)[number];

type AuthenticationAuditEvent = {
  readonly event: Exclude<AdminAuditEventName, 'admin.bot.action'>;
  readonly timestamp: string;
  readonly username?: string;
};

type BotActionAuditEvent = {
  readonly event: 'admin.bot.action';
  readonly timestamp: string;
  readonly username?: string;
  readonly action: AdminAuditBotAction;
  readonly outcome: AdminAuditBotOutcome;
  readonly durationMs: number;
};

export type AdminAuditEvent = AuthenticationAuditEvent | BotActionAuditEvent;

export type AdminAuditRecord =
  | AuthenticationAuditEvent
  | BotActionAuditEvent;

export type AdminAuditSink = (record: AdminAuditRecord) => void;

export class InvalidAdminAuditEventError extends Error {
  readonly name = 'InvalidAdminAuditEventError';

  constructor() {
    super('Invalid admin audit event');
  }
}

function authenticationRecord(event: AuthenticationAuditEvent): AuthenticationAuditEvent {
  return event.username === undefined
    ? { event: event.event, timestamp: event.timestamp }
    : { event: event.event, timestamp: event.timestamp, username: event.username };
}

function botActionRecord(event: BotActionAuditEvent): BotActionAuditEvent {
  const fields = {
    event: event.event,
    timestamp: event.timestamp,
    action: event.action,
    outcome: event.outcome,
    durationMs: event.durationMs,
  } as const;
  return event.username === undefined ? fields : { ...fields, username: event.username };
}

function assertNever(value: never): never {
  throw new InvalidAdminAuditEventError();
}

export class AdminAuditLogger {
  constructor(private readonly sink: AdminAuditSink) {}

  record(event: AdminAuditEvent): void {
    switch (event.event) {
      case 'admin.login.succeeded':
      case 'admin.login.failed':
      case 'admin.logout':
        this.sink(authenticationRecord(event));
        return;
      case 'admin.bot.action':
        this.sink(botActionRecord(event));
        return;
      default:
        return assertNever(event);
    }
  }
}

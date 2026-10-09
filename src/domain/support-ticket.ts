/** What a support ticket is about; the user picks one when opening it. */
export const supportTopics = ['setup', 'alerts', 'bug', 'account', 'other'] as const;
export type SupportTopic = typeof supportTopics[number];

export function isSupportTopic(value: string): value is SupportTopic {
  return (supportTopics as readonly string[]).includes(value);
}

/**
 * `opening`: recorded, its private thread not created yet. `open`: the thread exists.
 * `closed`: ended by the user, the team, or found archived and locked. `failed`: the
 * thread could not be created.
 */
export type SupportTicketStatus = 'opening' | 'open' | 'closed' | 'failed';
export type SupportTicketCloser = 'user' | 'staff' | 'expired';

export interface SupportTicket {
  readonly ticketId: number;
  readonly discordUserId: string;
  readonly guildId: string;
  /** The ticket panel's channel; the private thread lives in it. */
  readonly channelId: string;
  readonly topic: SupportTopic;
  readonly status: SupportTicketStatus;
  readonly threadId: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closedBy: SupportTicketCloser | null;
}

/** Tickets one user can open in a rolling day, so the panel cannot be used to flood the team. */
export const supportTicketDailyLimit = 3;
export const supportTicketLimitWindowMs = 24 * 60 * 60 * 1000;

/** An `opening` ticket older than this was interrupted (a restart) and no longer blocks a new one. */
export const supportTicketOpeningTimeoutMs = 5 * 60 * 1000;

/** Closed and failed tickets are forgotten this long after they ended; the conversation stays in Discord. */
export const supportTicketRetentionMs = 90 * 24 * 60 * 60 * 1000;

/** The longest description a ticket form accepts. */
export const supportDescriptionMaxLength = 1000;

/** "#0042": how a ticket number is shown everywhere. */
export function ticketNumber(ticketId: number): string {
  return `#${String(ticketId).padStart(4, '0')}`;
}

import {
  supportTicketDailyLimit, supportTicketLimitWindowMs, supportTicketOpeningTimeoutMs,
  type SupportTicket, type SupportTicketCloser, type SupportTopic,
} from '../domain/support-ticket.js';
import type { Language } from '../domain/user-config.js';
import type { SupportTicketRepository } from '../persistence/support-ticket-repository.js';
import { safeLogger } from './safe-logger.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

/**
 * A ticket's private thread as Discord reports it. `archived`: Discord archived it
 * after inactivity and a message reopens it. `locked`: closed for good. `missing`: deleted.
 */
export type SupportThreadState = 'active' | 'archived' | 'locked' | 'missing';

export interface SupportTicketOpening {
  readonly ticket: SupportTicket;
  readonly userName: string;
  readonly description: string;
  readonly language: Language;
}

/** What the ticket desk needs from Discord; `src/discord/support` implements it over REST. */
export interface SupportDesk {
  threadState(threadId: string): Promise<SupportThreadState>;
  /** Creates the ticket's private thread in the panel's channel and returns its ID. */
  createThread(channelId: string, opening: SupportTicketOpening): Promise<string>;
  addMember(threadId: string, discordUserId: string): Promise<void>;
  /** The first message in the thread: the user's request and the close button. */
  postTicketHeader(threadId: string, opening: SupportTicketOpening): Promise<void>;
  /** Archives and locks the thread, so only the team can reopen it. */
  lockThread(threadId: string): Promise<void>;
  /** One line in the team's log channel. */
  logOpened(ticket: SupportTicket, threadId: string, userName: string): Promise<void>;
  logClosed(ticket: SupportTicket, closedByUserId: string): Promise<void>;
}

export type OpenTicketResult =
  | { readonly kind: 'opened'; readonly ticket: SupportTicket; readonly threadId: string }
  | { readonly kind: 'already-open'; readonly ticket: SupportTicket }
  | { readonly kind: 'limit'; readonly retryAt: string }
  | { readonly kind: 'failed' };

export type CloseTicketResult =
  | { readonly kind: 'closed'; readonly ticket: SupportTicket }
  | { readonly kind: 'already-closed' | 'not-found' | 'forbidden' };

export interface OpenTicketRequest {
  readonly discordUserId: string;
  readonly userName: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly topic: SupportTopic;
  readonly description: string;
  readonly language: Language;
}

/**
 * Opens and closes support tickets. A ticket is recorded before its thread is
 * created, and each user has at most one unfinished ticket and a daily limit.
 */
export class SupportTicketService {
  public constructor(
    private readonly repository: SupportTicketRepository,
    private readonly desk: SupportDesk,
    private readonly coordinator: UserOperationCoordinator = new UserOperationCoordinator(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Whether a ticket is on record as unfinished; no Discord call, so it fits before a form. */
  public hasActiveRecord(discordUserId: string): boolean {
    return this.repository.findActive(discordUserId) !== null;
  }

  /**
   * The user's ticket that is still going on, or null. An interrupted opening, or a
   * thread that was deleted or locked outside Dealio, is ended here so it no longer blocks.
   */
  public async activeTicket(discordUserId: string): Promise<SupportTicket | null> {
    const ticket = this.repository.findActive(discordUserId);
    if (!ticket) return null;
    const at = this.now();
    if (ticket.status === 'opening' || ticket.threadId === null) {
      if (at.getTime() - Date.parse(ticket.openedAt) < supportTicketOpeningTimeoutMs) return ticket;
      this.repository.markFailed(ticket.ticketId, at.toISOString());
      return null;
    }
    let state: SupportThreadState;
    try {
      state = await this.desk.threadState(ticket.threadId);
    } catch (error: unknown) {
      // Unknown is not ended: pointing to the existing thread is the safe answer.
      safeLogger.error('Could not read a support ticket thread', error);
      return ticket;
    }
    if (state === 'active' || state === 'archived') return ticket;
    this.repository.close(ticket.ticketId, 'expired', at.toISOString());
    return null;
  }

  public open(request: OpenTicketRequest): Promise<OpenTicketResult> {
    return this.coordinator.runExclusive(`support:${request.discordUserId}`, async () => {
      const active = await this.activeTicket(request.discordUserId);
      if (active) return { kind: 'already-open', ticket: active };

      const at = this.now();
      const recent = this.repository.openedSince(request.discordUserId,
        new Date(at.getTime() - supportTicketLimitWindowMs).toISOString());
      if (recent.length >= supportTicketDailyLimit) {
        const oldest = recent[recent.length - supportTicketDailyLimit]!;
        return { kind: 'limit', retryAt: new Date(Date.parse(oldest) + supportTicketLimitWindowMs).toISOString() };
      }

      const ticket = this.repository.reserve(request.discordUserId, request.guildId, request.channelId, request.topic, at.toISOString());
      if (!ticket) {
        const existing = this.repository.findActive(request.discordUserId);
        return existing ? { kind: 'already-open', ticket: existing } : { kind: 'failed' };
      }
      const opening: SupportTicketOpening = {
        ticket, userName: request.userName, description: request.description, language: request.language,
      };

      let threadId: string;
      try {
        threadId = await this.desk.createThread(request.channelId, opening);
      } catch (error: unknown) {
        safeLogger.error('Could not create a support ticket thread', error);
        this.repository.markFailed(ticket.ticketId, this.now().toISOString());
        return { kind: 'failed' };
      }
      this.repository.attachThread(ticket.ticketId, threadId);

      try {
        await this.desk.addMember(threadId, request.discordUserId);
      } catch (error: unknown) {
        // A private thread the user cannot see is no ticket at all.
        safeLogger.error('Could not add the user to a support ticket thread', error);
        this.repository.markFailed(ticket.ticketId, this.now().toISOString());
        await this.desk.lockThread(threadId).catch(() => undefined);
        return { kind: 'failed' };
      }

      const opened = this.repository.find(ticket.ticketId) ?? ticket;
      // The thread already works; a missing header or log line must not undo it.
      await this.desk.postTicketHeader(threadId, { ...opening, ticket: opened })
        .catch((error: unknown) => safeLogger.error('Could not post a support ticket header', error));
      await this.desk.logOpened(opened, threadId, request.userName)
        .catch((error: unknown) => safeLogger.error('Could not log an opened support ticket', error));
      return { kind: 'opened', ticket: opened, threadId };
    });
  }

  /**
   * Marks the ticket closed. The caller announces it in the thread and then calls
   * `finishClose`, because a locked thread no longer accepts the announcement.
   */
  public close(ticketId: number, actorUserId: string, actorIsStaff: boolean): CloseTicketResult {
    const ticket = this.repository.find(ticketId);
    if (!ticket) return { kind: 'not-found' };
    const closedBy: SupportTicketCloser | null = actorUserId === ticket.discordUserId ? 'user' : actorIsStaff ? 'staff' : null;
    if (closedBy === null) return { kind: 'forbidden' };
    if (!this.repository.close(ticketId, closedBy, this.now().toISOString())) return { kind: 'already-closed' };
    return { kind: 'closed', ticket: this.repository.find(ticketId) ?? ticket };
  }

  public async finishClose(ticket: SupportTicket, closedByUserId: string): Promise<void> {
    if (ticket.threadId) {
      await this.desk.lockThread(ticket.threadId)
        .catch((error: unknown) => safeLogger.error('Could not lock a closed support ticket thread', error));
    }
    await this.desk.logClosed(ticket, closedByUserId)
      .catch((error: unknown) => safeLogger.error('Could not log a closed support ticket', error));
  }
}

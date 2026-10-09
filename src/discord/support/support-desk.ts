import { ChannelType, DiscordAPIError, MessageFlags, Routes, type REST } from 'discord.js';
import type { SupportDesk, SupportThreadState, SupportTicketOpening } from '../../application/support-ticket-service.js';
import { supportScreenshotMaxBytes, type SupportScreenshot, type SupportTicket } from '../../domain/support-ticket.js';
import type { SupportConfig } from '../../config/environment.js';
import { buildTicketClosedLog, buildTicketHeader, buildTicketOpenedLog, ticketThreadName } from './support-view.js';

/** A week: the longest inactivity before Discord archives a thread. A message reopens it. */
const autoArchiveMinutes = 10_080;
const unknownChannelCode = 10_003;
const screenshotTimeoutMs = 10_000;

interface ThreadChannel {
  readonly id: string;
  readonly thread_metadata?: { readonly archived?: boolean; readonly locked?: boolean };
}

/**
 * The ticket desk over Discord's REST API. Threads and messages are not kept in the
 * gateway cache (see `client.ts`), so each call reads or writes Discord directly.
 */
export class RestSupportDesk implements SupportDesk {
  public constructor(
    private readonly rest: Pick<REST, 'get' | 'post' | 'put' | 'patch'>,
    private readonly config: SupportConfig,
    private readonly fetchFile: typeof fetch = fetch,
  ) {}

  public async threadState(threadId: string): Promise<SupportThreadState> {
    let thread: ThreadChannel;
    try {
      thread = await this.rest.get(Routes.channel(threadId)) as ThreadChannel;
    } catch (error: unknown) {
      if (error instanceof DiscordAPIError && (error.code === unknownChannelCode || error.status === 404)) return 'missing';
      throw error;
    }
    if (thread.thread_metadata?.locked) return 'locked';
    return thread.thread_metadata?.archived ? 'archived' : 'active';
  }

  public async createThread(channelId: string, opening: SupportTicketOpening): Promise<string> {
    const thread = await this.rest.post(Routes.threads(channelId), {
      body: {
        name: ticketThreadName(opening.ticket, opening.userName),
        type: ChannelType.PrivateThread,
        // Members cannot add others to someone else's ticket.
        invitable: false,
        auto_archive_duration: autoArchiveMinutes,
      },
      reason: `Support ticket ${opening.ticket.ticketId}`,
    }) as ThreadChannel;
    return thread.id;
  }

  public async addMember(threadId: string, discordUserId: string): Promise<void> {
    await this.rest.put(Routes.threadMembers(threadId, discordUserId));
  }

  public async postTicketHeader(threadId: string, opening: SupportTicketOpening): Promise<void> {
    const files = await this.downloadScreenshots(opening.screenshots ?? []);
    await this.rest.post(Routes.channelMessages(threadId), {
      body: {
        flags: MessageFlags.IsComponentsV2,
        components: [buildTicketHeader(opening.ticket, opening.description, opening.language, files.map((file) => file.name)).toJSON()],
        allowed_mentions: { parse: [], users: [opening.ticket.discordUserId] },
        attachments: files.map((file, id) => ({ id, filename: file.name })),
      },
      files,
    });
  }

  /** The form's images, read from Discord's CDN; one that cannot be read is left out, not fatal. */
  private async downloadScreenshots(screenshots: readonly SupportScreenshot[]): Promise<Array<{ name: string; data: Buffer }>> {
    const files: Array<{ name: string; data: Buffer }> = [];
    for (const screenshot of screenshots) {
      try {
        const response = await this.fetchFile(screenshot.url, { signal: AbortSignal.timeout(screenshotTimeoutMs) });
        if (!response.ok) continue;
        const data = Buffer.from(await response.arrayBuffer());
        if (data.byteLength > 0 && data.byteLength <= supportScreenshotMaxBytes) files.push({ name: screenshot.name, data });
      } catch {
        // A missing screenshot never blocks the ticket.
      }
    }
    return files;
  }

  public async lockThread(threadId: string): Promise<void> {
    await this.rest.patch(Routes.channel(threadId), {
      body: { archived: true, locked: true },
      reason: 'Support ticket closed',
    });
  }

  public async logOpened(ticket: SupportTicket, threadId: string, userName: string): Promise<void> {
    await this.rest.post(Routes.channelMessages(this.config.logChannelId), {
      body: {
        flags: MessageFlags.IsComponentsV2,
        components: [buildTicketOpenedLog(ticket, userName, threadId, this.config.teamRoleId).toJSON()],
        // Only the team role is pinged; the user is named, not notified.
        allowed_mentions: { parse: [], roles: [this.config.teamRoleId] },
      },
    });
  }

  public async logClosed(ticket: SupportTicket, closedByUserId: string): Promise<void> {
    await this.rest.post(Routes.channelMessages(this.config.logChannelId), {
      body: {
        flags: MessageFlags.IsComponentsV2,
        components: [buildTicketClosedLog(ticket, closedByUserId).toJSON()],
        allowed_mentions: { parse: [] },
      },
    });
  }
}

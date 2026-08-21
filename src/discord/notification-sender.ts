import type { Client } from 'discord.js';
import type { Language } from '../domain/user-config.js';
import type { NotificationCandidate } from '../domain/wishlist-state.js';
import type { NotificationSender } from '../application/notification-service.js';
import { buildSaleNotificationMessage } from './notification-messages.js';

export class DiscordNotificationSender implements NotificationSender {
  public constructor(private readonly client: Client) {}

  public async send(candidate: NotificationCandidate, language: Language): Promise<void> {
    const user = await this.client.users.fetch(candidate.discordUserId);
    await user.send({
      content: buildSaleNotificationMessage(candidate, language),
      allowedMentions: { parse: [] },
    });
  }
}

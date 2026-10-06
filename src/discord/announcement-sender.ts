import { MessageFlags, Routes, type Client, type ContainerBuilder } from 'discord.js';
import type { AnnouncementSender } from '../application/admin/broadcast-service.js';
import { languages, type Language } from '../domain/user-config.js';
import type { AnnouncementContent, AnnouncementText } from '../persistence/broadcast-repository.js';
import { localizer } from './i18n.js';
import { buildNoticePanel, openPanelNoticeButton } from './ui/components-v2.js';

/** The recipient's language, else English, else any written language. */
export function announcementText(content: AnnouncementContent, language: Language): { language: Language; text: AnnouncementText } | null {
  const order: Language[] = [language, 'en', ...languages];
  for (const candidate of order) {
    const text = content[candidate];
    if (text && text.title.trim() && text.body.trim()) return { language: candidate, text };
  }
  return null;
}

export function buildAnnouncementPanel(language: Language, text: AnnouncementText): ContainerBuilder {
  const t = localizer(language);
  return buildNoticePanel(language, 'info', text.title.trim(),
    `${text.body.trim()}\n\n-# ${t({
      tr: 'Dealio’dan bir duyuru', en: 'An announcement from Dealio', de: 'Eine Mitteilung von Dealio', fr: 'Une annonce de Dealio',
    })}`,
    { button: openPanelNoticeButton(language) });
}

export class NoAnnouncementTextError extends Error {
  public readonly name = 'NoAnnouncementTextError';
}

/** Sends one announcement DM. Every request has a deadline. */
export class DiscordAnnouncementSender implements AnnouncementSender {
  public constructor(private readonly client: Pick<Client, 'rest'>, private readonly timeoutMs = 20_000) {}

  public async send(discordUserId: string, language: Language, content: AnnouncementContent): Promise<{ readonly messageId: string }> {
    const picked = announcementText(content, language);
    if (!picked) throw new NoAnnouncementTextError('The announcement has no text');
    const signal = AbortSignal.timeout(this.timeoutMs);
    const channel = await this.client.rest.post(Routes.userChannels(), {
      body: { recipient_id: discordUserId }, signal,
    }) as { id?: unknown };
    if (typeof channel.id !== 'string' || !/^\d+$/.test(channel.id)) throw new Error('Discord returned an invalid DM channel');
    const message = await this.client.rest.post(Routes.channelMessages(channel.id), {
      body: {
        flags: MessageFlags.IsComponentsV2,
        components: [buildAnnouncementPanel(picked.language, picked.text).toJSON()],
        allowed_mentions: { parse: [] },
      },
      signal,
    }) as { id?: unknown };
    if (typeof message.id !== 'string' || !/^\d+$/.test(message.id)) throw new Error('Discord returned an invalid message');
    return { messageId: message.id };
  }
}

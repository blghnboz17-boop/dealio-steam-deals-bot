import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { StatusService } from '../../application/status-service.js';
import type { Language } from '../../domain/user-config.js';
import { messagesFor } from '../messages.js';

export const statusCommand = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show your Steam wishlist notification status');

function displayTime(value: string | null): string {
  if (!value) {
    return '-';
  }

  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:f>` : '-';
}

export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  service: StatusService,
): Promise<void> {
  const status = service.get(interaction.user.id);

  if (!status.config) {
    await interaction.reply({
      content: messagesFor('tr').statusNotConfigured,
      ephemeral: true,
    });
    return;
  }

  const language: Language = status.config.language;
  const checkState = status.checkState;
  const accessError = checkState?.lastErrorCode === 'STEAM_WISHLIST_INACCESSIBLE'
    ? messagesFor(language).wishlistInaccessible
    : null;
  const content = language === 'tr'
    ? [
        '**Steam wishlist durumu**',
        `SteamID64: \`${status.config.steamId64}\``,
        `Bildirim dili: ${language}`,
        `Aktif: ${status.config.enabled ? 'evet' : 'hayır'}`,
        `Son kontrol: ${displayTime(checkState?.lastCompletedAt ?? null)}`,
        `Sonuç: ${checkState?.lastStatus ?? 'bekliyor'}`,
        ...(accessError ? [`Erişim hatası: ${accessError}`] : []),
        `Sonraki kontrol: ${displayTime(checkState?.nextScheduledAt ?? null)}`,
      ].join('\n')
    : [
        '**Steam wishlist status**',
        `SteamID64: \`${status.config.steamId64}\``,
        `Notification language: ${language}`,
        `Enabled: ${status.config.enabled ? 'yes' : 'no'}`,
        `Last check: ${displayTime(checkState?.lastCompletedAt ?? null)}`,
        `Result: ${checkState?.lastStatus ?? 'pending'}`,
        ...(accessError ? [`Access error: ${accessError}`] : []),
        `Next check: ${displayTime(checkState?.nextScheduledAt ?? null)}`,
      ].join('\n');

  await interaction.reply({ content, ephemeral: true });
}

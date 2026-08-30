import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import type { StatusDashboardResult } from '../application/status-service.js';
import type { CheckStatus } from '../domain/check-state.js';
import type { Language } from '../domain/user-config.js';
import { storeCountryLabel } from '../domain/store-country.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { uiCopy } from './ui/copy.js';

type ReadyStatus = Extract<StatusDashboardResult, { status: 'ready' }>;

export interface StatusV2Options {
  readonly mode?: 'home' | 'status';
  readonly bannerUrl?: string;
  readonly avatarUrl?: string;
  readonly disabled?: boolean;
}

export function buildStatusV2Panel(
  result: ReadyStatus,
  sessionId: string,
  options: StatusV2Options = {},
): ContainerBuilder {
  const { config, checkState, notificationQueue, language } = result;
  const text = uiCopy(language);
  const mode = options.mode ?? 'status';
  const disabled = options.disabled ?? false;
  const profileUrl = `https://steamcommunity.com/profiles/${config.steamId64}`;
  const color = !config.enabled
    ? dealioBrand.colors.muted
    : config.dmDeliveryBlockedAt
      ? dealioBrand.colors.danger
      : checkState?.lastStatus === 'success'
        ? dealioBrand.colors.success
        : checkState?.lastStatus === 'failed' || checkState?.lastStatus === 'unavailable'
          ? dealioBrand.colors.warning
          : dealioBrand.colors.primary;
  const prefix = mode === 'home' ? 'dealio' : 'status-v2';
  const container = new ContainerBuilder().setAccentColor(color);

  if (mode === 'home' && options.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(options.bannerUrl)
          .setDescription('Dealio · Steam wishlist sale alerts'),
      ),
    );
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ✨ ${mode === 'home' ? text.homeTitle : statusTitle(language)}`),
    new TextDisplayBuilder().setContent(mode === 'home' ? text.homeDescription : statusDescription(language)),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  const accountContent = [
    `## 👤 ${text.account}`,
    `[${maskSteamId(config.steamId64)}](${profileUrl}) · **${storeCountryLabel(config.storeCountryCode, language)}**`,
    `${language === 'tr' ? 'Dil' : 'Language'}: **${language === 'tr' ? 'Türkçe' : 'English'}** · ${language === 'tr' ? 'Minimum indirim' : 'Minimum discount'}: **${language === 'tr' ? `%${config.minimumDiscountPercent}` : `${config.minimumDiscountPercent}%`}**`,
  ].join('\n');
  if (options.avatarUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(accountContent))
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(options.avatarUrl).setDescription('Dealio'),
        ),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(accountContent));
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## 🎮 ${text.tracking}`,
      `${language === 'tr' ? 'İşlenen oyun' : 'Games processed'}: **${displayCount(checkState?.lastSuccessCheckedCount, text.never)}** · ${language === 'tr' ? 'İndirimde' : 'On sale'}: **${displayCount(checkState?.lastSuccessOnSaleCount, text.never)}**`,
      `${language === 'tr' ? 'Son başarılı kontrol' : 'Last successful check'}: ${displayTime(checkState?.lastSuccessCompletedAt, text.never)}`,
      `${language === 'tr' ? 'Sonraki otomatik kontrol' : 'Next automatic check'}: ${displayTime(checkState?.nextScheduledAt, text.never)}`,
    ].join('\n')),
    new TextDisplayBuilder().setContent([
      `## 🔔 ${text.notifications}`,
      `**${config.enabled ? text.active : text.paused}** · ${config.dmDeliveryBlockedAt ? `🛑 ${text.dmBlocked}` : `✅ ${text.dmReady}`}`,
      `${language === 'tr' ? 'Bekleyen' : 'Pending'}: **${notificationQueue.pending + notificationQueue.retry}** · ${language === 'tr' ? 'Gönderilen' : 'Sent'}: **${notificationQueue.sent}** · ${language === 'tr' ? 'Kalıcı hata' : 'Permanent failures'}: **${notificationQueue.terminalFailed}**`,
    ].join('\n')),
    new TextDisplayBuilder().setContent([
      `## 🔄 ${text.lastCheck}`,
      `${localizedCheckStatus(checkState?.lastStatus ?? null, language)}`,
      `${language === 'tr' ? 'Tamamlanma' : 'Completed'}: ${displayTime(checkState?.lastCompletedAt, text.never)}`,
      `${language === 'tr' ? 'Fiyat para birimi' : 'Price currency'}: **${result.latestPriceCurrencies.join(' / ') || text.never}** · ${language === 'tr' ? 'Oyuna özel kural' : 'Game rules'}: **${result.gameDiscountOverrideCount}**`,
    ].join('\n')),
  );

  if (config.dmDeliveryBlockedAt) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        language === 'tr'
          ? '> 🛑 **DM teslimatı duraklatıldı.** Discord gizlilik ayarını düzelttikten sonra Test DM’i gönder ve bildirimleri yeniden aç.'
          : '> 🛑 **DM delivery is paused.** Fix Discord privacy settings, send a Test DM, then enable notifications again.',
      ));
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  if (mode === 'home') {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:wishlist`).setLabel(text.homeWishlist).setEmoji('🎮').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:check`).setLabel(text.homeCheck).setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:settings`).setLabel(text.homeSettings).setEmoji('🔔').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ),
    );
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:region`).setLabel(text.homeRegionLanguage).setEmoji('🌍').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:test`).setLabel(text.homeTest).setEmoji('✉️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:refresh`).setLabel(text.homeRefresh).setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ),
    );
  } else {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}:${sessionId}:${config.enabled ? 'disable' : 'enable'}`)
          .setLabel(config.enabled
            ? (language === 'tr' ? 'Bildirimleri Kapat' : 'Disable Notifications')
            : (language === 'tr' ? 'Bildirimleri Aç' : 'Enable Notifications'))
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
          .setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:minimum-discount`).setLabel(language === 'tr' ? 'Minimum İndirim' : 'Minimum Discount').setEmoji('🏷️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:region`).setLabel(language === 'tr' ? 'Bölge' : 'Region').setEmoji('🌍').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:language`).setLabel(language === 'tr' ? 'Dil' : 'Language').setEmoji('🌐').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:test`).setLabel(language === 'tr' ? 'Test DM' : 'Test DM').setEmoji('✉️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ),
    );
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

function statusTitle(language: Language): string {
  return language === 'tr' ? 'Dealio Durum ve Ayarlar' : 'Dealio Status & Settings';
}

function statusDescription(language: Language): string {
  return language === 'tr'
    ? 'İzleme durumunu kontrol et ve kişisel bildirim ayarlarını yönet.'
    : 'Review tracking health and manage your personal notification settings.';
}

function displayTime(value: string | null | undefined, emptyValue: string): string {
  if (!value) {
    return emptyValue;
  }
  const timestamp = Math.floor(new Date(value).getTime() / 1_000);
  return Number.isSafeInteger(timestamp) ? `<t:${timestamp}:R>` : emptyValue;
}

function displayCount(value: number | null | undefined, emptyValue: string): string {
  return value === null || value === undefined ? emptyValue : String(value);
}

function maskSteamId(steamId64: string): string {
  return `${steamId64.slice(0, 5)}••••••••${steamId64.slice(-4)}`;
}

function localizedCheckStatus(status: CheckStatus | null, language: Language): string {
  if (language === 'tr') {
    if (status === 'success') return '✅ Başarılı';
    if (status === 'unavailable') return '⚠️ Steam kullanılamıyor';
    if (status === 'failed') return '🛑 Başarısız';
    return '⏳ Henüz tamamlanmış kontrol yok';
  }
  if (status === 'success') return '✅ Successful';
  if (status === 'unavailable') return '⚠️ Steam unavailable';
  if (status === 'failed') return '🛑 Failed';
  return '⏳ No completed check yet';
}

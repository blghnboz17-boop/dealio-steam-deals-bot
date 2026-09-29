import { artworkAccessory } from './ui/game-artwork.js';
import { buildHomePanel } from './home-view.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { WishlistItem } from '../domain/steam.js';
import { formatMinorPrice, sanitizeGameName } from './notification-messages.js';
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
  readonly featuredDeal?: WishlistItem;
  readonly heroGame?: WishlistItem;
  readonly trackedGameCount?: number;
  readonly capturedAt?: string;
  readonly notificationPreference?: NotificationPreference;
  readonly eligibleDealCount?: number;
  readonly mode?: 'home' | 'status';
  readonly bannerUrl?: string;
  readonly avatarUrl?: string;
  readonly disabled?: boolean;
}

function buildPreferencesPanel(
  result: ReadyStatus,
  sessionId: string,
  options: StatusV2Options = {},
): ContainerBuilder {
  const { config, checkState, notificationQueue, language } = result;
  const text = uiCopy(language);
  const mode = options.mode ?? 'status';
  const disabled = options.disabled ?? false;
  const profileUrl = `https://steamcommunity.com/profiles/${config.steamId64}`;
  const incompleteCount = (checkState?.lastSuccessUnknownPriceCount ?? 0)
    + (checkState?.lastSuccessFailedItemCount ?? 0);
  const color = config.dmDeliveryBlockedAt
    ? dealioBrand.colors.danger
    : !config.enabled
      ? dealioBrand.colors.muted
      : checkState?.lastStatus === 'failed' || checkState?.lastStatus === 'unavailable' || incompleteCount > 0
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
  const tr = language === 'tr';
  const deliveryState = config.dmDeliveryBlockedAt
    ? (tr ? 'DM teslimatı engellendi' : 'DM delivery blocked')
    : config.enabled
      ? (tr ? 'Takip açık' : 'Tracking active')
      : (tr ? 'Takip duraklatıldı' : 'Tracking paused');
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# DEALIO / ${mode === 'home' ? (tr ? 'GENEL BAKIŞ' : 'OVERVIEW') : (tr ? 'TERCİHLER' : 'PREFERENCES')}`,
    ),
    new TextDisplayBuilder().setContent(`# ${mode === 'home' ? text.homeTitle : statusTitle(language)}`),
    new TextDisplayBuilder().setContent(
      `${mode === 'home' ? text.homeDescription : statusDescription(language)}\n**${deliveryState}** · Discord DM`,
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  const sales = displayCount(checkState?.lastSuccessOnSaleCount, '—');
  const checked = displayCount(checkState?.lastSuccessCheckedCount, '—');
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      checkState?.lastSuccessOnSaleCount == null
        ? `## ${tr ? 'İlk kontrol bekleniyor' : 'Waiting for the first check'}`
        : `## ${sales} ${tr ? 'oyun indirimde' : 'games on sale'}`,
      `**${checked}** ${tr ? 'işlenen oyun' : 'games processed'} · **${notificationQueue.pending + notificationQueue.retry}** ${tr ? 'bekleyen bildirim' : 'pending alerts'}`,
      `-# ${tr ? 'Son başarılı kontrol' : 'Last successful check'}: ${displayTime(checkState?.lastSuccessCompletedAt, text.never)}`,
    ].join('\n')),
  );
  if(mode==='home' && options.featuredDeal?.price?.currency){
    const item=options.featuredDeal;
    container.addSectionComponents(artworkAccessory(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `### ${tr?'Kurallarına uygun':'Matches your rules'} · ${options.eligibleDealCount??1}\n[${sanitizeGameName(item.name).slice(0,100)}](https://store.steampowered.com/app/${item.appId})\n**${formatMinorPrice(item.price!.finalMinor,item.price!.currency!,language)}** · −${item.price!.discountPercent}%`)), item));
  }
  const accountContent = [
    `### ${text.account}`,
    `[${maskSteamId(config.steamId64)}](${profileUrl}) · **${storeCountryLabel(config.storeCountryCode, language)}**`,
    `${tr ? 'Türkçe' : 'English'} · ${tr ? 'Minimum indirim' : 'Minimum discount'} **${tr ? `%${config.minimumDiscountPercent}` : `${config.minimumDiscountPercent}%`}** · **${result.gameDiscountOverrideCount}** ${tr ? 'oyuna özel kural' : 'game rules'}`,
  ].join('\n');
  if (options.avatarUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(accountContent))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.avatarUrl).setDescription('Dealio')),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(accountContent));
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `### ${tr ? 'Kontrol takvimi' : 'Check schedule'}`,
      `${tr ? 'Sonraki otomatik kontrol' : 'Next automatic check'}: ${config.enabled ? displayTime(checkState?.nextScheduledAt, text.never) : (tr ? 'Takip duraklatıldı' : 'Tracking paused')}`,
      `${localizedCheckStatus(checkState?.lastStatus ?? null, language)} · ${displayTime(checkState?.lastCompletedAt, text.never)}`,
      `-# ${tr ? 'Fiyat para birimi' : 'Price currency'}: ${result.latestPriceCurrencies.join(' / ') || text.never}`,
    ].join('\n')),
  );
  if (mode === 'status') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `### ${tr ? 'Bildirim özeti' : 'Delivery summary'}`,
      `**${notificationQueue.sent}** ${tr ? 'gönderildi' : 'sent'} · **${notificationQueue.terminalFailed}** ${tr ? 'kalıcı hata' : 'permanent failures'}`,
      tr
        ? '-# Minimum indirim tüm oyunlara uygulanır. Wishlist ekranından oyuna özel eşik belirleyebilirsin.'
        : '-# The minimum discount applies to all games. Set individual thresholds from your wishlist.',
    ].join('\n')));
  }
  if (incompleteCount > 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      tr
        ? `> ⚠️ Son başarılı kontrolde **${incompleteCount} oyunun** fiyatı doğrulanamadı. İndirim sayısı bu oyunları kapsamıyor.`
        : `> ⚠️ Prices for **${incompleteCount} games** could not be verified in the last successful check. They are excluded from the sale count.`,
    ));
  }
  if (checkState?.lastStatus === 'failed' || checkState?.lastStatus === 'unavailable') {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      tr
        ? '> ⚠️ Son kontrol tamamlanamadı. Yukarıdaki sayılar son başarılı kontrolden; güncel fiyatlar doğrulanmış değil.'
        : '> ⚠️ The latest check did not complete. Counts are from the last successful check; current prices are unverified.',
    ));
  }

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
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:history`).setLabel(tr?'Bildirim Geçmişi':'Alert History').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:rhythm`).setLabel(tr?'Bildirim Ritmi':'Alert Timing').setStyle(ButtonStyle.Secondary).setDisabled(disabled)));
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
          .setStyle(config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(disabled),
        new ButtonBuilder().setCustomId(`${prefix}:${sessionId}:minimum-discount`).setLabel(language === 'tr' ? 'Minimum İndirim' : 'Minimum Discount').setEmoji('🏷️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
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


export function buildStatusV2Panel(
  result: ReadyStatus,
  sessionId: string,
  options: StatusV2Options = {},
): ContainerBuilder {
  return options.mode === 'home'
    ? buildHomePanel(result, sessionId, options)
    : buildPreferencesPanel(result, sessionId, options);
}

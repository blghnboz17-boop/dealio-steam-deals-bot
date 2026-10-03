import { buildHomePanel } from './home-view.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { WishlistItem } from '../domain/steam.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
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
import { flagEmoji, panelHeader, tabAccent } from './ui/design.js';
import { buildTabBar } from './ui/tab-bar.js';

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
  /** Show the shared tab row (the panel was opened with navigation). */
  readonly tabs?: boolean;
}

function buildSettingsPanel(
  result: ReadyStatus,
  sessionId: string,
  options: StatusV2Options = {},
): ContainerBuilder {
  const { config, checkState, notificationQueue, language } = result;
  const text = uiCopy(language);
  const tr = language === 'tr';
  const t = (turkish: string, english: string) => tr ? turkish : english;
  const disabled = options.disabled ?? false;
  const prefix = 'status-v2';
  const profileUrl = `https://steamcommunity.com/profiles/${config.steamId64}`;
  const incompleteCount = (checkState?.lastSuccessUnknownPriceCount ?? 0)
    + (checkState?.lastSuccessFailedItemCount ?? 0);
  const failed = checkState?.lastStatus === 'failed' || checkState?.lastStatus === 'unavailable';
  const container = new ContainerBuilder().setAccentColor(config.dmDeliveryBlockedAt
    ? dealioBrand.colors.danger
    : failed || incompleteCount > 0 ? dealioBrand.colors.warning : tabAccent.settings);
  const divider = () => container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const button = (action: string, label: string, emoji: string, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`${prefix}:${sessionId}:${action}`).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);

  const tracking = config.dmDeliveryBlockedAt
    ? '🔴 ' + t('DM teslimatı engellendi', 'DM delivery blocked')
    : config.enabled ? '🟢 ' + t('Takip açık', 'Tracking on') : '⏸️ ' + t('Takip duraklatıldı', 'Tracking paused');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(panelHeader('settings', language,
    t('Hesabın ve tercihlerin', 'Your account & preferences'),
    `**${tracking}** · Discord DM`)));
  divider();

  const account = [
    `### 👤 ${text.account}`,
    `[${maskSteamId(config.steamId64)}](${profileUrl})`,
    `${flagEmoji(config.storeCountryCode)} **${storeCountryLabel(config.storeCountryCode, language)}** · 🌐 ${tr ? 'Türkçe' : 'English'}`,
    `🏷️ ${t('Minimum indirim', 'Minimum discount')} **${tr ? `%${config.minimumDiscountPercent}` : `${config.minimumDiscountPercent}%`}** · 🎯 **${result.gameDiscountOverrideCount}** ${t('oyuna özel kural', 'game rules')}`,
  ].join('\n');
  container.addSectionComponents(options.avatarUrl
    ? new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(account))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.avatarUrl).setDescription('Dealio'))
    : new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(account))
      .setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(profileUrl).setLabel('Steam')));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### 🗓️ ${t('Kontrol takvimi', 'Check schedule')}`,
    `🔜 ${t('Sonraki otomatik kontrol', 'Next automatic check')}: ${config.enabled ? displayTime(checkState?.nextScheduledAt, text.never) : t('takip duraklatıldı', 'tracking paused')}`,
    `${localizedCheckStatus(checkState?.lastStatus ?? null, language)} · ${displayTime(checkState?.lastCompletedAt, text.never)}`,
    `-# 🎮 ${displayCount(checkState?.lastSuccessCheckedCount, '—')} ${t('oyun işlendi', 'games processed')} · 🔥 ${displayCount(checkState?.lastSuccessOnSaleCount, '—')} ${t('indirimde', 'on sale')} · 💱 ${result.latestPriceCurrencies.join(' / ') || text.never}`,
  ].join('\n')));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### 📨 ${t('Bildirimler', 'Alerts')}`,
    `✅ **${notificationQueue.sent}** ${t('gönderildi', 'sent')} · 📬 **${notificationQueue.pending + notificationQueue.retry}** ${t('bekliyor', 'waiting')} · ❌ **${notificationQueue.terminalFailed}** ${t('kalıcı hata', 'permanent failures')}`,
    t('-# Minimum indirim tüm oyunlara uygulanır. 🎮 Oyunlarım’dan oyuna özel kural koyabilirsin.',
      '-# The minimum discount applies to every game. Set per-game rules in 🎮 My games.'),
  ].join('\n')));
  if (incompleteCount > 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t(
      `> ⚠️ Son başarılı kontrolde **${incompleteCount} oyunun** fiyatı doğrulanamadı. İndirim sayısı bu oyunları kapsamıyor.`,
      `> ⚠️ Prices for **${incompleteCount} games** could not be verified in the last successful check. They are excluded from the sale count.`)));
  }
  if (failed) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t(
      '> ⚠️ Son kontrol tamamlanamadı. Sayılar son başarılı kontrolden; güncel fiyatlar doğrulanmış değil.',
      '> ⚠️ The latest check did not complete. Counts are from the last successful check; current prices are unverified.')));
  }
  if (config.dmDeliveryBlockedAt) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t(
      '> 🛑 **DM teslimatı duraklatıldı.** Discord gizlilik ayarını düzelttikten sonra Test DM’i gönder ve bildirimleri yeniden aç.',
      '> 🛑 **DM delivery is paused.** Fix Discord privacy settings, send a Test DM, then enable notifications again.')));
  }

  divider();
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      config.enabled
        ? button('disable', t('Bildirimleri kapat', 'Pause alerts'), '🔕')
        : button('enable', t('Bildirimleri aç', 'Resume alerts'), '🔔', ButtonStyle.Success),
      button('minimum-discount', t('Minimum indirim', 'Minimum discount'), '🏷️'),
      button('test', 'Test DM', '✉️'),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('region', t('Bölge', 'Region'), '🌍'),
      button('language', t('Dil', 'Language'), '🌐'),
    ),
  );
  if (options.tabs) {
    divider();
    container.addActionRowComponents(buildTabBar(prefix, sessionId, language, { active: 'settings', disabled }));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
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
    : buildSettingsPanel(result, sessionId, options);
}

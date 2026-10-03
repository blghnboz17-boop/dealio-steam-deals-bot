import { addArtwork } from './ui/game-artwork.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import type { StatusDashboardResult } from '../application/status-service.js';
import type { StatusV2Options } from './status-view-v2.js';
import { sanitizeGameName } from './notification-messages.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { dealioBrand } from './ui/brand.js';
import { countryDisplay, panelHeader, priceLine, savingsLine, tabAccent } from './ui/design.js';
import { buildTabBar } from './ui/tab-bar.js';

type ReadyStatus = Extract<StatusDashboardResult, { status: 'ready' }>;
const display = (value: string) => new TextDisplayBuilder().setContent(value);
const relative = (value: string | null | undefined, fallback: string): string => {
  const seconds = value ? Math.floor(Date.parse(value) / 1000) : NaN;
  return Number.isSafeInteger(seconds) ? '<t:' + seconds + ':R>' : fallback;
};
const clock = (minute: number | null): string => minute === null ? '—'
  : String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');

export function buildHomePanel(result: ReadyStatus, sessionId: string, options: StatusV2Options): ContainerBuilder {
  const { config, language, checkState, notificationQueue: queue } = result;
  const tr = language === 'tr';
  const t = (turkish: string, english: string) => tr ? turkish : english;
  const disabled = options.disabled ?? false;
  const pending = queue.pending + queue.retry + queue.sending;
  const blocked = Boolean(config.dmDeliveryBlockedAt);
  const partial = (checkState?.lastSuccessUnknownPriceCount ?? 0) + (checkState?.lastSuccessFailedItemCount ?? 0);
  const failed = checkState?.lastStatus === 'failed' || checkState?.lastStatus === 'unavailable';
  const root = new ContainerBuilder().setAccentColor(blocked ? dealioBrand.colors.danger
    : failed || partial ? dealioBrand.colors.warning : tabAccent.home);
  const button = (action: string, label: string, emoji: string) => new ButtonBuilder()
    .setCustomId('dealio:' + sessionId + ':' + action).setLabel(label).setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const divider = (large = false) => root.addSeparatorComponents(new SeparatorBuilder()
    .setDivider(true).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small));

  const pref = options.notificationPreference;
  const timing = pref?.mode === 'quiet'
    ? '🌙 ' + clock(pref.quietStart) + '–' + clock(pref.quietEnd)
    : pref?.mode === 'digest' ? '📬 ' + t('Özet ', 'Digest ') + clock(pref.digestMinute) : '⚡ ' + t('Anında bildirim', 'Instant alerts');
  const tracking = blocked ? '🔴 ' + t('DM engelli', 'DMs blocked')
    : config.enabled ? '🟢 ' + t('Takip açık', 'Tracking on') : '⏸️ ' + t('Duraklatıldı', 'Paused');
  root.addTextDisplayComponents(display(
    panelHeader('home', language, t('Wishlist’in. Senin kuralların.', 'Your wishlist. Your rules.'),
      t('İstediğin oyunu, istediğin fiyata yakala.', 'Get the games you want at the price you choose.')) +
    '\n-# ' + tracking + '　' + countryDisplay(config.storeCountryCode, language) +
    '　' + timing,
  ));
  divider(true);

  const hero = options.featuredDeal ?? options.heroGame;
  if (hero) {
    root.addTextDisplayComponents(display('-# ' + (options.featuredDeal
      ? '🔥 ' + t('KURALINA UYGUN FIRSAT', 'A DEAL THAT MATCHES YOUR RULE')
      : '✨ ' + t('WISHLIST’İNDEN', 'FROM YOUR WISHLIST'))));
    addArtwork(root, hero);
    const price = hero.price?.currency ? { ...hero.price, currency: hero.price.currency } : null;
    const savings = price && savingsLine(price, language);
    root.addTextDisplayComponents(display('## [' + sanitizeGameName(hero.name).slice(0, 100) +
      '](https://store.steampowered.com/app/' + hero.appId + ')\n' +
      (price ? priceLine(price, language) : t('Fiyat doğrulanamadı', 'Price unavailable')) +
      (savings ? '\n' + savings : '') +
      (price ? '\n-# ' + t('Steam fiyatı alındı: ', 'Steam price fetched: ') +
        relative(hero.priceObservedAt ?? options.capturedAt, t('Zaman bilgisi yok', 'Time unavailable')) : '')));
  } else {
    root.addTextDisplayComponents(display('## ' + (checkState?.lastSuccessOnSaleCount == null
      ? '⏳ ' + t('İlk kontrol bekleniyor', 'Waiting for the first check')
      : '🎯 ' + t('Bir sonraki oyunun burada.', 'Your next game starts here.')) +
      '\n' + t('🎮 Oyunlarım’dan bir oyun seç ve hedef fiyatını belirle.', 'Pick a game in 🎮 My games and set your target price.')));
  }
  divider();

  const tracked = options.trackedGameCount ?? checkState?.lastSuccessCheckedCount ?? '—';
  const matching = options.eligibleDealCount ?? '—';
  root.addTextDisplayComponents(display(
    '🎮 **' + tracked + '** ' + t('oyun', 'games') + '　✅ **' + matching + '** ' + t('uygun fırsat', 'matching deals') +
    '　📬 **' + pending + '** ' + t('bildirim sırada', 'alerts queued') +
    '\n-# 🕒 ' + t('Son kontrol ', 'Last check ') + relative(checkState?.lastSuccessCompletedAt, t('henüz yok', 'not yet')) +
    ' · ' + t('sonraki ', 'next ') + (config.enabled
      ? relative(checkState?.nextScheduledAt, t('planlanıyor', 'scheduling'))
      : t('takip duraklatıldı', 'tracking paused'))));
  if (failed || partial) root.addTextDisplayComponents(display('> ⚠️ ' +
    (failed ? t('Son kontrol tamamlanamadı; gösterilen fiyatlar önceki kontrolden.', 'The last check failed; prices shown are from an earlier check.')
      : t(partial + ' oyunun fiyatı doğrulanamadı.', 'Prices for ' + partial + ' games could not be verified.'))));
  if (blocked) root.addTextDisplayComponents(display('> 🔴 ' +
    t('Discord DM erişimini aç, sonra ⚙️ Ayarlar’dan Test DM gönder.', 'Allow Discord DMs, then send a Test DM from ⚙️ Settings.')));
  root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('check', t('Şimdi kontrol et', 'Check now'), '🔄'),
    button('refresh', t('Paneli yenile', 'Refresh panel'), '♻️'),
  ));
  divider();
  root.addActionRowComponents(buildTabBar('dealio', sessionId, language, { active: 'home', disabled }));
  root.addTextDisplayComponents(display(dealioFooter(language)));
  assertComponentsV2Limit([root]);
  return root;
}

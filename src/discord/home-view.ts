import { addArtwork } from './ui/game-artwork.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import type { StatusDashboardResult } from '../application/status-service.js';
import type { StatusV2Options } from './status-view-v2.js';
import { storeCountryLabel } from '../domain/store-country.js';
import { formatMinorPrice, sanitizeGameName } from './notification-messages.js';
import { assertComponentsV2Limit } from './ui/components-v2.js';
import { dealioBrand } from './ui/brand.js';
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
    : failed || partial ? dealioBrand.colors.warning : dealioBrand.colors.primary);
  const button = (action: string, label: string, emoji: string) => new ButtonBuilder()
    .setCustomId('dealio:' + sessionId + ':' + action).setLabel(label).setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const divider = () => root.addSeparatorComponents(new SeparatorBuilder()
    .setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  root.addTextDisplayComponents(display(
    '-# DEALIO / ' + t('KİŞİSEL STEAM ASİSTANIN', 'YOUR PERSONAL STEAM ASSISTANT') +
    '\n# ' + t('Wishlist’in. Senin kuralların.', 'Your wishlist. Your rules.') +
    '\n' + t('İstediğin oyunu, istediğin fiyata yakala.', 'Find the games you want at the price you choose.'),
  ));
  root.addTextDisplayComponents(display(
    (blocked ? '🔴 ' + t('DM erişimi engelli', 'DM access blocked') : config.enabled
      ? '🟢 ' + t('Takip açık', 'Tracking active') : '⏸️ ' + t('Takip duraklatıldı', 'Tracking paused')) +
    ' · ' + storeCountryLabel(config.storeCountryCode, language) + ' · ' + (tr ? 'Türkçe' : 'English'),
  ));
  divider();

  const hero = options.featuredDeal ?? options.heroGame;
  if (hero?.price?.currency) {
    const price = hero.price;
    root.addTextDisplayComponents(display('-# ' + (options.featuredDeal
      ? t('KURALINA UYGUN FIRSAT', 'A DEAL THAT MATCHES YOUR RULE')
      : t('WISHLIST’İNDEN', 'FROM YOUR WISHLIST'))));
    addArtwork(root, hero);
    const currentPrice = formatMinorPrice(price.finalMinor, price.currency!, language);
    const previousPrice = price.initialMinor > price.finalMinor
      ? '  ~~' + formatMinorPrice(price.initialMinor, price.currency!, language) + '~~' : '';
    const discount = price.discountPercent > 0 ? '  ·  ' + t('%', '') + price.discountPercent + t(' indirim', '% off') : '';
    root.addTextDisplayComponents(display('## [' + sanitizeGameName(hero.name).slice(0, 100) +
      '](https://store.steampowered.com/app/' + hero.appId + ')\n**' + currentPrice + '**' + previousPrice + discount +
      '\n-# ' + t('Fiyat gözlemi: ', 'Price observed: ') +
      relative(hero.priceObservedAt ?? options.capturedAt, t('Zaman bilgisi yok', 'Time unavailable'))));
  } else if (hero) {
    addArtwork(root, hero);
    root.addTextDisplayComponents(display('## [' + sanitizeGameName(hero.name).slice(0, 100) +
      '](https://store.steampowered.com/app/' + hero.appId + ')\n' + t('Fiyat doğrulanamadı', 'Price unavailable')));
  } else {
    root.addTextDisplayComponents(display('## ' + (checkState?.lastSuccessOnSaleCount == null
      ? t('İlk kontrol bekleniyor', 'Waiting for the first check')
      : t('Bir sonraki oyunun burada.', 'Your next game starts here.')) +
      '\n' + t('Wishlist’ini aç, bir oyun seç ve hedef fiyatını belirle.', 'Open your wishlist, choose a game and set your target price.')));
  }
  const tracked = options.trackedGameCount ?? checkState?.lastSuccessCheckedCount ?? '—';
  const matching = options.eligibleDealCount ?? '—';
  root.addTextDisplayComponents(display(
    '**' + tracked + '** ' + t('oyun', 'games') + '　·　**' + matching + '** ' +
    t('kuralına uygun', 'matching your rules') + '　·　**' + pending + '** ' + t('bildirim sırada', 'alerts queued'),
  ));
  if (failed || partial) root.addTextDisplayComponents(display('> ⚠️ ' +
    (failed ? t('Son kontrol tamamlanamadı; gösterilen fiyatlar önceki gözlemlerden.', 'The last check failed; prices shown are from earlier observations.')
      : t(partial + ' oyunun fiyatı doğrulanamadı.', 'Prices for ' + partial + ' games could not be verified.'))));
  if (blocked) root.addTextDisplayComponents(display('> ' +
    t('Discord DM erişimini açıp ayarlardan Test DM’i gönder.', 'Allow Discord DMs, then send a Test DM from settings.')));
  divider();

  const pref = options.notificationPreference;
  const rhythm = pref?.mode === 'quiet'
    ? t('Rahatsız etme ', 'Do not disturb ') + clock(pref.quietStart) + '–' + clock(pref.quietEnd)
    : pref?.mode === 'digest'
      ? t('Günlük özet ', 'Daily digest at ') + clock(pref.digestMinute)
      : t('İndirim bulununca hemen', 'As soon as a deal is found');
  root.addTextDisplayComponents(display('🔔 ' + t('Bildirim zamanı: ', 'Alert timing: ') + '**' + rhythm + '**' +
    '\n-# ' + t('Son kontrol: ', 'Last check: ') + relative(checkState?.lastSuccessCompletedAt, t('Henüz yok', 'Not yet')) +
    ' · ' + t('Sonraki: ', 'Next: ') + (config.enabled
      ? relative(checkState?.nextScheduledAt, t('Planlanıyor', 'Scheduling'))
      : t('Takip duraklatıldı', 'Tracking paused'))));
  root.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('check', t('Şimdi kontrol et', 'Check now'), '🔄'),
    button('refresh', t('Paneli yenile', 'Refresh panel'), '♻️'),
  ));
  divider();
  root.addActionRowComponents(buildTabBar('dealio', sessionId, language, { active: 'home', disabled }));
  root.addTextDisplayComponents(display('-# ' + t('Dealio · Fiyatlar Steam mağaza para birimindedir.', 'Dealio · Prices use your Steam store currency.')));
  assertComponentsV2Limit([root]);
  return root;
}

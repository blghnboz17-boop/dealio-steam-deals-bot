import { artworkAccessory, addArtwork } from './ui/game-artwork.js';
import { defaultPollIntervalHours } from '../config/environment.js';
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
import type {
  InitialWishlistSale,
  InitialWishlistSummary,
} from '../application/initial-wishlist-summary-service.js';
import type { NotificationSendOptions, SaleNotification } from '../application/notification-service.js';
import { historicalLowLine, priceHistoryCredit } from './price-history-text.js';
import { countryDisplay, hotDealPercent, hotPrefix, openPanelButton, priceLine, savingsLine } from './ui/design.js';
import type { Language } from '../domain/user-config.js';
import { sanitizeGameName } from './notification-messages.js';
import { sortInitialWishlistSales, type InitialSummaryPresentationOptions } from './initial-wishlist-summary-messages.js';
import { messagesFor } from './messages.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, componentsV2TextLength, dealioFooter } from './ui/components-v2.js';

/** The closing row of every Dealio DM: open the panel, or support the project. */
function messageActionRow(language: Language): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    openPanelButton(language),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://buymeacoffee.com/dealio')
      .setEmoji('☕').setLabel(language === 'tr' ? 'Bağış yap' : 'Donate'),
  );
}

/** One header for every alert: the kicker names the kind, the emoji its strength. */
function saleHeader(notifications: readonly SaleNotification[], language: Language, options: NotificationSendOptions): string {
  const tr = language === 'tr';
  const target = notifications.some((notification) => notification.reason?.startsWith('target:'));
  const emoji = options.digest ? '📬' : target ? '🎯'
    : notifications.some((notification) => notification.discountPercent >= hotDealPercent) ? '🔥' : '🔔';
  const kind = options.digest ? (tr ? 'GÜNLÜK ÖZET' : 'DAILY DIGEST') : (tr ? 'İNDİRİM' : 'SALE');
  const title = options.digest ? (tr ? 'Günlük wishlist özetin' : 'Your daily wishlist digest')
    : target ? (tr ? 'Beklediğin fiyat geldi' : 'Your price target was reached')
    : saleTitle(language, notifications.length);
  // A test is the real alert with a TEST tag, so the user sees exactly what will arrive.
  return `-# ${options.test ? '🧪' : emoji} DEALIO · ${options.test ? `TEST · ${kind}` : kind}\n# ${emoji} ${title}`;
}

export function buildSaleNotificationPanel(
  notifications: readonly SaleNotification[],
  language: Language,
  options: NotificationSendOptions = {},
): ContainerBuilder {
  if (notifications.length === 0 || notifications.length > 10) {
    throw new Error('A Dealio notification panel must contain between 1 and 10 games');
  }
  const messages = messagesFor(language);
  const container = new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(saleHeader(notifications, language, options)),
      new TextDisplayBuilder().setContent(options.test
        ? `> 🧪 ${options.testSource === 'example' ? messages.testNotificationExampleDescription : messages.testNotificationDescription}`
        : saleDescription(language, notifications.length)),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const gameTexts: Array<{ display: TextDisplayBuilder; name: string; heading: (title: string) => string; details: string }> = [];
  for (const notification of notifications) {
    const storeUrl = `https://store.steampowered.com/app/${notification.appId}/`;
    const name = sanitizeGameName(notification.gameName);
    const price = {
      finalMinor: notification.finalPriceMinor,
      initialMinor: notification.normalPriceMinor,
      discountPercent: notification.discountPercent,
      currency: notification.currency,
    };
    const savings = savingsLine(price, language);
    const details = [
      priceLine(price, language),
      ...(notification.reason?.startsWith('target:') ? [language==='tr'?'🎯 Hedef fiyatına ulaştı.':'🎯 Your target price was reached.']:[]),
      ...historicalLowLines(notification, language),
      ...(savings ? [savings] : []),
      `-# ${countryDisplay(notification.storeCountryCode, language)}`,
    ].join('\n');
    const heading = (title: string) => `## ${hotPrefix(notification.discountPercent)}[${title}](${storeUrl})`;
    const display = new TextDisplayBuilder().setContent(`${heading(name)}\n${details}`);
    gameTexts.push({ display, name, heading, details });
    container.addSectionComponents(
      artworkAccessory(new SectionBuilder().addTextDisplayComponents(display), notification),
    );
  }
  if (notifications.some((notification) => historicalLowLines(notification, language).length > 0)) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(priceHistoryCredit(language)));
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)))
    .addActionRowComponents(messageActionRow(language));
  // Legacy durable batches retain all their games and their delivery identity.
  // Shorten only titles when necessary to fit Discord's combined text budget.
  let excess = componentsV2TextLength([container]) - 4000;
  for (const game of [...gameTexts].sort((a, b) => b.name.length - a.name.length)) {
    if (excess <= 0) break;
    const limit = Math.max(16, game.name.length - excess);
    if (limit >= game.name.length) continue;
    const shortName = game.name.slice(0, limit - 3).replace(/\\$/, '') + '...';
    game.display.setContent(`${game.heading(shortName)}\n${game.details}`);
    excess -= game.name.length - shortName.length;
  }
  assertComponentsV2Limit([container]);
  return container;
}

function historicalLowLines(notification: SaleNotification, language: Language): string[] {
  const line = notification.historicalLow
    && historicalLowLine(notification.finalPriceMinor, notification.currency, notification.historicalLow, language);
  return line ? [line] : [];
}

export interface InitialWishlistV2Page {
  readonly components: readonly ContainerBuilder[];
  readonly pageIndex: number;
  readonly totalPages: number;
}

export function buildInitialWishlistV2Page(
  summary: InitialWishlistSummary,
  options: InitialSummaryPresentationOptions,
  sessionId: string,
  requestedPageIndex: number,
  disabled = false,
): InitialWishlistV2Page {
  const messages = messagesFor(summary.language);
  const sales = sortInitialWishlistSales(summary.sales);
  const totalPages = Math.max(1, sales.length);
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), totalPages - 1);
  const sale = sales[pageIndex];
  const profileUrl = `https://steamcommunity.com/profiles/${summary.steamId64}`;
  const container = new ContainerBuilder().setAccentColor(dealioBrand.colors.success);
  if (options.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(options.bannerUrl).setDescription('Dealio'),
      ),
    );
  }
  if (options.avatarUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Dealio**'))
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(options.avatarUrl).setDescription('Dealio'),
        ),
    );
  }
  const tr = summary.language === 'tr';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ✨ DEALIO · ${tr ? 'KURULUM TAMAM' : 'SETUP COMPLETE'}\n# 👋 ${messages.initialSummaryTitle}\n` +
      messages.initialSummaryDescription(summary.sales.length, summary.failedItemCount)),
    new TextDisplayBuilder().setContent([
      `👤 [${maskSteamId(summary.steamId64)}](${profileUrl})　${countryDisplay(summary.storeCountryCode, summary.language)}　🌐 ${tr ? 'Türkçe' : 'English'}`,
      `🎮 **${summary.totalGameCount}** ${tr ? 'oyun' : 'games'}${summary.failedItemCount > 0 ? ` · ${messages.wishlistFailedItems(summary.failedItemCount)}` : ''}` +
        `　🔔 ${tr ? `%${summary.minimumDiscountPercent} ve üzeri indirimlerde DM` : `DMs for ${summary.minimumDiscountPercent}%+ off`}`,
      `-# 🔄 ${messages.setupWizardFrequency(options.pollIntervalHours ?? defaultPollIntervalHours)} · ${tr ? 'Oyun kuralları, bildirim saatleri ve ayarlar Dealio panelinde.' : 'Game rules, alert timing and settings live in the Dealio panel.'}`,
    ].join('\n')),
  );

  if (sale) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    addArtwork(container, sale)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(initialSaleText(sale, summary)));
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(summary.failedItemCount > 0
        ? `> ⚠️ ${messages.initialSummaryIncomplete}` : `> ✅ ${messages.initialSummaryNoSales}`),
    );
  }

  if (totalPages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`dealio-summary:${sessionId}:previous`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(disabled || pageIndex === 0),
        new ButtonBuilder().setCustomId(`dealio-summary:${sessionId}:page`).setLabel(`${pageIndex + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`dealio-summary:${sessionId}:next`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(disabled || pageIndex >= totalPages - 1),
      ),
    );
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(summary.language)))
    .addActionRowComponents(messageActionRow(summary.language));
  assertComponentsV2Limit([container]);
  return { components: [container], pageIndex, totalPages };
}

function initialSaleText(sale: InitialWishlistSale, summary: InitialWishlistSummary): string {
  const messages = messagesFor(summary.language);
  const storeUrl = `https://store.steampowered.com/app/${sale.appId}/`;
  const price = {
    finalMinor: sale.finalPriceMinor,
    initialMinor: sale.normalPriceMinor,
    discountPercent: sale.discountPercent,
    currency: sale.currency,
  };
  const savings = savingsLine(price, summary.language);
  return [
    `## ${hotPrefix(sale.discountPercent)}[${sanitizeGameName(sale.gameName)}](${storeUrl})`,
    priceLine(price, summary.language),
    ...(savings ? [savings] : []),
    `-# ${countryDisplay(summary.storeCountryCode, summary.language)} · [${messages.openSteamStore}](${storeUrl})`,
  ].join('\n');
}

function maskSteamId(steamId64: string): string {
  return `${steamId64.slice(0, 5)}••••••••${steamId64.slice(-4)}`;
}

function saleTitle(language: Language, count: number): string {
  return language === 'tr'
    ? count === 1 ? 'Wishlistinde yeni bir indirim var' : `Wishlistinde ${count} yeni indirim var`
    : count === 1 ? 'A new wishlist sale is live' : `${count} new wishlist sales are live`;
}

function saleDescription(language: Language, count: number): string {
  return language === 'tr'
    ? `${count} oyun bildirim eşiğini geçti. Fiyatlar seçtiğin Steam mağaza bölgesinden alındı.`
    : `${count} games crossed your alert threshold. Prices come from your selected Steam Store region.`;
}

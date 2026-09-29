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
import { storeCountryLabel } from '../domain/store-country.js';
import type { Language } from '../domain/user-config.js';
import { formatMinorPrice, sanitizeGameName } from './notification-messages.js';
import { sortInitialWishlistSales, type InitialSummaryPresentationOptions } from './initial-wishlist-summary-messages.js';
import { messagesFor } from './messages.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, componentsV2TextLength, dealioFooter } from './ui/components-v2.js';

function donationRow(language: Language): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL('https://buymeacoffee.com/dealio')
      .setEmoji('☕').setLabel(language === 'tr' ? 'Bağış yap' : 'Donate'),
  );
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
    .setAccentColor(options.test ? dealioBrand.colors.accent : dealioBrand.colors.success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${options.test ? '🧪 ' : ''}${options.test ? messages.testNotificationTitle : options.digest ? (language==='tr'?'Günlük wishlist özetin':'Your daily wishlist digest')
          : notifications.some(n=>n.reason?.startsWith('target:')) ? (language==='tr'?'Beklediğin fiyat geldi':'Your price target was reached')
          : saleTitle(language, notifications.length)}`,
      ),
      new TextDisplayBuilder().setContent(
        options.test ? messages.testNotificationDescription : saleDescription(language, notifications.length),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const gameTexts: Array<{ display: TextDisplayBuilder; name: string; storeUrl: string; details: string }> = [];
  for (const notification of notifications) {
    const storeUrl = `https://store.steampowered.com/app/${notification.appId}/`;
    const normalPrice = formatMinorPrice(notification.normalPriceMinor, notification.currency, language);
    const finalPrice = formatMinorPrice(notification.finalPriceMinor, notification.currency, language);
    const discount = language === 'tr'
      ? `%${notification.discountPercent} indirim`
      : `${notification.discountPercent}% off`;
    const name = sanitizeGameName(notification.gameName);
    const savings = formatMinorPrice(
      notification.normalPriceMinor - notification.finalPriceMinor, notification.currency, language,
    );
    const details = [
      notification.discountPercent>0 ? `**${finalPrice}** · ${discount} · ~~${normalPrice}~~` : `**${finalPrice}**`,
      ...(notification.reason?.startsWith('target:') ? [language==='tr'?'Hedef fiyatına ulaştı.':'Your target price was reached.']:[]),
      `${language === 'tr' ? 'Kazancın' : 'You save'} **${savings}**`,
      `-# ${storeCountryLabel(notification.storeCountryCode, language)}`,
    ].join('\n');
    const display = new TextDisplayBuilder().setContent(`## [${name}](${storeUrl})\n${details}`);
    gameTexts.push({ display, name, storeUrl, details });
    container.addSectionComponents(
      artworkAccessory(new SectionBuilder().addTextDisplayComponents(display), notification),
    );
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)))
    .addActionRowComponents(donationRow(language));
  // Legacy durable batches retain all their games and their delivery identity.
  // Shorten only titles when necessary to fit Discord's combined text budget.
  let excess = componentsV2TextLength([container]) - 4000;
  for (const game of [...gameTexts].sort((a, b) => b.name.length - a.name.length)) {
    if (excess <= 0) break;
    const limit = Math.max(16, game.name.length - excess);
    if (limit >= game.name.length) continue;
    const shortName = game.name.slice(0, limit - 3).replace(/\\$/, '') + '...';
    game.display.setContent(`## [${shortName}](${game.storeUrl})\n${game.details}`);
    excess -= game.name.length - shortName.length;
  }
  assertComponentsV2Limit([container]);
  return container;
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
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ✅ ${messages.initialSummaryTitle}`),
    new TextDisplayBuilder().setContent(messages.initialSummaryDescription(summary.sales.length, summary.failedItemCount)),
    new TextDisplayBuilder().setContent([
      `**${messages.initialSummaryAccount}:** [${maskSteamId(summary.steamId64)}](${profileUrl})`,
      `**${messages.initialSummaryRegion}:** ${storeCountryLabel(summary.storeCountryCode, summary.language)}`,
      `**${messages.initialSummaryLanguage}:** ${summary.language === 'tr' ? 'Türkçe' : 'English'}`,
      `**${messages.initialSummarySchedule}:** ${messages.setupWizardFrequency(options.pollIntervalHours ?? defaultPollIntervalHours)}`,
      `**${messages.initialSummaryThreshold}:** ${summary.language === 'tr' ? `%${summary.minimumDiscountPercent}` : `${summary.minimumDiscountPercent}%`}`,
      `**${messages.initialSummaryWishlist}:** ${summary.totalGameCount}${summary.failedItemCount > 0 ? ` · ${messages.wishlistFailedItems(summary.failedItemCount)}` : ''}`,
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
    .addActionRowComponents(donationRow(summary.language));
  assertComponentsV2Limit([container]);
  return { components: [container], pageIndex, totalPages };
}

function initialSaleText(sale: InitialWishlistSale, summary: InitialWishlistSummary): string {
  const messages = messagesFor(summary.language);
  const storeUrl = `https://store.steampowered.com/app/${sale.appId}/`;
  return [
    `## [${sanitizeGameName(sale.gameName)}](${storeUrl})`,
    `🔥 ${messages.wishlistDiscountValue(sale.discountPercent)}`,
    `~~${formatMinorPrice(sale.normalPriceMinor, sale.currency, summary.language)}~~ → **${formatMinorPrice(sale.finalPriceMinor, sale.currency, summary.language)}**`,
    `-# ${storeCountryLabel(summary.storeCountryCode, summary.language)} · [${messages.openSteamStore}](${storeUrl})`,
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

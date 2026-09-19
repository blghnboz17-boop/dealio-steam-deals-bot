import { defaultPollIntervalHours } from '../config/environment.js';
import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
} from 'discord.js';
import type {
  InitialWishlistSale,
  InitialWishlistSummary,
} from '../application/initial-wishlist-summary-service.js';
import { storeCountryLabel } from '../domain/store-country.js';
import { formatMinorPrice, sanitizeGameName } from './notification-messages.js';
import { messagesFor } from './messages.js';
import { dealioBrand, withDealioBrand } from './ui/brand.js';

export interface InitialSummaryPresentationOptions {
  readonly bannerUrl?: string;
  readonly avatarUrl?: string;
  readonly pollIntervalHours?: number;
}

export const initialSummaryGamesPerPage = 1;

export interface InitialSummaryPage {
  readonly embeds: readonly APIEmbed[];
  readonly components: readonly APIActionRowComponent<APIButtonComponent>[];
  readonly pageIndex: number;
  readonly totalPages: number;
}

export function buildInitialWishlistPage(
  summary: InitialWishlistSummary,
  options: InitialSummaryPresentationOptions,
  sessionId: string,
  requestedPageIndex: number,
  disabled = false,
): InitialSummaryPage {
  const sortedSales = sortInitialWishlistSales(summary.sales);
  const totalPages = Math.max(1, Math.ceil(sortedSales.length / initialSummaryGamesPerPage));
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), totalPages - 1);
  const firstSale = pageIndex * initialSummaryGamesPerPage;
  const pageSales = sortedSales.slice(firstSale, firstSale + initialSummaryGamesPerPage);
  const hero = buildInitialWishlistHeroEmbed(summary, options);
  const pageLabel = summary.language === 'tr'
    ? `Sayfa ${pageIndex + 1}/${totalPages}`
    : `Page ${pageIndex + 1}/${totalPages}`;
  hero.footer = {
    text: `${hero.footer?.text ?? messagesFor(summary.language).initialSummaryFooter} · ${pageLabel}`,
  };

  return {
    embeds: [hero, ...pageSales.map((sale) => buildInitialWishlistSaleEmbed(sale, summary))],
    components: totalPages > 1
      ? buildInitialWishlistPageComponents(sessionId, pageIndex, totalPages, disabled)
      : [],
    pageIndex,
    totalPages,
  };
}

export function buildInitialWishlistPageComponents(
  sessionId: string,
  pageIndex: number,
  totalPages: number,
  disabled = false,
): APIActionRowComponent<APIButtonComponent>[] {
  return [{
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `dealio-summary:${sessionId}:previous`,
      emoji: { name: '◀️' },
      disabled: disabled || pageIndex <= 0,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `dealio-summary:${sessionId}:page`,
      label: `${pageIndex + 1} / ${totalPages}`,
      disabled: true,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `dealio-summary:${sessionId}:next`,
      emoji: { name: '▶️' },
      disabled: disabled || pageIndex >= totalPages - 1,
    }],
  }];
}

export function parseInitialSummaryPageAction(
  customId: string,
): { readonly sessionId: string; readonly action: 'previous' | 'next' } | null {
  const match = /^dealio-summary:([A-Za-z0-9_-]+):(previous|next)$/.exec(customId);
  return match?.[1] && (match[2] === 'previous' || match[2] === 'next')
    ? { sessionId: match[1], action: match[2] }
    : null;
}

export function buildInitialWishlistHeroEmbed(
  summary: InitialWishlistSummary,
  options: InitialSummaryPresentationOptions = {},
): APIEmbed {
  const messages = messagesFor(summary.language);
  const profileUrl = `https://steamcommunity.com/profiles/${summary.steamId64}`;
  return withDealioBrand({
    color: dealioBrand.colors.success,
    title: `✅ ${messages.initialSummaryTitle}`,
    description: messages.initialSummaryDescription(summary.sales.length, summary.failedItemCount),
    fields: [{
      name: messages.initialSummaryAccount,
      value: `[${summary.steamId64.slice(0, 5)}••••••••${summary.steamId64.slice(-4)}](${profileUrl})`,
      inline: true,
    }, {
      name: messages.initialSummaryRegion,
      value: `**${storeCountryLabel(summary.storeCountryCode, summary.language)}**`,
      inline: true,
    }, {
      name: messages.initialSummaryLanguage,
      value: `**${summary.language === 'tr' ? 'Türkçe' : 'English'}**`,
      inline: true,
    }, {
      name: messages.initialSummarySchedule,
      value: `**${messages.setupWizardFrequency(options.pollIntervalHours ?? defaultPollIntervalHours)}**`,
      inline: true,
    }, {
      name: messages.initialSummaryThreshold,
      value: `**%${summary.minimumDiscountPercent}**`,
      inline: true,
    }, {
      name: messages.initialSummaryWishlist,
      value: summary.failedItemCount > 0
        ? `**${summary.totalGameCount}** · ${messages.wishlistFailedItems(summary.failedItemCount)}`
        : `**${summary.totalGameCount}**`,
      inline: true,
    }],
    footer: { text: messages.initialSummaryFooter },
    timestamp: summary.capturedAt,
  }, options);
}

export function buildInitialWishlistSaleEmbed(
  sale: InitialWishlistSale,
  summary: Pick<InitialWishlistSummary, 'storeCountryCode' | 'capturedAt' | 'language'>,
): APIEmbed {
  const messages = messagesFor(summary.language);
  const storeUrl = `https://store.steampowered.com/app/${sale.appId}/`;
  return {
    color: dealioBrand.colors.primary,
    title: sanitizeGameName(sale.gameName),
    url: storeUrl,
    description: messages.wishlistDiscountValue(sale.discountPercent),
    fields: [{
      name: messages.wishlistNormalPriceLabel,
      value: `~~${formatMinorPrice(sale.normalPriceMinor, sale.currency, summary.language)}~~`,
      inline: true,
    }, {
      name: messages.wishlistCurrentPriceLabel,
      value: `**${formatMinorPrice(sale.finalPriceMinor, sale.currency, summary.language)}**`,
      inline: true,
    }, {
      name: messages.statusStoreRegionLabel,
      value: storeCountryLabel(summary.storeCountryCode, summary.language),
      inline: true,
    }, {
      name: '\u200b',
      value: `[${messages.openSteamStore}](${storeUrl})`,
    }],
    image: {
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sale.appId}/header.jpg`,
    },
    footer: { text: messages.initialSummaryFooter },
    timestamp: summary.capturedAt,
  };
}

export function sortInitialWishlistSales(
  sales: readonly InitialWishlistSale[],
): InitialWishlistSale[] {
  return [...sales].sort((left, right) =>
    right.discountPercent - left.discountPercent || left.appId - right.appId
  );
}

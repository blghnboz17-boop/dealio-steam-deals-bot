import type { APIEmbed } from 'discord.js';
import type {
  InitialWishlistSale,
  InitialWishlistSummary,
} from '../application/initial-wishlist-summary-service.js';
import { storeCountryLabel } from '../domain/store-country.js';
import {
  formatMinorPrice,
  sanitizeGameName,
} from './notification-messages.js';

export const initialWishlistSaleMessage = `Your Dealio setup is complete.

These are the games currently on sale in your Steam wishlist. This is an initial snapshot to confirm that Dealio is working. These games will not trigger another notification unless they first leave their sale state and go on sale again.

Future notifications will follow your global and game-specific discount thresholds.`;

export const initialWishlistNoSaleMessage = `Your Dealio setup is complete.

There are currently no discounted games in your Steam wishlist. Dealio is working and will notify you when a wishlist game goes on sale.

Future notifications will follow your global and game-specific discount thresholds.`;

export const initialWishlistContinuationMessage =
  'Your initial Dealio wishlist snapshot continues below.';

export function buildInitialWishlistSaleEmbed(
  sale: InitialWishlistSale,
  summary: Pick<InitialWishlistSummary, 'storeCountryCode' | 'capturedAt'>,
): APIEmbed {
  const storeUrl = `https://store.steampowered.com/app/${sale.appId}/`;
  return {
    color: 0x66c0f4,
    title: sanitizeGameName(sale.gameName),
    url: storeUrl,
    description: `[Open in Steam Store](${storeUrl})`,
    fields: [
      {
        name: 'Normal price',
        value: `~~${formatMinorPrice(sale.normalPriceMinor, sale.currency, 'en')}~~`,
        inline: true,
      },
      {
        name: 'Current price',
        value: `**${formatMinorPrice(sale.finalPriceMinor, sale.currency, 'en')}**`,
        inline: true,
      },
      { name: 'Discount', value: `**${sale.discountPercent}%**`, inline: true },
      { name: 'Currency', value: sale.currency, inline: true },
      {
        name: 'Steam Store country',
        value: storeCountryLabel(summary.storeCountryCode, 'en'),
        inline: true,
      },
    ],
    footer: { text: 'Dealio · Initial wishlist snapshot' },
    timestamp: summary.capturedAt,
  };
}

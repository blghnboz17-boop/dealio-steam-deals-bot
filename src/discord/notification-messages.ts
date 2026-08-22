import type { APIEmbed } from 'discord.js';
import type {
  NotificationSendOptions,
  SaleNotification,
} from '../application/notification-service.js';
import type { Language } from '../domain/user-config.js';
import { messagesFor } from './messages.js';

const maxGameNameLength = 256;

export function sanitizeGameName(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const escaped = normalized.replace(/([\\`*_{}\[\]()|>~<>])/g, '\\$1');

  if (escaped.length <= maxGameNameLength) {
    return escaped;
  }

  return `${escaped.slice(0, maxGameNameLength - 3).replace(/\\$/, '')}...`;
}

export function formatMinorPrice(
  minorValue: number,
  currency: string,
  language: Language,
): string {
  return new Intl.NumberFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorValue / 100);
}

export function buildSaleNotificationEmbed(
  notification: SaleNotification,
  language: Language,
  options: NotificationSendOptions = {},
): APIEmbed {
  const messages = messagesFor(language);
  const normalPrice = formatMinorPrice(
    notification.normalPriceMinor,
    notification.currency,
    language,
  );
  const finalPrice = formatMinorPrice(
    notification.finalPriceMinor,
    notification.currency,
    language,
  );
  const storeUrl = `https://store.steampowered.com/app/${notification.appId}/`;
  const gameName = sanitizeGameName(notification.gameName);

  return {
    color: 0x66c0f4,
    author: options.test ? { name: messages.testNotificationTitle } : undefined,
    title: gameName,
    url: storeUrl,
    description: options.test
      ? messages.testNotificationDescription
      : messages.saleNotificationDescription,
    fields: [
      {
        name: messages.discountLabel,
        value: language === 'tr'
          ? `%${notification.discountPercent}`
          : `${notification.discountPercent}%`,
        inline: true,
      },
      { name: messages.normalPriceLabel, value: `~~${normalPrice}~~`, inline: true },
      { name: messages.salePriceLabel, value: `**${finalPrice}**`, inline: true },
      { name: '\u200b', value: `[${messages.openSteamStore}](${storeUrl})` },
    ],
    image: {
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${notification.appId}/header.jpg`,
    },
    footer: { text: messages.notificationFooter },
    timestamp: notification.createdAt,
  };
}

export function embedTextLength(embed: APIEmbed): number {
  return (embed.title?.length ?? 0)
    + (embed.description?.length ?? 0)
    + (embed.author?.name.length ?? 0)
    + (embed.footer?.text.length ?? 0)
    + (embed.fields ?? []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    );
}

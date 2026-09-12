import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ComponentType,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
} from 'discord.js';
import type { WishlistItem } from '../domain/steam.js';
import { storeCountryLabel, type StoreCountryCode } from '../domain/store-country.js';
import type { Language } from '../domain/user-config.js';
import { embedTextLength, formatMinorPrice } from './notification-messages.js';
import { messagesFor } from './messages.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { uiCopy } from './ui/copy.js';

export const wishlistPageSize = 3;
export const wishlistEmbedColors = {
  sale: dealioBrand.colors.success,
  normal: dealioBrand.colors.neutral,
  free: dealioBrand.colors.warning,
  unknown: dealioBrand.colors.muted,
} as const;
const maximumEmbedsPerMessage = 10;
const maximumEmbedTextPerMessage = 6_000;

export interface WishlistSnapshot {
  readonly items: readonly WishlistItem[];
  readonly failedItemCount: number;
  readonly capturedAt: string;
  readonly storeCountryCode?: StoreCountryCode;
  readonly globalMinimumDiscountPercent?: number;
  readonly gameMinimumDiscountOverrides?: ReadonlyMap<number, number>;
}

export type WishlistAction = 'previous' | 'next' | 'close' | {
  readonly type: 'game';
  readonly appId: number;
};
export type WishlistControls = 'active' | 'disabled' | 'hidden';

export interface WishlistPage {
  readonly embeds: APIEmbed[];
  readonly components: APIActionRowComponent<APIButtonComponent>[];
  readonly pageIndex: number;
  readonly pageCount: number;
}

export type WishlistV2View = 'all' | 'sale' | 'discount' | 'recent';

export interface WishlistV2Page {
  readonly components: readonly ContainerBuilder[];
  readonly items: readonly WishlistItem[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly totalFilteredItems: number;
}

export function buildWishlistV2Page(
  snapshot: WishlistSnapshot,
  language: Language,
  requestedPageIndex: number,
  sessionId: string,
  view: WishlistV2View = 'all',
  controls: WishlistControls = 'active',
): WishlistV2Page {
  const text = uiCopy(language);
  const filtered = filterAndSortWishlist(snapshot.items, view);
  const pageCount = Math.max(1, Math.ceil(filtered.length / wishlistPageSize));
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), pageCount - 1);
  const items = filtered.slice(pageIndex * wishlistPageSize, (pageIndex + 1) * wishlistPageSize);
  const disabled = controls === 'disabled';
  const container = new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.primary)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${text.wishlistTitle}`),
      new TextDisplayBuilder().setContent(text.wishlistSummary(
        items.length,
        snapshot.items.length + snapshot.failedItemCount,
        snapshot.items.filter((item) => item.onSale === true).length,
      )),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );

  const capturedAt = Math.floor(new Date(snapshot.capturedAt).getTime() / 1000);
  const unknownCount = snapshot.items.filter((item) => item.price === null || item.onSale === null).length;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `-# ${storeCountryLabel(snapshot.storeCountryCode ?? 'TR', language)} · ${language === 'tr' ? 'Fiyat kontrolü' : 'Prices checked'}: ${Number.isSafeInteger(capturedAt) ? `<t:${capturedAt}:R>` : text.never}`,
    ...(snapshot.failedItemCount + unknownCount > 0 ? [
      language === 'tr'
        ? `> ⚠️ **${snapshot.failedItemCount + unknownCount} oyunun** fiyatı doğrulanamadı. Bu oyunlar için indirim varsayılmadı.`
        : `> ⚠️ Prices for **${snapshot.failedItemCount + unknownCount} games** could not be verified. No sale was assumed.`,
    ] : []),
  ].join('\n')));

  if (items.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`> ${snapshot.items.length === 0 && snapshot.failedItemCount === 0
        ? (language === 'tr'
          ? 'Wishlistin henüz boş. Steam’de istediğin oyunları listene ekle, ardından /wishlist ile tekrar aç.'
          : 'Your wishlist is empty. Add games on Steam, then open /wishlist again.')
        : text.wishlistEmptyFiltered}`),
    );
  } else {
    for (const [index, item] of items.entries()) {
      if (index > 0) container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );
      container.addSectionComponents(buildWishlistV2GameSection(item, snapshot, language));
    }
  }

  if (controls !== 'hidden') {
    const viewSelect = new StringSelectMenuBuilder()
      .setCustomId(`wishlist-v2:${sessionId}:view`)
      .setPlaceholder(text.wishlistViewPlaceholder)
      .setDisabled(disabled)
      .addOptions([
        ['all', text.wishlistAll, '📚'],
        ['sale', text.wishlistSale, '🏷️'],
        ['discount', text.wishlistDiscount, '🔥'],
        ['recent', text.wishlistRecent, '🕒'],
      ].map(([value, label, emoji]) => new StringSelectMenuOptionBuilder()
        .setValue(value)
        .setLabel(label)
        .setEmoji(emoji)
        .setDefault(value === view)));
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(viewSelect),
    );

    if (items.length > 0) {
      const ruleSelect = new StringSelectMenuBuilder()
        .setCustomId(`wishlist-v2:${sessionId}:game`)
        .setPlaceholder(text.wishlistRulePlaceholder)
        .setDisabled(disabled)
        .addOptions(items.map((item) => new StringSelectMenuOptionBuilder()
          .setValue(String(item.appId))
          .setLabel(buttonLabel(item.name))));
      container.addActionRowComponents(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(ruleSelect),
      );
    }

    const previous = new ButtonBuilder()
      .setCustomId(`wishlist-v2:${sessionId}:previous`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
      .setLabel(text.previous)
      .setDisabled(disabled || pageIndex === 0);
    const indicator = new ButtonBuilder()
      .setCustomId(`wishlist-v2:${sessionId}:page`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(text.page(pageIndex + 1, pageCount))
      .setDisabled(true);
    const next = new ButtonBuilder()
      .setCustomId(`wishlist-v2:${sessionId}:next`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️')
      .setLabel(text.next)
      .setDisabled(disabled || pageIndex >= pageCount - 1);
    const close = new ButtonBuilder()
      .setCustomId(`wishlist-v2:${sessionId}:close`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(text.close)
      .setDisabled(disabled);
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(previous, indicator, next, close),
    );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return {
    components: [container],
    items,
    pageIndex,
    pageCount,
    totalFilteredItems: filtered.length,
  };
}

function buildWishlistV2GameSection(
  item: WishlistItem,
  snapshot: WishlistSnapshot,
  language: Language,
): SectionBuilder {
  const text = uiCopy(language);
  const storeUrl = `https://store.steampowered.com/app/${item.appId}/`;
  const override = snapshot.gameMinimumDiscountOverrides?.get(item.appId);
  const threshold = override ?? snapshot.globalMinimumDiscountPercent ?? 0;
  const price = item.price === null || (!item.price.isFree && item.price.currency === null)
    ? text.wishlistPriceUnknown
    : item.price.isFree
      ? `**${text.wishlistFree}**`
      : item.price.currency === null
        ? text.wishlistPriceUnknown
        : item.onSale && item.price.discountPercent > 0
          ? `~~${formatMinorPrice(item.price.initialMinor, item.price.currency, language)}~~ → **${formatMinorPrice(item.price.finalMinor, item.price.currency, language)}** · **${language === 'tr' ? `%${item.price.discountPercent}` : `${item.price.discountPercent}%`}**`
          : `**${formatMinorPrice(item.price.finalMinor, item.price.currency, language)}**`;
  const savings = item.onSale && item.price?.currency && item.price.finalMinor < item.price.initialMinor
    ? `\n${language === 'tr' ? 'Kazancın' : 'You save'} **${formatMinorPrice(item.price.initialMinor - item.price.finalMinor, item.price.currency, language)}**`
    : '';
  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### [${sanitizeWishlistGameName(item.name)}](${storeUrl})\n${price}${savings}\n-# ${text.wishlistThreshold(threshold, override !== undefined)}`,
      ),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.appId}/header.jpg`)
        .setDescription(item.name.slice(0, 100)),
    );
}

export function filterAndSortWishlist(
  items: readonly WishlistItem[],
  view: WishlistV2View,
): WishlistItem[] {
  const filtered = view === 'sale' ? items.filter((item) => item.onSale === true) : [...items];
  if (view === 'discount' || view === 'sale') {
    return [...filtered].sort((left, right) =>
      (right.price?.discountPercent ?? -1) - (left.price?.discountPercent ?? -1)
        || left.appId - right.appId
    );
  }
  if (view === 'recent') {
    return [...filtered].sort((left, right) =>
      (right.dateAdded ?? -1) - (left.dateAdded ?? -1) || left.appId - right.appId
    );
  }
  return [...filtered];
}

export function buildWishlistPage(
  snapshot: WishlistSnapshot,
  language: Language,
  requestedPageIndex: number,
  sessionId: string,
  controls: WishlistControls = 'active',
): WishlistPage {
  const pageCount = Math.max(1, Math.ceil(snapshot.items.length / wishlistPageSize));
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), pageCount - 1);
  const pageItems = snapshot.items.slice(
    pageIndex * wishlistPageSize,
    (pageIndex + 1) * wishlistPageSize,
  );
  const embeds = [
    buildWishlistSummaryEmbed(snapshot, language, pageIndex, pageCount),
    ...pageItems.map((item) => {
      const override = snapshot.gameMinimumDiscountOverrides?.get(item.appId);
      return buildWishlistGameEmbed(
        item,
        language,
        override ?? snapshot.globalMinimumDiscountPercent ?? 0,
        override !== undefined,
      );
    }),
  ];
  validateWishlistEmbeds(embeds);

  return {
    embeds,
    components: controls === 'hidden'
      ? []
      : buildWishlistComponents(
          sessionId,
          language,
          pageIndex,
          pageCount,
          pageItems,
          controls === 'disabled',
        ),
    pageIndex,
    pageCount,
  };
}

export function buildWishlistSummaryEmbed(
  snapshot: WishlistSnapshot,
  language: Language,
  pageIndex: number,
  pageCount: number,
): APIEmbed {
  const messages = messagesFor(language);
  const totalGames = snapshot.items.length + snapshot.failedItemCount;
  const capturedAt = Math.floor(new Date(snapshot.capturedAt).getTime() / 1_000);

  return {
    color: dealioBrand.colors.primary,
    title: messages.wishlistTitle,
    description: snapshot.items.length === 0 && snapshot.failedItemCount === 0
      ? messages.wishlistEmpty
      : snapshot.failedItemCount > 0
        ? messages.wishlistFailedItems(snapshot.failedItemCount)
        : undefined,
    fields: [
      { name: messages.wishlistTotalGamesLabel, value: String(totalGames), inline: true },
      {
        name: messages.wishlistOnSaleGamesLabel,
        value: String(snapshot.items.filter((item) => item.onSale === true).length),
        inline: true,
      },
      {
        name: messages.wishlistFreeGamesLabel,
        value: String(snapshot.items.filter((item) => item.price?.isFree === true).length),
        inline: true,
      },
      {
        name: messages.wishlistFetchedAtLabel,
        value: Number.isSafeInteger(capturedAt) ? `<t:${capturedAt}:F>` : snapshot.capturedAt,
        inline: true,
      },
      ...(snapshot.storeCountryCode
        ? [{
            name: messages.statusStoreRegionLabel,
            value: storeCountryLabel(snapshot.storeCountryCode, language),
            inline: true,
          }]
        : []),
    ],
    footer: { text: messages.wishlistPage(pageIndex + 1, pageCount) },
  };
}

export function buildWishlistGameEmbed(
  item: WishlistItem,
  language: Language,
  minimumDiscountPercent = 0,
  hasGameOverride = false,
): APIEmbed {
  const messages = messagesFor(language);
  const storeUrl = `https://store.steampowered.com/app/${item.appId}/`;
  const fields: NonNullable<APIEmbed['fields']> = [];
  const hasUnknownPrice = item.price === null
    || (!item.price.isFree && item.price.currency === null);
  const hasDiscount = item.price !== null
    && !item.price.isFree
    && item.price.currency !== null
    && item.onSale === true
    && item.price.discountPercent > 0
    && item.price.finalMinor < item.price.initialMinor;

  if (hasUnknownPrice) {
    fields.push({ name: messages.wishlistPriceLabel, value: messages.wishlistPriceUnknown });
  } else if (item.price?.isFree) {
    fields.push({ name: messages.wishlistPriceLabel, value: `**${messages.wishlistFree}**` });
  } else if (item.price !== null && item.price.currency !== null) {
    const normalPrice = formatMinorPrice(item.price.initialMinor, item.price.currency, language);
    const currentPrice = formatMinorPrice(item.price.finalMinor, item.price.currency, language);
    if (hasDiscount) {
      fields.push(
        { name: messages.wishlistNormalPriceLabel, value: `~~${normalPrice}~~`, inline: true },
        { name: messages.wishlistCurrentPriceLabel, value: `**${currentPrice}**`, inline: true },
        {
          name: messages.wishlistDiscountLabel,
          value: messages.wishlistDiscountValue(item.price.discountPercent),
          inline: true,
        },
      );
    } else {
      fields.push({ name: messages.wishlistPriceLabel, value: `**${currentPrice}**` });
    }
  }

  if (item.priority !== null && item.priority > 0) {
    fields.push({
      name: messages.wishlistPriorityLabel,
      value: messages.wishlistPriorityValue(item.priority),
      inline: true,
    });
  }
  if (item.dateAdded !== null) {
    fields.push({
      name: messages.wishlistAddedAtLabel,
      value: `<t:${item.dateAdded}:D>`,
      inline: true,
    });
  }
  fields.push({
    name: messages.wishlistMinimumDiscountLabel,
    value: hasGameOverride
      ? messages.wishlistThresholdOverride(minimumDiscountPercent)
      : messages.wishlistThresholdGlobal(minimumDiscountPercent),
    inline: true,
  });
  fields.push({ name: '\u200b', value: `[${messages.wishlistOpenStore}](${storeUrl})` });

  return {
    color: hasUnknownPrice
      ? wishlistEmbedColors.unknown
      : item.price?.isFree
        ? wishlistEmbedColors.free
        : hasDiscount
          ? wishlistEmbedColors.sale
          : wishlistEmbedColors.normal,
    title: sanitizeWishlistGameName(item.name),
    url: storeUrl,
    fields,
    image: {
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.appId}/header.jpg`,
    },
  };
}

export function buildWishlistComponents(
  sessionId: string,
  language: Language,
  pageIndex: number,
  pageCount: number,
  pageItems: readonly WishlistItem[],
  allDisabled = false,
): APIActionRowComponent<APIButtonComponent>[] {
  const messages = messagesFor(language);
  const rows: APIActionRowComponent<APIButtonComponent>[] = [];
  if (pageItems.length > 0) {
    rows.push({
      type: ComponentType.ActionRow,
      components: pageItems.map((item) => ({
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `wishlist:${sessionId}:game:${item.appId}`,
        label: buttonLabel(item.name),
        disabled: allDisabled,
      })),
    });
  }
  rows.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: `wishlist:${sessionId}:previous`,
        label: messages.wishlistPrevious,
        disabled: allDisabled || pageIndex === 0,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        custom_id: `wishlist:${sessionId}:next`,
        label: messages.wishlistNext,
        disabled: allDisabled || pageIndex >= pageCount - 1,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        custom_id: `wishlist:${sessionId}:close`,
        label: messages.wishlistClose,
        disabled: allDisabled,
      },
    ],
  });
  return rows;
}

export function parseWishlistAction(customId: string, interactionId: string): WishlistAction | null {
  const prefix = `wishlist:${interactionId}:`;
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const action = customId.slice(prefix.length);
  if (action === 'previous' || action === 'next' || action === 'close') {
    return action;
  }
  const gameMatch = /^game:(\d+)$/.exec(action);
  if (!gameMatch) {
    return null;
  }
  const appId = Number(gameMatch[1]);
  return Number.isSafeInteger(appId) && appId > 0 ? { type: 'game', appId } : null;
}

function buttonLabel(value: string): string {
  const label = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return label.length <= 80 ? label : `${label.slice(0, 77)}...`;
}

export function canUseWishlistComponent(
  customId: string,
  componentUserId: string,
  ownerUserId: string,
  interactionId: string,
): boolean {
  return componentUserId === ownerUserId
    && parseWishlistAction(customId, interactionId) !== null;
}

export function sanitizeWishlistGameName(value: string): string {
  const escaped = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_{}\[\]()|>~<>])/g, '\\$1')
    .replace(/@/g, '@\u200b');
  if (escaped.length <= 256) {
    return escaped;
  }
  return `${escaped.slice(0, 253).replace(/\\$/, '')}...`;
}

export function validateWishlistEmbeds(embeds: readonly APIEmbed[]): void {
  if (embeds.length > maximumEmbedsPerMessage) {
    throw new Error('Wishlist page exceeds the Discord embed count limit');
  }
  for (const embed of embeds) {
    if ((embed.title?.length ?? 0) > 256 || (embed.description?.length ?? 0) > 4_096) {
      throw new Error('Wishlist embed exceeds a Discord text field limit');
    }
    if ((embed.footer?.text.length ?? 0) > 2_048 || (embed.author?.name.length ?? 0) > 256) {
      throw new Error('Wishlist embed exceeds a Discord metadata limit');
    }
    if ((embed.fields?.length ?? 0) > 25 || embed.fields?.some(
      (field) => field.name.length > 256 || field.value.length > 1_024,
    )) {
      throw new Error('Wishlist embed exceeds a Discord field limit');
    }
  }
  if (embeds.reduce((total, embed) => total + embedTextLength(embed), 0) > maximumEmbedTextPerMessage) {
    throw new Error('Wishlist page exceeds the Discord embed character limit');
  }
}

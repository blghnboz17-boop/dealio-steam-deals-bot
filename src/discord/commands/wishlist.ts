import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { WishlistViewService } from '../../application/wishlist-view-service.js';
import { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';
import {
  buildWishlistPage,
  canUseWishlistComponent,
  parseWishlistAction,
} from '../wishlist-view.js';

const wishlistSessionTimeoutMs = 2 * 60 * 1_000;

export const wishlistCommand = new SlashCommandBuilder()
  .setName('wishlist')
  .setDescription('Show your live Steam wishlist')
  .setDescriptionLocalizations({
    tr: 'Güncel Steam wishlistini göster',
  });

export async function handleWishlist(
  interaction: ChatInputCommandInteraction,
  service: WishlistViewService,
  lifecycleSignal?: AbortSignal,
  thresholdService?: DiscountThresholdService,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await service.load(
    interaction.user.id,
    languageFromDiscordLocale(interaction.locale),
  );
  const messages = messagesFor(result.language);

  if (result.status === 'not-configured') {
    await interaction.editReply({ content: messages.notConfigured, embeds: [], components: [] });
    return;
  }

  if (result.status === 'unavailable') {
    await interaction.editReply({
      content: result.errorCode === 'STEAM_WISHLIST_INACCESSIBLE'
        ? messages.wishlistInaccessible
        : messages.wishlistUnavailable,
      embeds: [],
      components: [],
    });
    return;
  }

  const snapshot = {
    items: result.items,
    failedItemCount: result.errors.length,
    capturedAt: result.capturedAt,
    globalMinimumDiscountPercent: result.globalMinimumDiscountPercent ?? 0,
    gameMinimumDiscountOverrides: new Map(result.gameMinimumDiscountOverrides ?? []),
  };
  const configVersion = result.configVersion;
  const configurationId = result.configurationId;
  let pageIndex = 0;
  const initialPage = buildWishlistPage(
    snapshot,
    result.language,
    pageIndex,
    interaction.id,
  );
  const message = await interaction.editReply({
    content: null,
    embeds: initialPage.embeds,
    components: initialPage.components,
  });
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: wishlistSessionTimeoutMs,
    filter: (component) => canUseWishlistComponent(
      component.customId,
      component.user.id,
      interaction.user.id,
      interaction.id,
    ),
  });
  const sessionExpiresAt = Date.now() + wishlistSessionTimeoutMs;
  let operations = Promise.resolve();
  let controlsHidden = false;
  let modalSequence = 0;
  const modalTasks = new Set<Promise<void>>();
  const modalAbortController = new AbortController();

  collector.on('collect', (component) => {
    const action = parseWishlistAction(component.customId, interaction.id);
    if (action === 'close') {
      collector.stop('closed');
    }
    if (action !== null && typeof action === 'object') {
      const item = snapshot.items.find((candidate) => candidate.appId === action.appId);
      if (!item || !thresholdService) {
        void component.deferUpdate();
        return;
      }
      const modalCustomId = wishlistThresholdModalId(
        interaction.id,
        interaction.user.id,
        item.appId,
        ++modalSequence,
      );
      const modalTask = (async () => {
        try {
          await component.showModal(buildWishlistThresholdModal(
            modalCustomId,
            result.language,
            snapshot.gameMinimumDiscountOverrides.get(item.appId),
          ));
          let cancelModal = (): void => undefined;
          const cancelled = new Promise<null>((resolve) => {
            cancelModal = () => resolve(null);
            if (modalAbortController.signal.aborted) {
              resolve(null);
              return;
            }
            modalAbortController.signal.addEventListener('abort', cancelModal, {
              once: true,
            });
          });
          const modal = await Promise.race([
            component.awaitModalSubmit({
              time: Math.max(1, sessionExpiresAt - Date.now()),
              filter: (submission) => submission.customId === modalCustomId
                && submission.user.id === interaction.user.id,
            }),
            cancelled,
          ]).catch(() => null);
          modalAbortController.signal.removeEventListener('abort', cancelModal);
          if (!modal || modalAbortController.signal.aborted) {
            return;
          }
          const rawValue = modal.fields.getTextInputValue('minimum-discount-percent').trim();
          const percent = parseOptionalDiscountPercent(rawValue);
          if (percent === undefined) {
            await modal.reply({
              content: messagesFor(result.language).discountThresholdInvalid,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await modal.deferUpdate();
          operations = operations.then(async () => {
            if (modalAbortController.signal.aborted) {
              return;
            }
            const updated = await thresholdService.setGame(
              interaction.user.id,
              item.appId,
              percent,
              configVersion,
              configurationId,
            );
            if (!updated) {
              await interaction.editReply({
                content: messagesFor(result.language).discountThresholdSaveFailed,
              });
              return;
            }
            snapshot.globalMinimumDiscountPercent = updated.config.minimumDiscountPercent;
            if (percent === null) {
              snapshot.gameMinimumDiscountOverrides.delete(item.appId);
            } else {
              snapshot.gameMinimumDiscountOverrides.set(item.appId, percent);
            }
            const refreshedPage = buildWishlistPage(
              snapshot,
              result.language,
              pageIndex,
              interaction.id,
            );
            await interaction.editReply({
              content: percent === null
                ? messagesFor(result.language).wishlistThresholdReset(
                    item.name,
                    updated.effectivePercent,
                  )
                : messagesFor(result.language).wishlistThresholdSaved(item.name, percent),
              embeds: refreshedPage.embeds,
              components: refreshedPage.components,
            });
          }).catch((error: unknown) => {
            console.error('Discord wishlist threshold update failed', error);
          });
          await operations;
        } catch (error: unknown) {
          if (!modalAbortController.signal.aborted) {
            console.error('Discord wishlist modal failed', error);
          }
        }
      })();
      modalTasks.add(modalTask);
      void modalTask.finally(() => modalTasks.delete(modalTask));
      return;
    }
    const acknowledgement = component.deferUpdate();
    operations = operations.then(async () => {
      await acknowledgement;
      if (action === null) {
        return;
      }
      if (action === 'close') {
        const closedPage = buildWishlistPage(
          snapshot,
          result.language,
          pageIndex,
          interaction.id,
          'hidden',
        );
        await interaction.editReply({ embeds: closedPage.embeds, components: [] });
        controlsHidden = true;
        return;
      }

      const currentPage = buildWishlistPage(
        snapshot,
        result.language,
        pageIndex,
        interaction.id,
      );
      pageIndex = action === 'previous'
        ? Math.max(0, currentPage.pageIndex - 1)
        : Math.min(currentPage.pageCount - 1, currentPage.pageIndex + 1);
      const nextPage = buildWishlistPage(
        snapshot,
        result.language,
        pageIndex,
        interaction.id,
      );
      await interaction.editReply({
        content: null,
        embeds: nextPage.embeds,
        components: nextPage.components,
      });
    }).catch((error: unknown) => {
      console.error('Discord wishlist component update failed', error);
    });
  });

  const endReason = new Promise<string>((resolve) => {
    collector.once('end', (_collected, reason) => resolve(reason));
  });
  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (lifecycleSignal?.aborted) {
    collector.stop('shutdown');
  }

  try {
    const reason = await endReason;
    modalAbortController.abort();
    await Promise.allSettled([...modalTasks]);
    await operations;
    if (reason !== 'closed' || !controlsHidden) {
      const expiredPage = buildWishlistPage(
        snapshot,
        result.language,
        pageIndex,
        interaction.id,
        'disabled',
      );
      try {
        await interaction.editReply({
          embeds: expiredPage.embeds,
          components: expiredPage.components,
        });
      } catch (error: unknown) {
        console.error('Discord wishlist component cleanup failed', error);
      }
    }
  } finally {
    lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

export function parseOptionalDiscountPercent(value: string): number | null | undefined {
  if (value === '') {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const percent = Number(value);
  return Number.isSafeInteger(percent) && percent <= 100 ? percent : undefined;
}

function wishlistThresholdModalId(
  sessionId: string,
  ownerId: string,
  appId: number,
  sequence: number,
): string {
  return `wishlist-threshold:${sessionId}:${ownerId}:${appId}:${sequence}`;
}

function buildWishlistThresholdModal(
  customId: string,
  language: 'tr' | 'en',
  currentOverride: number | undefined,
): ModalBuilder {
  const messages = messagesFor(language);
  const input = new TextInputBuilder()
    .setCustomId('minimum-discount-percent')
    .setLabel(messages.wishlistThresholdInputLabel)
    .setPlaceholder(messages.wishlistThresholdPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(3);
  if (currentOverride !== undefined) {
    input.setValue(String(currentOverride));
  }
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(messages.wishlistThresholdModalTitle)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

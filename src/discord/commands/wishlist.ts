import {
  ChatInputCommandInteraction,
  LabelBuilder,
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
import { buildWishlistV2Page, type WishlistV2View } from '../wishlist-view.js';
import {
  buildNoticePanel,
  dealioEphemeralV2Flags,
  dealioUiSessionTimeoutMs,
  dealioV2Flags,
} from '../ui/components-v2.js';
import { dealioUiSessions } from '../ui/session-manager.js';

const wishlistSessionTimeoutMs = dealioUiSessionTimeoutMs;

export const wishlistCommand = new SlashCommandBuilder()
  .setName('wishlist')
  .setDescription('Show your live Steam wishlist')
  .setDescriptionLocalizations({ tr: 'Güncel Steam wishlistini göster' });

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
    await interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(result.language, 'warning',
        result.language === 'tr' ? 'Dealio henüz kurulmamış' : 'Dealio is not configured',
        messages.notConfigured)],
    });
    return;
  }
  if (result.status === 'unavailable') {
    const description = result.errorCode === 'STEAM_WISHLIST_INACCESSIBLE'
      ? messages.wishlistInaccessible
      : messages.wishlistUnavailable;
    await interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(result.language, 'danger',
        result.language === 'tr' ? 'Wishlist yüklenemedi' : 'Wishlist unavailable',
        description)],
    });
    return;
  }

  const snapshot = {
    items: result.items,
    failedItemCount: result.errors.length,
    capturedAt: result.capturedAt,
    storeCountryCode: result.storeCountryCode,
    globalMinimumDiscountPercent: result.globalMinimumDiscountPercent ?? 0,
    gameMinimumDiscountOverrides: new Map(result.gameMinimumDiscountOverrides ?? []),
  };
  const configVersion = result.configVersion;
  const configurationId = result.configurationId;
  let pageIndex = 0;
  let view: WishlistV2View = 'all';
  let controlsHidden = false;
  let modalSequence = 0;
  const initialPage = buildWishlistV2Page(snapshot, result.language, pageIndex, interaction.id, view);
  const message = await interaction.editReply({
    flags: dealioV2Flags,
    components: [...initialPage.components],
  });
  const closeUiSession = dealioUiSessions.open(
    interaction.id,
    interaction.user.id,
    ['wishlist-v2'],
    wishlistSessionTimeoutMs,
  );
  const collector = message.createMessageComponentCollector({
    time: wishlistSessionTimeoutMs,
    filter: (component) => component.user.id === interaction.user.id
      && component.customId.startsWith(`wishlist-v2:${interaction.id}:`),
  });
  const sessionExpiresAt = Date.now() + wishlistSessionTimeoutMs;
  let operations = Promise.resolve();
  const modalTasks = new Set<Promise<void>>();
  const modalAbortController = new AbortController();

  collector.on('collect', (component) => {
    const action = component.customId.slice(`wishlist-v2:${interaction.id}:`.length);
    if (component.isStringSelectMenu() && action === 'view') {
      const selected = component.values[0];
      if (isWishlistView(selected)) {
        view = selected;
        pageIndex = 0;
      }
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        const page = buildWishlistV2Page(snapshot, result.language, pageIndex, interaction.id, view);
        pageIndex = page.pageIndex;
        await interaction.editReply({ components: [...page.components] });
      }).catch((error: unknown) => console.error('Discord wishlist view update failed', error));
      return;
    }

    if (component.isStringSelectMenu() && action === 'game') {
      const appId = Number(component.values[0]);
      const item = snapshot.items.find((candidate) => candidate.appId === appId);
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
            modalAbortController.signal.addEventListener('abort', cancelModal, { once: true });
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
              flags: dealioEphemeralV2Flags,
              components: [buildNoticePanel(
                result.language,
                'warning',
                result.language === 'tr' ? 'Geçersiz indirim oranı' : 'Invalid discount threshold',
                messagesFor(result.language).discountThresholdInvalid,
              )],
            });
            return;
          }
          await modal.deferUpdate();
          operations = operations.then(async () => {
            const updated = await thresholdService.setGame(
              interaction.user.id,
              item.appId,
              percent,
              configVersion,
              configurationId,
            );
            if (!updated) {
              throw new Error('Wishlist threshold configuration became stale');
            }
            snapshot.globalMinimumDiscountPercent = updated.config.minimumDiscountPercent;
            if (percent === null) {
              snapshot.gameMinimumDiscountOverrides.delete(item.appId);
            } else {
              snapshot.gameMinimumDiscountOverrides.set(item.appId, percent);
            }
            const refreshed = buildWishlistV2Page(
              snapshot,
              result.language,
              pageIndex,
              interaction.id,
              view,
            );
            await interaction.editReply({ components: [...refreshed.components] });
            await modal.followUp({
              flags: dealioEphemeralV2Flags,
              components: [buildNoticePanel(
                result.language,
                'success',
                result.language === 'tr' ? 'Bildirim eşiği güncellendi' : 'Alert threshold updated',
                percent === null
                  ? messagesFor(result.language).wishlistThresholdReset(item.name, updated.effectivePercent)
                  : messagesFor(result.language).wishlistThresholdSaved(item.name, percent),
              )],
            });
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

    if (!component.isButton()) {
      void component.deferUpdate();
      return;
    }
    if (action === 'close') {
      collector.stop('closed');
    }
    const acknowledgement = component.deferUpdate();
    operations = operations.then(async () => {
      await acknowledgement;
      if (action === 'close') {
        const closed = buildWishlistV2Page(
          snapshot, result.language, pageIndex, interaction.id, view, 'hidden',
        );
        await interaction.editReply({ components: [...closed.components] });
        controlsHidden = true;
        return;
      }
      const current = buildWishlistV2Page(snapshot, result.language, pageIndex, interaction.id, view);
      pageIndex = action === 'previous'
        ? Math.max(0, current.pageIndex - 1)
        : action === 'next'
          ? Math.min(current.pageCount - 1, current.pageIndex + 1)
          : current.pageIndex;
      const next = buildWishlistV2Page(snapshot, result.language, pageIndex, interaction.id, view);
      await interaction.editReply({ components: [...next.components] });
    }).catch((error: unknown) => console.error('Discord wishlist component update failed', error));
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
    if ((reason !== 'closed' || !controlsHidden) && !controlsHidden) {
      const expired = buildWishlistV2Page(
        snapshot, result.language, pageIndex, interaction.id, view, 'disabled',
      );
      await interaction.editReply({ components: [...expired.components] }).catch((error: unknown) => {
        console.error('Discord wishlist component cleanup failed', error);
      });
    }
  } finally {
    closeUiSession();
    lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

function isWishlistView(value: string | undefined): value is WishlistV2View {
  return value === 'all' || value === 'sale' || value === 'discount' || value === 'recent';
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
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(messages.wishlistThresholdInputLabel)
        .setTextInputComponent(input),
    );
}

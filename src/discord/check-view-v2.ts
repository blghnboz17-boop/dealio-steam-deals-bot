import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import type { Language } from '../domain/user-config.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { uiCopy } from './ui/copy.js';

export interface CheckResultPresentation {
  readonly kind: 'success' | 'warning' | 'danger' | 'info';
  readonly title: string;
  readonly description: string;
  readonly metrics?: readonly { readonly label: string; readonly value: number }[];
}

export function buildCheckPanel(
  language: Language,
  presentation: CheckResultPresentation,
  sessionId?: string,
  disabled = false,
): ContainerBuilder {
  const text = uiCopy(language);
  const colors = {
    success: dealioBrand.colors.success,
    warning: dealioBrand.colors.warning,
    danger: dealioBrand.colors.danger,
    info: dealioBrand.colors.primary,
  } as const;
  const icons = { success: '✅', warning: '⚠️', danger: '🛑', info: '🔄' } as const;
  const container = new ContainerBuilder()
    .setAccentColor(colors[presentation.kind])
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${icons[presentation.kind]} ${presentation.title}`),
      new TextDisplayBuilder().setContent(presentation.description),
    );
  if (presentation.metrics && presentation.metrics.length > 0) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        presentation.metrics.map((metric) => `**${metric.value}**\n-# ${metric.label}`).join('\n\n'),
      ));
  }
  if (sessionId) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`check-v2:${sessionId}:wishlist`).setLabel(text.openWishlist).setEmoji('🎮').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`check-v2:${sessionId}:status`).setLabel(text.openStatus).setEmoji('📊').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ),
    );
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

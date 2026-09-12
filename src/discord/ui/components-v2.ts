import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type JSONEncodable,
} from 'discord.js';
import type { Language } from '../../domain/user-config.js';
import { dealioBrand } from './brand.js';

export const dealioV2Flags = MessageFlags.IsComponentsV2;
export const dealioEphemeralV2Flags = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
export const dealioUiSessionTimeoutMs = 10 * 60 * 1_000;

export type DealioNoticeKind = 'info' | 'success' | 'warning' | 'danger';

const noticeColors: Readonly<Record<DealioNoticeKind, number>> = {
  info: dealioBrand.colors.primary,
  success: dealioBrand.colors.success,
  warning: dealioBrand.colors.warning,
  danger: dealioBrand.colors.danger,
};

const noticeIcons: Readonly<Record<DealioNoticeKind, string>> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  danger: '🛑',
};

export function dealioFooter(language: Language): string {
  return language === 'tr'
    ? '-# Dealio · Kişisel Steam indirim asistanı'
    : '-# Dealio · Personal Steam sale assistant';
}

export function buildNoticePanel(
  language: Language,
  kind: DealioNoticeKind,
  title: string,
  description: string,
  options: {
    readonly button?: {
      readonly customId: string;
      readonly label: string;
      readonly style?: ButtonStyle;
      readonly emoji?: string;
      readonly disabled?: boolean;
    };
  } = {},
): ContainerBuilder {
  const container = new ContainerBuilder()
    .setAccentColor(noticeColors[kind])
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${noticeIcons[kind]} ${title}`),
      new TextDisplayBuilder().setContent(description),
    );

  if (options.button) {
    const button = new ButtonBuilder()
      .setCustomId(options.button.customId)
      .setLabel(options.button.label)
      .setStyle(options.button.style ?? ButtonStyle.Primary)
      .setDisabled(options.button.disabled ?? false);
    if (options.button.emoji) {
      button.setEmoji(options.button.emoji);
    }
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(button),
    );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

export function buildExpiredPanel(language: Language): ContainerBuilder {
  return buildNoticePanel(
    language,
    'warning',
    language === 'tr' ? 'Bu panelin süresi doldu' : 'This panel has expired',
    language === 'tr'
      ? 'Güncel ve güvenli bir panel açmak için komutu yeniden çalıştır.'
      : 'Run the command again to open a fresh, secure panel.',
  );
}

interface ComponentJson {
  readonly type?: unknown;
  readonly content?: unknown;
  readonly components?: readonly ComponentJson[];
  readonly accessory?: ComponentJson;
  readonly component?: ComponentJson;
}

export function countComponentsV2(
  components: readonly (ComponentJson | JSONEncodable<ComponentJson>)[],
): number {
  const count = (component: ComponentJson): number => 1
    + (component.components ?? []).reduce((total, child) => total + count(child), 0)
    + (component.accessory ? count(component.accessory) : 0)
    + (component.component ? count(component.component) : 0);
  return components.reduce((total, value) => {
    const component = 'toJSON' in value ? value.toJSON() : value;
    return total + count(component);
  }, 0);
}

export function componentsV2TextLength(
  components: readonly (ComponentJson | JSONEncodable<ComponentJson>)[],
): number {
  const length = (component: ComponentJson): number =>
    (component.type === 10 && typeof component.content === 'string' ? component.content.length : 0)
    + (component.components ?? []).reduce((total, child) => total + length(child), 0)
    + (component.accessory ? length(component.accessory) : 0)
    + (component.component ? length(component.component) : 0);
  return components.reduce((total, value) =>
    total + length('toJSON' in value ? value.toJSON() : value), 0);
}

export function assertComponentsV2Limit(
  components: readonly (ComponentJson | JSONEncodable<ComponentJson>)[],
): void {
  const textLength = componentsV2TextLength(components);
  if (textLength > 4000) {
    throw new Error(`Dealio Components V2 payload exceeds Discord's 4000 character limit (${textLength})`);
  }
  const count = countComponentsV2(components);
  if (count > 40) {
    throw new Error(`Dealio Components V2 payload exceeds Discord's 40 component limit (${count})`);
  }
}

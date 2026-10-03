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
import { localizer } from '../i18n.js';
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
  return '-# Dealio · ' + localizer(language)({
    tr: 'Kişisel Steam indirim asistanın',
    en: 'Your personal Steam deal assistant',
    de: 'Dein persönlicher Steam-Schnäppchen-Assistent',
    fr: 'Ton assistant bons plans Steam',
  });
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

/**
 * Opens a fresh /dealio panel from any message, DMs included. The id carries no
 * session, so the button keeps working after restarts and expiry.
 */
export const openPanelCustomId = 'dealio-open:home';

/** The notice button that opens /dealio; for a newcomer that is the setup welcome. */
export function openPanelNoticeButton(language: Language, setup = false) {
  const t = localizer(language);
  return {
    customId: openPanelCustomId,
    label: setup
      ? t({ tr: 'Hadi başlayalım', en: 'Get started', de: 'Los geht’s', fr: 'C’est parti' })
      : t({ tr: 'Dealio paneli', en: 'Dealio panel', de: 'Dealio-Panel', fr: 'Panneau Dealio' }),
    emoji: setup ? '✨' : '🏠',
  };
}

export function buildExpiredPanel(language: Language): ContainerBuilder {
  const t = localizer(language);
  return buildNoticePanel(
    language,
    'warning',
    t({ tr: 'Bu panel kapandı', en: 'This panel has closed', de: 'Dieses Panel ist geschlossen', fr: 'Ce panneau est fermé' }),
    t({
      tr: 'Güvenliğin için paneller bir süre sonra kapanıyor. Yenisini hemen açabilirsin.',
      en: 'Panels close after a while to keep your account safe. You can open a fresh one right away.',
      de: 'Panels schließen sich nach einer Weile, damit dein Konto sicher bleibt. Du kannst sofort ein neues öffnen.',
      fr: 'Les panneaux se ferment au bout d’un moment pour protéger ton compte. Tu peux en ouvrir un nouveau tout de suite.',
    }),
    { button: openPanelNoticeButton(language) },
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

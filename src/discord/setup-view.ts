import { defaultPollIntervalHours } from '../config/environment.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ComponentType,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
} from 'discord.js';
import type { PreparedUserConfiguration } from '../application/user-configuration-service.js';
import {
  storeCountryLabel,
  storeCountryName,
  type StoreCountryCode,
} from '../domain/store-country.js';
import type { Language } from '../domain/user-config.js';
import { messagesFor } from './messages.js';
import { dealioBrand, withDealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { uiCopy } from './ui/copy.js';

export interface SetupPresentationOptions {
  readonly bannerUrl?: string;
  readonly avatarUrl?: string;
  readonly pollIntervalHours?: number;
  readonly regionSelectionSource?: 'discord-locale' | 'user';
}

export type SetupAction = 'start' | 'how' | 'confirm' | 'language' | 'region' | 'cancel';

export function buildSetupWelcomePanel(
  language: Language,
  sessionId: string,
  options: SetupPresentationOptions = {},
  showHow = false,
  disabled = false,
): ContainerBuilder {
  const messages = messagesFor(language);
  const container = new ContainerBuilder().setAccentColor(dealioBrand.colors.primary);
  addSetupVisual(container, options);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(language==='tr'?'-# 01 PROFİL → 02 BÖLGE VE DİL → 03 BİLDİRİM ONAYI':'-# 01 PROFILE → 02 REGION & LANGUAGE → 03 ALERT CONSENT'),
    new TextDisplayBuilder().setContent(`# ✨ ${messages.setupWizardTitle}`),
    new TextDisplayBuilder().setContent(showHow
      ? `${messages.setupWizardDescription}\n\n> 🛡️ ${messages.setupWizardHowDescription}`
      : messages.setupWizardDescription),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`setup:${sessionId}:start`).setLabel(messages.setupWizardStart).setEmoji('✨').setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`setup:${sessionId}:how`).setLabel(messages.setupWizardHow).setEmoji('🛡️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ),
  );
  finishSetupPanel(container, language);
  return container;
}

export function buildSetupAlreadyCompletedPanel(
  language: Language,
  options: SetupPresentationOptions = {},
): ContainerBuilder {
  const messages = messagesFor(language);
  const container = new ContainerBuilder().setAccentColor(dealioBrand.colors.warning);
  addSetupVisual(container, options);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# 🔒 ${messages.setupWizardAlreadyCompletedTitle}`),
    new TextDisplayBuilder().setContent(messages.setupWizardAlreadyCompletedDescription),
  );
  finishSetupPanel(container, language);
  return container;
}

export function buildSetupConfirmationPanel(
  prepared: PreparedUserConfiguration,
  sessionId: string,
  options: SetupPresentationOptions = {},
  disabled = false,
): ContainerBuilder {
  const messages = messagesFor(prepared.language);
  const profileUrl = `https://steamcommunity.com/profiles/${prepared.steamId64}`;
  const regionSource = options.regionSelectionSource === 'discord-locale'
    ? messages.setupWizardRegionSuggested
    : messages.setupWizardRegionSelected;
  const container = new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.accent)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(prepared.language==='tr'?'-# ADIM 2–3 / TERCİHLERİN VE ONAYIN':'-# STEPS 2–3 / YOUR PREFERENCES & CONSENT'),
      new TextDisplayBuilder().setContent(`# 🧭 ${messages.setupWizardConfirmTitle}`),
      new TextDisplayBuilder().setContent(messages.setupWizardConfirmDescription),
      new TextDisplayBuilder().setContent([
        `## 👤 ${messages.setupWizardProfileField}`,
        `[${maskSteamId(prepared.steamId64)}](${profileUrl})`,
        `## 🌍 ${messages.setupWizardRegionField}`,
        `**${storeCountryLabel(prepared.storeCountryCode, prepared.language)}**\n-# ${regionSource}`,
        `## 🌐 ${messages.setupWizardLanguageField}`,
        `**${prepared.language === 'tr' ? 'Türkçe' : 'English'}**`,
        `## 🔄 ${messages.setupWizardFrequencyField}`,
        `**${messages.setupWizardFrequency(options.pollIntervalHours ?? defaultPollIntervalHours)}**`,
        `## 🔔 ${messages.setupWizardConsentField}`,
        `> ${messages.setupWizardConsentValue}`,
      ].join('\n')),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`setup:${sessionId}:confirm`).setLabel(messages.setupWizardEnable).setEmoji('🔔').setStyle(ButtonStyle.Success).setDisabled(disabled),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`setup:${sessionId}:region`).setLabel(messages.setupWizardChangeRegion).setEmoji('🌍').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`setup:${sessionId}:language`).setLabel(prepared.language === 'tr' ? 'English' : 'Türkçe').setEmoji('🌐').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`setup:${sessionId}:cancel`).setLabel(messages.setupWizardCancel).setStyle(ButtonStyle.Danger).setDisabled(disabled),
      ),
    );
  finishSetupPanel(container, prepared.language);
  return container;
}

export function buildSetupCompletePanel(
  prepared: PreparedUserConfiguration,
  status: 'sent' | 'dm-blocked' | 'dm-transient-failed' | 'steam-unavailable' | 'persistence-error',
  options: SetupPresentationOptions = {},
): ContainerBuilder {
  const messages = messagesFor(prepared.language);
  const detail = status === 'sent'
    ? messages.setupSummarySent
    : status === 'dm-blocked'
      ? messages.setupWizardDmBlocked
      : status === 'dm-transient-failed'
        ? messages.setupWizardDmTransient
        : messages.setupSummaryUnavailable;
  const container = new ContainerBuilder().setAccentColor(
    status === 'sent' ? dealioBrand.colors.success
      : status === 'dm-blocked' ? dealioBrand.colors.danger : dealioBrand.colors.warning,
  );
  addSetupVisual(container, options);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${status === 'sent' ? '✅' : '⚠️'} ${messages.initialSummaryTitle}`),
    new TextDisplayBuilder().setContent(`${messages.setupSuccess}\n\n${detail}`),
    new TextDisplayBuilder().setContent(
      `**${messages.setupWizardRegionField}:** ${storeCountryLabel(prepared.storeCountryCode, prepared.language)}\n**${messages.setupWizardLanguageField}:** ${prepared.language === 'tr' ? 'Türkçe' : 'English'}`,
    ),
  );
  finishSetupPanel(container, prepared.language);
  return container;
}

function addSetupVisual(container: ContainerBuilder, options: SetupPresentationOptions): void {
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
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.avatarUrl).setDescription('Dealio')),
    );
  }
}

function finishSetupPanel(container: ContainerBuilder, language: Language): void {
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
}

export function parseSetupAction(customId: string, sessionId: string): SetupAction | null {
  const prefix = `setup:${sessionId}:`;
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const action = customId.slice(prefix.length);
  return ['start', 'how', 'confirm', 'language', 'region', 'cancel'].includes(action)
    ? action as SetupAction
    : null;
}

export function canUseSetupComponent(
  customId: string,
  componentUserId: string,
  ownerUserId: string,
  sessionId: string,
): boolean {
  return componentUserId === ownerUserId && parseSetupAction(customId, sessionId) !== null;
}

export function buildSetupWelcomeEmbed(
  language: Language,
  options: SetupPresentationOptions = {},
  showHow = false,
): APIEmbed {
  const messages = messagesFor(language);
  return withDealioBrand({
    color: dealioBrand.colors.primary,
    title: `✨ ${messages.setupWizardTitle}`,
    description: showHow
      ? `${messages.setupWizardDescription}\n\n${messages.setupWizardHowDescription}`
      : messages.setupWizardDescription,
    footer: { text: messages.initialSummaryFooter },
  }, options);
}

export function buildSetupAlreadyCompletedEmbed(
  language: Language,
  options: SetupPresentationOptions = {},
): APIEmbed {
  const messages = messagesFor(language);
  return withDealioBrand({
    color: dealioBrand.colors.warning,
    title: `🔒 ${messages.setupWizardAlreadyCompletedTitle}`,
    description: messages.setupWizardAlreadyCompletedDescription,
    footer: { text: messages.initialSummaryFooter },
  }, options);
}

export function buildSetupWelcomeComponents(
  sessionId: string,
  language: Language,
  disabled = false,
): APIActionRowComponent<APIButtonComponent>[] {
  const messages = messagesFor(language);
  return [{
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      custom_id: `setup:${sessionId}:start`,
      label: messages.setupWizardStart,
      emoji: { name: '✨' },
      disabled,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `setup:${sessionId}:how`,
      label: messages.setupWizardHow,
      emoji: { name: '🛡️' },
      disabled,
    }],
  }];
}

export function buildSetupConfirmationEmbed(
  prepared: PreparedUserConfiguration,
  options: SetupPresentationOptions = {},
): APIEmbed {
  const messages = messagesFor(prepared.language);
  const profileUrl = `https://steamcommunity.com/profiles/${prepared.steamId64}`;
  const hours = options.pollIntervalHours ?? defaultPollIntervalHours;
  return withDealioBrand({
    color: dealioBrand.colors.accent,
    title: `🧭 ${messages.setupWizardConfirmTitle}`,
    description: messages.setupWizardConfirmDescription,
    fields: [{
      name: messages.setupWizardProfileField,
      value: `[${maskSteamId(prepared.steamId64)}](${profileUrl})`,
      inline: true,
    }, {
      name: messages.setupWizardRegionField,
      value: [
        `**${storeCountryLabel(prepared.storeCountryCode, prepared.language)}**`,
        options.regionSelectionSource === 'discord-locale'
          ? messages.setupWizardRegionSuggested
          : messages.setupWizardRegionSelected,
      ].join('\n'),
      inline: true,
    }, {
      name: messages.setupWizardLanguageField,
      value: `**${prepared.language === 'tr' ? 'Türkçe' : 'English'}**`,
      inline: true,
    }, {
      name: messages.setupWizardFrequencyField,
      value: `**${messages.setupWizardFrequency(hours)}**`,
      inline: true,
    }, {
      name: messages.setupWizardConsentField,
      value: messages.setupWizardConsentValue,
    }],
    footer: { text: messages.initialSummaryFooter },
  }, options);
}

export function buildSetupConfirmationComponents(
  sessionId: string,
  language: Language,
  disabled = false,
): APIActionRowComponent<APIButtonComponent>[] {
  const messages = messagesFor(language);
  return [{
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.Button,
      style: ButtonStyle.Success,
      custom_id: `setup:${sessionId}:confirm`,
      label: messages.setupWizardEnable,
      emoji: { name: '🔔' },
      disabled,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `setup:${sessionId}:region`,
      label: messages.setupWizardChangeRegion,
      emoji: { name: '🌍' },
      disabled,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `setup:${sessionId}:language`,
      label: language === 'tr' ? 'English' : 'Türkçe',
      emoji: { name: '🌐' },
      disabled,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Danger,
      custom_id: `setup:${sessionId}:cancel`,
      label: messages.setupWizardCancel,
      disabled,
    }],
  }];
}

export function buildSetupCountrySelectOptions(
  language: Language,
  selectedCountry: StoreCountryCode,
): Array<{ readonly label: string; readonly value: string; readonly default: boolean }> {
  const commonCountries: readonly StoreCountryCode[] = [
    'TR', 'US', 'GB', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL', 'RO', 'BG',
    'GR', 'UA', 'RU', 'BR', 'MX', 'CA', 'AU', 'NZ', 'JP', 'KR', 'CN', 'IN',
  ];
  const collator = new Intl.Collator(language === 'tr' ? 'tr-TR' : 'en-US', {
    sensitivity: 'base',
  });
  const countries = [...new Set([selectedCountry, ...commonCountries])]
    .slice(0, 24)
    .map((code) => ({ code, name: storeCountryName(code, language) }))
    .sort((left, right) => collator.compare(left.name, right.name) || left.code.localeCompare(right.code))
    .map(({ code, name }) => ({
      label: `${name} (${code})`.slice(0, 100),
      value: code,
      default: code === selectedCountry,
    }));
  return [...countries, {
    label: uiCopy(language).regionOther,
    value: 'OTHER',
    default: false,
  }];
}

export function buildSetupCompleteEmbed(
  prepared: PreparedUserConfiguration,
  status: 'sent' | 'dm-blocked' | 'dm-transient-failed' | 'steam-unavailable' | 'persistence-error',
  options: SetupPresentationOptions = {},
): APIEmbed {
  const messages = messagesFor(prepared.language);
  const detail = status === 'sent'
    ? messages.setupSummarySent
    : status === 'dm-blocked'
      ? messages.setupWizardDmBlocked
      : status === 'dm-transient-failed'
        ? messages.setupWizardDmTransient
        : messages.setupSummaryUnavailable;
  return withDealioBrand({
    color: status === 'sent'
      ? dealioBrand.colors.success
      : status === 'dm-blocked'
        ? dealioBrand.colors.danger
        : dealioBrand.colors.warning,
    title: status === 'sent'
      ? `✅ ${messages.initialSummaryTitle}`
      : `⚠️ ${messages.setupWizardConfirmTitle}`,
    description: `${messages.setupSuccess}\n\n${detail}`,
    fields: [{
      name: messages.setupWizardRegionField,
      value: storeCountryLabel(prepared.storeCountryCode, prepared.language),
      inline: true,
    }, {
      name: messages.setupWizardLanguageField,
      value: prepared.language === 'tr' ? 'Türkçe' : 'English',
      inline: true,
    }],
    footer: { text: messages.initialSummaryFooter },
  }, options);
}

function maskSteamId(steamId64: string): string {
  return `${steamId64.slice(0, 5)}••••••••${steamId64.slice(-4)}`;
}

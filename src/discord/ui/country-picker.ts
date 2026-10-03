import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} from 'discord.js';
import {
  storeCountryCodes,
  storeCountryLabel,
  storeCountryName,
  type StoreCountryCode,
} from '../../domain/store-country.js';
import type { Language } from '../../domain/user-config.js';
import { uiCopy } from './copy.js';
import { assertComponentsV2Limit, dealioFooter } from './components-v2.js';
import { dealioBrand } from './brand.js';
import { flagEmoji } from './design.js';
import { findStoreCountryChoices } from '../store-country-options.js';

export const commonStoreCountries: readonly StoreCountryCode[] = [
  'TR', 'US', 'GB', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL', 'RO', 'BG',
  'GR', 'UA', 'RU', 'BR', 'MX', 'CA', 'AU', 'NZ', 'JP', 'KR', 'CN', 'IN',
];

export interface StoreCountryRange {
  readonly index: number;
  /** "A – B": the first letters of the range's first and last country. */
  readonly label: string;
  /** "Afganistan … Belçika" */
  readonly description: string;
  readonly countries: readonly StoreCountryCode[];
}

export function buildStoreCountryRanges(language: Language): StoreCountryRange[] {
  const collator = new Intl.Collator(language === 'tr' ? 'tr-TR' : 'en-US', {
    sensitivity: 'base',
  });
  const sorted = [...storeCountryCodes].sort((left, right) =>
    collator.compare(storeCountryName(left, language), storeCountryName(right, language))
      || left.localeCompare(right)
  );
  const ranges: StoreCountryRange[] = [];
  for (let offset = 0; offset < sorted.length; offset += 25) {
    const countries = sorted.slice(offset, offset + 25);
    const first = countries[0];
    const last = countries.at(-1);
    if (!first || !last) {
      continue;
    }
    const firstName = storeCountryName(first, language);
    const lastName = storeCountryName(last, language);
    const initial = (name: string) => name.charAt(0).toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US');
    ranges.push({
      index: ranges.length,
      label: initial(firstName) === initial(lastName) ? initial(firstName) : `${initial(firstName)} – ${initial(lastName)}`,
      description: `${firstName} … ${lastName}`.slice(0, 100),
      countries,
    });
  }
  return ranges;
}

function countryOption(code: StoreCountryCode, language: Language, selected?: StoreCountryCode): StringSelectMenuOptionBuilder {
  return new StringSelectMenuOptionBuilder()
    .setLabel(storeCountryLabel(code, language).slice(0, 100))
    .setValue(code)
    .setEmoji(flagEmoji(code))
    .setDefault(code === selected);
}

export function buildCommonCountryOptions(
  language: Language,
  selectedCountry: StoreCountryCode,
): StringSelectMenuOptionBuilder[] {
  const collator = new Intl.Collator(language === 'tr' ? 'tr-TR' : 'en-US', {
    sensitivity: 'base',
  });
  return [...new Set([selectedCountry, ...commonStoreCountries])]
    .slice(0, 25)
    .sort((left, right) => collator.compare(
      storeCountryName(left, language),
      storeCountryName(right, language),
    ))
    .map((code) => countryOption(code, language, selectedCountry));
}

export interface CountryPickerOptions {
  /** The current country, preselected and kept in the popular list. */
  readonly selected?: StoreCountryCode;
  readonly disabled?: boolean;
}

/** Every country picker action: setup, Settings and the slash command share one flow. */
export type CountryPickerAction = 'select' | 'range' | 'back' | 'search' | 'cancel';

export function parseCountryPickerAction(customId: string, sessionId: string): CountryPickerAction | null {
  const prefix = `country:${sessionId}:`;
  const action = customId.startsWith(prefix) ? customId.slice(prefix.length) : '';
  return ['select', 'range', 'back', 'search', 'cancel'].includes(action) ? action as CountryPickerAction : null;
}

function pickerContainer(language: Language, subtitle: string): ContainerBuilder {
  const text = uiCopy(language);
  return new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# 🌍 DEALIO · ${language === 'tr' ? 'BÖLGE' : 'REGION'}\n# ${text.regionTitle}\n${subtitle}`));
}

function pickerButtons(language: Language, sessionId: string, disabled: boolean, back: boolean): ActionRowBuilder<ButtonBuilder> {
  const tr = language === 'tr';
  const button = (action: CountryPickerAction, label: string, emoji: string) => new ButtonBuilder()
    .setCustomId(`country:${sessionId}:${action}`).setLabel(label).setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(back ? [button('back', tr ? 'Geri' : 'Back', '◀️')] : []),
    button('search', tr ? 'Ülke ara' : 'Search country', '🔎'),
    button('cancel', tr ? 'Vazgeç' : 'Cancel', '↩️'),
  );
}

function finishPicker(container: ContainerBuilder, language: Language): ContainerBuilder {
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

/**
 * The single region picker: popular countries, the full A–Z catalog in ranges,
 * and a search. Choosing from either list emits `country:<session>:select`.
 */
export function buildCountryRangePanel(
  language: Language,
  sessionId: string,
  options: CountryPickerOptions = {},
): ContainerBuilder {
  const text = uiCopy(language);
  const tr = language === 'tr';
  const disabled = options.disabled ?? false;
  const container = pickerContainer(language, `${text.regionDescription}\n-# ${tr
    ? 'Steam hesabının mağaza ülkesini seç; Discord konumun kullanılmaz.'
    : 'Choose your Steam account’s store country; your Discord location is not used.'}`);
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`country:${sessionId}:select`)
      .setPlaceholder(`⭐ ${tr ? 'Sık seçilen ülkeler' : 'Popular countries'}`)
      .setDisabled(disabled)
      .addOptions(buildCommonCountryOptions(language, options.selected ?? 'TR')
        .map((option) => options.selected ? option : option.setDefault(false)))),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`country:${sessionId}:range`)
      .setPlaceholder(`🔤 ${tr ? 'Tüm ülkeler (A–Z)' : 'All countries (A–Z)'}`)
      .setDisabled(disabled)
      .addOptions(buildStoreCountryRanges(language).map((range) =>
        new StringSelectMenuOptionBuilder().setLabel(range.label).setDescription(range.description)
          .setValue(String(range.index))))),
  );
  container.addActionRowComponents(pickerButtons(language, sessionId, disabled, false));
  return finishPicker(container, language);
}

export function buildCountryListPanel(
  language: Language,
  sessionId: string,
  rangeIndex: number,
  selectedCountry?: StoreCountryCode,
  disabled = false,
): ContainerBuilder {
  const text = uiCopy(language);
  const range = buildStoreCountryRanges(language)[rangeIndex];
  if (!range) {
    throw new Error('Invalid Store-country range');
  }
  const container = pickerContainer(language, `🔤 **${range.label}** · ${range.description}`);
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`country:${sessionId}:select`)
      .setPlaceholder(text.regionCountryPlaceholder)
      .setDisabled(disabled)
      .addOptions(range.countries.map((code) => countryOption(code, language, selectedCountry)))),
  );
  container.addActionRowComponents(pickerButtons(language, sessionId, disabled, true));
  return finishPicker(container, language);
}

/** Matches for a typed country name or code; an empty result still offers the lists. */
export function buildCountrySearchPanel(
  language: Language,
  sessionId: string,
  query: string,
  selectedCountry?: StoreCountryCode,
): ContainerBuilder {
  const tr = language === 'tr';
  const matches = findStoreCountryChoices(query, language);
  const container = pickerContainer(language, `🔎 ${tr ? 'Arama' : 'Search'}: **${escapeMarkdown(query).slice(0, 60)}**`);
  if (matches.length) {
    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`country:${sessionId}:select`)
      .setPlaceholder(tr ? `${matches.length} sonuç · ülkeni seç` : `${matches.length} results · choose your country`)
      .addOptions(matches.map(({ value }) => countryOption(value, language, selectedCountry)))));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(tr
      ? '🫥 Bu adla bir ülke bulunamadı. Başka bir yazım dene veya listeden seç.'
      : '🫥 No country matches that name. Try another spelling or pick from the list.'));
  }
  container.addActionRowComponents(pickerButtons(language, sessionId, false, true));
  return finishPicker(container, language);
}

export function buildCountrySearchModal(customId: string, language: Language): ModalBuilder {
  const tr = language === 'tr';
  return new ModalBuilder().setCustomId(customId).setTitle(tr ? 'Ülke ara' : 'Search country').addLabelComponents(
    new LabelBuilder().setLabel(tr ? 'Ülke adı veya kodu' : 'Country name or code').setTextInputComponent(
      new TextInputBuilder().setCustomId('country-query').setStyle(TextInputStyle.Short).setRequired(true)
        .setMinLength(2).setMaxLength(60).setPlaceholder(tr ? 'Örn. Türkiye, Almanya, US' : 'e.g. Germany, Brazil, TR')));
}

export function findStoreCountryRange(
  language: Language,
  country: StoreCountryCode,
): number {
  return buildStoreCountryRanges(language).find((range) => range.countries.includes(country))?.index ?? 0;
}

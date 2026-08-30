import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
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

export const commonStoreCountries: readonly StoreCountryCode[] = [
  'TR', 'US', 'GB', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL', 'RO', 'BG',
  'GR', 'UA', 'RU', 'BR', 'MX', 'CA', 'AU', 'NZ', 'JP', 'KR', 'CN', 'IN',
];

export interface StoreCountryRange {
  readonly index: number;
  readonly label: string;
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
    ranges.push({
      index: ranges.length,
      label: `${storeCountryName(first, language)} — ${storeCountryName(last, language)}`.slice(0, 100),
      countries,
    });
  }
  return ranges;
}

export function buildCommonCountryOptions(
  language: Language,
  selectedCountry: StoreCountryCode,
): StringSelectMenuOptionBuilder[] {
  const collator = new Intl.Collator(language === 'tr' ? 'tr-TR' : 'en-US', {
    sensitivity: 'base',
  });
  return [...new Set([selectedCountry, ...commonStoreCountries])]
    .slice(0, 24)
    .sort((left, right) => collator.compare(
      storeCountryName(left, language),
      storeCountryName(right, language),
    ))
    .map((code) => new StringSelectMenuOptionBuilder()
      .setLabel(storeCountryLabel(code, language).slice(0, 100))
      .setValue(code)
      .setDefault(code === selectedCountry));
}

export function buildCountryRangePanel(
  language: Language,
  sessionId: string,
  disabled = false,
): ContainerBuilder {
  const text = uiCopy(language);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`country:${sessionId}:range`)
    .setPlaceholder(text.regionRangePlaceholder)
    .setDisabled(disabled)
    .addOptions(buildStoreCountryRanges(language).map((range) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(range.label)
        .setValue(String(range.index))
    ));
  const container = new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.accent)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# 🌍 ${text.regionTitle}`),
      new TextDisplayBuilder().setContent(text.regionDescription),
    )
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
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
  const select = new StringSelectMenuBuilder()
    .setCustomId(`country:${sessionId}:select`)
    .setPlaceholder(text.regionCountryPlaceholder)
    .setDisabled(disabled)
    .addOptions(range.countries.map((code) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(storeCountryLabel(code, language).slice(0, 100))
        .setValue(code)
        .setDefault(code === selectedCountry)
    ));
  const back = new ButtonBuilder()
    .setCustomId(`country:${sessionId}:back`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(text.back)
    .setEmoji('↩️')
    .setDisabled(disabled);
  const container = new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.accent)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# 🌍 ${text.regionTitle}`),
      new TextDisplayBuilder().setContent(`**${range.label}**`),
    )
    .addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(back),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

export function findStoreCountryRange(
  language: Language,
  country: StoreCountryCode,
): number {
  return buildStoreCountryRanges(language).find((range) => range.countries.includes(country))?.index ?? 0;
}

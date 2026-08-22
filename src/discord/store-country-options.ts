import type { AutocompleteInteraction } from 'discord.js';
import {
  storeCountryCodes,
  storeCountryLabel,
  type StoreCountryCode,
} from '../domain/store-country.js';
import type { Language } from '../domain/user-config.js';
import { languageFromDiscordLocale } from './language.js';

function searchable(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
}

export function findStoreCountryChoices(
  input: string,
  language: Language,
  limit = 25,
): Array<{ name: string; value: StoreCountryCode }> {
  const query = searchable(input.trim());
  return storeCountryCodes
    .map((code) => ({ code, label: storeCountryLabel(code, language) }))
    .filter(({ code, label }) => query === ''
      || searchable(code).includes(query)
      || searchable(label).includes(query))
    .sort((left, right) => {
      const leftExact = searchable(left.code) === query ? 0 : 1;
      const rightExact = searchable(right.code) === query ? 0 : 1;
      return leftExact - rightExact || left.label.localeCompare(right.label, language);
    })
    .slice(0, Math.max(0, Math.min(25, limit)))
    .map(({ code, label }) => ({ name: label, value: code }));
}

export async function handleStoreCountryAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const supported = (interaction.commandName === 'setup' && focused.name === 'store-country')
    || (interaction.commandName === 'region' && focused.name === 'country');
  await interaction.respond(supported
    ? findStoreCountryChoices(String(focused.value), languageFromDiscordLocale(interaction.locale))
    : []);
}
